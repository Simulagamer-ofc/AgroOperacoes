// Sincronização com o Supabase (login + REST), sem bibliotecas.
// O aparelho continua sendo a fonte da tela: cada alteração local entra numa fila
// ("outbox") e é enviada quando houver internet; as alterações dos outros aparelhos
// chegam por ordem de número ("seq"), a partir do último número já recebido.
import { DATA_STORES } from './schemas.js';
import { SYNC_CONFIG } from './config.js';

const PULL_LIMIT = 500;
const PUSH_CHUNK = 200;
const INTERVAL_MS = 20000;

export class SyncError extends Error {
  constructor(message, { network = false, auth = false } = {}) {
    super(message);
    this.network = network;
    this.auth = auth;
  }
}

const KNOWN_ERRORS = [
  [/invalid login credentials|invalid_credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/already registered|already exists|user_already_exists/i, 'Já existe uma conta com esse e-mail. Use “Entrar”.'],
  [/password should be at least|weak_password/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/unable to validate email|invalid format|email_address_invalid/i, 'Esse e-mail não é válido.'],
  [/signups not allowed|signup_disabled/i, 'Novas contas estão desativadas neste servidor.'],
  [/rate limit|too many/i, 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'],
  [/row-level security|permission denied/i, 'Sem permissão nesta fazenda. Entre de novo na conta ou confira o código da fazenda.'],
  [/invalid api key|no api key/i, 'A chave do servidor está errada. Confira em Cadastros → Servidor.'],
];

function errorMessage(data, status) {
  const raw = typeof data === 'string' ? data : data?.error_description || data?.msg || data?.message || data?.error || '';
  for (const [pattern, text] of KNOWN_ERRORS) if (pattern.test(raw) || pattern.test(data?.error_code || data?.code || '')) return text;
  return raw ? `Erro do servidor (${status}): ${raw}` : `Erro do servidor (${status}).`;
}

export function createSync({ db, onRemote, onChange, enabled = true }) {
  let meta = { id: 'sync', url: SYNC_CONFIG.url, anonKey: SYNC_CONFIG.anonKey, session: null, farm: null, cursor: 0, lastSyncAt: null };
  let status = 'idle';
  let lastError = '';
  let pending = 0;
  let running = null;
  let rerun = false;
  let debounce = null;
  let refreshing = null;

  const configured = () => enabled && !!(meta.url && meta.anonKey);
  const linked = () => configured() && !!(meta.session && meta.farm);
  const save = () => db.put('meta', meta);
  const info = () => ({ enabled, configured: configured(), linked: linked(), user: meta.session?.user || null, farm: meta.farm, status, error: lastError, pending, lastSyncAt: meta.lastSyncAt, url: meta.url, anonKey: meta.anonKey });
  const emit = () => onChange?.(info());
  const countPending = async () => { pending = (await db.getAll('outbox')).length; };

  async function init() {
    const saved = await db.get('meta', 'sync');
    if (saved) meta = { ...meta, ...saved, url: saved.url || SYNC_CONFIG.url, anonKey: saved.anonKey || SYNC_CONFIG.anonKey };
    await countPending();
    emit();
    if (!enabled) return;
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, INTERVAL_MS);
    addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    syncNow();
  }

  // ---------- HTTP
  async function http(path, { method = 'GET', body, auth = true, headers = {}, retry = true } = {}) {
    if (!configured()) throw new SyncError('O servidor de sincronização não está configurado.');
    if (auth) await ensureFreshToken();
    const token = auth && meta.session ? meta.session.access_token : meta.anonKey;
    let res;
    try {
      res = await fetch(meta.url.replace(/\/+$/, '') + path, {
        method,
        headers: { apikey: meta.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SyncError('Sem conexão com o servidor.', { network: true });
    }
    if (res.status === 401 && auth && retry && meta.session?.refresh_token) {
      await refreshSession();
      return http(path, { method, body, auth, headers, retry: false });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new SyncError(errorMessage(data, res.status), { auth: res.status === 401 });
    return data;
  }

  function storeSession(s) {
    meta.session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
      user: { id: s.user?.id, email: s.user?.email },
    };
  }

  async function ensureFreshToken() {
    if (meta.session && meta.session.expires_at - 60 < Date.now() / 1000) await refreshSession();
  }

  function refreshSession() {
    refreshing ??= (async () => {
      try {
        const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: meta.session.refresh_token }, auth: false });
        storeSession(s);
        await save();
      } catch (err) {
        if (!err.network) {
          // Sessão expirada de vez: pede login de novo, mas mantém a fazenda e a fila.
          meta.session = null;
          await save();
          emit();
          throw new SyncError('Sua sessão expirou. Entre de novo na conta para continuar sincronizando.', { auth: true });
        }
        throw err;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  // ---------- Conta
  async function signUp(email, password) {
    const data = await http('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
    if (data?.access_token) { storeSession(data); await save(); emit(); return { confirm: false }; }
    return { confirm: true };
  }

  async function signIn(email, password) {
    const data = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
    const sameUser = meta.session?.user?.id === data.user?.id || !meta.farm;
    storeSession(data);
    if (!sameUser) { meta.farm = null; meta.cursor = 0; }
    await save();
    emit();
    if (linked()) syncNow();
  }

  async function signOut() {
    try { if (meta.session) await http('/auth/v1/logout', { method: 'POST', retry: false }); } catch { /* sai mesmo sem internet */ }
    meta = { ...meta, session: null, farm: null, cursor: 0, lastSyncAt: null };
    await save();
    await clearQueue();
    status = 'idle';
    lastError = '';
    emit();
  }

  function setServer(url, anonKey) {
    meta = { ...meta, url: url.trim(), anonKey: anonKey.trim(), session: null, farm: null, cursor: 0, lastSyncAt: null };
    return save().then(emit);
  }

  // ---------- Fazendas
  const listFarms = () => http('/rest/v1/farms?select=id,name,join_code&order=created_at.asc');
  const createFarm = name => http('/rest/v1/rpc/create_farm', { method: 'POST', body: { p_name: name } });
  const joinFarm = code => http('/rest/v1/rpc/join_farm', { method: 'POST', body: { p_code: code } });

  async function renameFarm(name) {
    const rows = await http(`/rest/v1/farms?id=eq.${meta.farm.id}`, { method: 'PATCH', body: { name }, headers: { Prefer: 'return=representation' } });
    if (rows?.[0]) { meta.farm = pickFarm(rows[0]); await save(); emit(); }
  }

  const pickFarm = f => ({ id: f.id, name: f.name, join_code: f.join_code });

  async function linkFarm(farm) {
    meta.farm = pickFarm(farm);
    meta.cursor = 0;
    meta.lastSyncAt = null;
    await save();
    emit();
    return syncNow();
  }

  // ---------- Fila de envio
  async function clearQueue() {
    for (const item of await db.getAll('outbox')) await db.remove('outbox', item.id);
    await countPending();
    emit();
  }

  async function queue(store, record, deleted = false) {
    if (!DATA_STORES.includes(store)) return;
    await db.put('outbox', { id: `${store}:${record.id}`, store, recId: record.id, data: deleted ? null : record, deleted, queuedAt: Date.now() + Math.random() });
    await countPending();
    emit();
    if (linked()) { clearTimeout(debounce); debounce = setTimeout(syncNow, 800); }
  }

  async function push() {
    const items = await db.getAll('outbox');
    for (let i = 0; i < items.length; i += PUSH_CHUNK) {
      const chunk = items.slice(i, i + PUSH_CHUNK);
      const body = chunk.map(it => ({ farm_id: meta.farm.id, store: it.store, id: it.recId, data: it.deleted ? {} : it.data, deleted: !!it.deleted }));
      await http('/rest/v1/records?on_conflict=farm_id,store,id', { method: 'POST', body, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      for (const it of chunk) {
        const current = await db.get('outbox', it.id);
        if (current && current.queuedAt === it.queuedAt) await db.remove('outbox', it.id);
      }
    }
    await countPending();
  }

  async function pull() {
    let cursor = meta.cursor || 0;
    for (;;) {
      const rows = await http(`/rest/v1/records?select=store,id,data,deleted,seq&farm_id=eq.${meta.farm.id}&seq=gt.${cursor}&order=seq.asc&limit=${PULL_LIMIT}`);
      if (!rows.length) break;
      // Alteração local ainda não enviada vence a que veio do servidor; ela sobe no próximo envio.
      const waiting = new Set((await db.getAll('outbox')).map(o => o.id));
      const usable = rows.filter(r => DATA_STORES.includes(r.store) && !waiting.has(`${r.store}:${r.id}`));
      if (usable.length) await onRemote(usable.map(r => ({ store: r.store, id: r.id, deleted: r.deleted, data: r.deleted ? null : { ...r.data, id: r.id } })));
      cursor = rows[rows.length - 1].seq;
      meta.cursor = cursor;
      await save();
      if (rows.length < PULL_LIMIT) break;
    }
  }

  async function refreshFarm() {
    const rows = await http(`/rest/v1/farms?select=id,name,join_code&id=eq.${meta.farm.id}`);
    if (!rows.length) throw new SyncError('Você não participa mais desta fazenda. Entre de novo com o código da fazenda.');
    if (rows[0].name !== meta.farm.name || rows[0].join_code !== meta.farm.join_code) { meta.farm = pickFarm(rows[0]); await save(); }
  }

  function syncNow() {
    if (!linked()) return Promise.resolve();
    if (running) { rerun = true; return running; }
    running = (async () => {
      status = 'syncing';
      emit();
      try {
        do {
          rerun = false;
          await refreshFarm();
          await push();
          await pull();
        } while (rerun);
        meta.lastSyncAt = new Date().toISOString();
        await save();
        status = 'idle';
        lastError = '';
      } catch (err) {
        status = err.network ? 'offline' : 'error';
        lastError = err.message;
        if (!err.network) console.warn('Sincronização:', err);
      } finally {
        running = null;
        await countPending();
        emit();
      }
    })();
    return running;
  }

  return { init, info, signUp, signIn, signOut, setServer, listFarms, createFarm, joinFarm, renameFarm, linkFarm, queue, clearQueue, syncNow, isLinked: linked };
}
