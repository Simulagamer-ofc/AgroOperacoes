'use strict';
/* Nexus Agro na nuvem (Supabase): conta, fazenda compartilhada pela equipe e sincronização automática.
   Os dados continuam no aparelho e o app funciona sem internet. Com internet, cada registro alterado sobe para a
   fazenda e as alterações dos outros aparelhos descem em ordem de chegada (seq).
   Conflito (mesmo registro alterado em dois aparelhos antes de sincronizar): vale a alteração mais recente (_mod);
   no estoque, o saldo soma o que cada aparelho lançou. Exclusões viajam como registros marcados "deleted".
   Sem bibliotecas: login e dados pela API REST do Supabase. A chave publicável é pública por natureza;
   quem protege os dados são as regras do banco (cada conta só enxerga as fazendas de que participa). */

const NUVEM = {url: 'https://gfvtudfdhooavcchdpnm.supabase.co', chave: 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'};
const NV_ESTADO = 'agro-nuvem', NV_BASE = 'agro-nuvem-base';
const NV_LOTE_ENVIO = 200, NV_LOTE_RECEBE = 500, NV_INTERVALO = 60000;

const nvLer = (k, padrao) => { try { const v = JSON.parse(safeStorage.get(k) || 'null'); return v && typeof v === 'object' ? v : padrao; } catch { return padrao; } };
// Estado da conta neste aparelho (fica fora do banco: não vai para backups nem arquivos de sincronização)
let nv = {sessao: null, fazenda: null, cursor: 0, ultima: null, ...nvLer(NV_ESTADO, {})};
// Última versão de cada registro conhecida pelo servidor: 'coleção|id' → [impressão, saldo do estoque]
let nvBase = nvLer(NV_BASE, {});
let nvStatus = 'parado', nvErro = '', nvRodando = null, nvRepetir = false, nvAgenda = null, nvOcupado = false, nvFazendas = null;

const nvSalvar = () => { safeStorage.set(NV_ESTADO, JSON.stringify(nv)); safeStorage.set(NV_BASE, JSON.stringify(nvBase)); };
const nvVinculado = () => !!(nv.sessao && nv.fazenda);

// ---------- Impressão de um registro (igual no aparelho e no servidor, que reordena as chaves) ----------
const nvCanon = v => Array.isArray(v) ? '[' + v.map(nvCanon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort().map(k => JSON.stringify(k) + ':' + nvCanon(v[k])).join(',') + '}'
  : JSON.stringify(v ?? null);
function nvHash(r) { const s = nvCanon(r); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }
const nvChave = (c, id) => c + '|' + id;
const nvBaseDe = (c, r) => c === 'stock' ? [nvHash(r), Number(r.qty) || 0] : [nvHash(r)];
const nvArred = x => Math.round(x * 1e6) / 1e6;

// Exclusões feitas neste aparelho: 'coleção|id' → momento da exclusão
function nvExclusoes() {
  const m = new Map();
  for (const e of db._removidos || []) { if (!e?.id) continue; const k = nvChave(e.c, e.id); if (!m.has(k) || e.at > m.get(k).at) m.set(k, {c: e.c, id: e.id, at: e.at || 0}); }
  return m;
}
const nvPresentes = () => Object.fromEntries(COLLECTIONS.map(c => [c, new Set(db[c].map(r => r?.id))]));

// Alterações deste aparelho que o servidor ainda não tem
function nvPendentes() {
  const itens = [], presentes = nvPresentes();
  for (const c of COLLECTIONS) for (const r of db[c]) {
    if (!r?.id) continue;
    const b = nvBaseDe(c, r);
    if (nvBase[nvChave(c, r.id)]?.[0] !== b[0]) itens.push({c, id: r.id, data: JSON.parse(JSON.stringify(r)), deleted: false, base: b});
  }
  for (const [k, e] of nvExclusoes()) if (nvBase[k] && !presentes[e.c]?.has(e.id)) itens.push({c: e.c, id: e.id, data: {_mod: e.at}, deleted: true, base: null});
  return itens;
}

// ---------- Comunicação com o servidor ----------
class NvErro extends Error { constructor(msg, {rede = false, sessao = false} = {}) { super(msg); this.rede = rede; this.sessao = sessao; } }
const NV_MENSAGENS = [
  [/invalid login credentials|invalid_credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed|email_not_confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/already registered|already exists|user_already_exists/i, 'Já existe uma conta com esse e-mail. Use “Entrar”.'],
  [/password should be at least|weak_password/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/unable to validate email|invalid format|email_address_invalid/i, 'Esse e-mail não é válido.'],
  [/signups not allowed|signup_disabled/i, 'Novas contas estão desativadas no servidor.'],
  [/rate limit|too many|over_email_send_rate_limit/i, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'],
  [/row-level security|permission denied/i, 'Sem permissão nesta fazenda. Entre de novo na conta ou confira o código da fazenda.'],
  [/invalid api key|no api key/i, 'A chave do servidor está errada (atualize o aplicativo).'],
  [/Código de fazenda não encontrado|Entre na sua conta/i, null]
];
function nvMensagem(data, status) {
  const bruto = typeof data === 'string' ? data : data?.msg || data?.message || data?.error_description || data?.error || '';
  const cod = typeof data === 'object' ? data?.error_code || data?.code || '' : '';
  for (const [re, txt] of NV_MENSAGENS) if (re.test(bruto) || re.test(cod)) return txt || bruto;
  return bruto ? `Erro do servidor (${status}): ${bruto}` : `Erro do servidor (${status}).`;
}

async function nvHttp(caminho, {method = 'GET', body, auth = true, headers = {}, tentar = true} = {}) {
  if (auth) { if (!nv.sessao) throw new NvErro('Entre na sua conta para sincronizar.', {sessao: true}); await nvTokenValido(); }
  const h = {apikey: NUVEM.chave, 'Content-Type': 'application/json', ...headers};
  if (auth) h.Authorization = 'Bearer ' + nv.sessao.access_token;
  let res;
  try { res = await fetch(NUVEM.url + caminho, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)}); } catch { throw new NvErro('Sem conexão com o servidor.', {rede: true}); }
  if (res.status === 401 && auth && tentar && nv.sessao?.refresh_token) { await nvRenovar(); return nvHttp(caminho, {method, body, auth, headers, tentar: false}); }
  const texto = await res.text();
  let data = null; try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  if (!res.ok) throw new NvErro(nvMensagem(data, res.status), {sessao: res.status === 401});
  return data;
}

function nvGuardarSessao(s) {
  nv.sessao = {access_token: s.access_token, refresh_token: s.refresh_token, expira: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: s.user?.email || nv.sessao?.email || '', usuario: s.user?.id || nv.sessao?.usuario || ''};
}
async function nvTokenValido() { if (nv.sessao && nv.sessao.expira - 60 < Date.now() / 1000) await nvRenovar(); }
let nvRenovando = null;
function nvRenovar() {
  nvRenovando ??= (async () => {
    try {
      const s = await nvHttp('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: nv.sessao.refresh_token}, auth: false});
      nvGuardarSessao(s); nvSalvar();
    } catch (err) {
      if (err.rede) throw err;
      // Sessão vencida de vez: pede login de novo, mas mantém a fazenda e o que falta enviar
      nv.sessao = null; nvSalvar();
      throw new NvErro('Sua sessão expirou. Entre de novo na conta para continuar sincronizando.', {sessao: true});
    } finally { nvRenovando = null; }
  })();
  return nvRenovando;
}

// ---------- Sincronização ----------
// Aplica um registro vindo do servidor. Retorna 1 se mudou algo neste aparelho.
function nvAplicar(row, exclusoes) {
  const c = row.store, k = nvChave(c, row.id), lista = db[c], i = lista.findIndex(x => x?.id === row.id), local = i >= 0 ? lista[i] : null;
  const base = nvBase[k], hLocal = local ? nvHash(local) : null, localAlterado = !!local && base?.[0] !== hLocal;
  if (row.deleted) {
    const at = Number(row.data?._mod) || 0;
    delete nvBase[k];
    if (!local) return 0;
    if (localAlterado && (local._mod || 0) > at) return 0; // edição local depois da exclusão: o registro volta a subir
    lista.splice(i, 1); return 1;
  }
  const remoto = {...(row.data || {}), id: row.id}, hRemoto = nvHash(remoto);
  if (!local) {
    const ex = exclusoes.get(k);
    nvBase[k] = nvBaseDe(c, remoto);
    if (ex && ex.at >= (remoto._mod || 0)) return 0; // excluído aqui depois da última alteração: a exclusão sobe
    lista.push(remoto); return 1;
  }
  if (hLocal === hRemoto) { nvBase[k] = nvBaseDe(c, remoto); return 0; }
  if (!localAlterado) { lista[i] = remoto; nvBase[k] = nvBaseDe(c, remoto); return 1; }
  // Alterado nos dois lados: vale o mais recente; no estoque, soma o que este aparelho lançou ao saldo do servidor
  let fica = (remoto._mod || 0) > (local._mod || 0) ? remoto : local;
  if (c === 'stock' && base && base.length > 1) fica = {...fica, qty: nvArred((Number(remoto.qty) || 0) + (Number(local.qty) || 0) - (Number(base[1]) || 0))};
  nvBase[k] = nvBaseDe(c, remoto);
  if (nvHash(fica) === hLocal) return 0;
  lista[i] = fica; return 1;
}

async function nvReceber() {
  const exclusoes = nvExclusoes(), presentes = nvPresentes();
  // Registros conhecidos que sumiram sem exclusão (dados apagados ou backup restaurado): baixa tudo de novo
  if (Object.keys(nvBase).some(k => { const p = k.indexOf('|'), c = k.slice(0, p), id = k.slice(p + 1); return presentes[c] && !presentes[c].has(id) && !exclusoes.has(k); })) nv.cursor = 0;
  let mudou = 0;
  for (;;) {
    const rows = await nvHttp(`/rest/v1/records?select=store,id,data,deleted,seq&farm_id=eq.${encodeURIComponent(nv.fazenda.id)}&seq=gt.${nv.cursor || 0}&order=seq.asc&limit=${NV_LOTE_RECEBE}`);
    if (!Array.isArray(rows) || !rows.length) break;
    let nesteLote = 0;
    for (const row of rows) if (COLLECTIONS.includes(row.store) && row.id) nesteLote += nvAplicar(row, exclusoes);
    if (nesteLote) { impressoes = null; salvarSemNuvem(); } // vindo de outro aparelho: não é alteração local
    nv.cursor = rows[rows.length - 1].seq;
    nvSalvar();
    mudou += nesteLote;
    if (rows.length < NV_LOTE_RECEBE) break;
  }
  return mudou;
}

async function nvEnviar() {
  const itens = nvPendentes();
  for (let i = 0; i < itens.length; i += NV_LOTE_ENVIO) {
    const lote = itens.slice(i, i + NV_LOTE_ENVIO);
    await nvHttp('/rest/v1/records?on_conflict=farm_id,store,id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
      body: lote.map(it => ({farm_id: nv.fazenda.id, store: it.c, id: it.id, data: it.data, deleted: it.deleted}))});
    for (const it of lote) { const k = nvChave(it.c, it.id); if (it.deleted) delete nvBase[k]; else nvBase[k] = it.base; }
    nvSalvar();
  }
  return itens.length;
}

async function nvConferirFazenda() {
  const rows = await nvHttp(`/rest/v1/farms?select=id,name,join_code&id=eq.${encodeURIComponent(nv.fazenda.id)}`);
  if (!rows.length) throw new NvErro('Você não participa mais desta fazenda. Escolha outra ou entre com um código de convite.');
  const f = rows[0];
  if (f.name !== nv.fazenda.name || f.join_code !== nv.fazenda.join_code) { nv.fazenda = {id: f.id, name: f.name, join_code: f.join_code}; nvSalvar(); }
}

function nvSincronizar(manual = false) {
  if (!nvVinculado()) return Promise.resolve();
  if (nvRodando) { nvRepetir = true; return nvRodando; }
  nvRodando = (async () => {
    nvStatus = 'sincronizando'; nvMostrar();
    let recebidos = 0, enviados = 0;
    try {
      do {
        nvRepetir = false;
        await nvConferirFazenda();
        recebidos += await nvReceber(); // recebe antes de enviar: o conflito é resolvido aqui pela data da alteração
        enviados += await nvEnviar();
      } while (nvRepetir);
      nv.ultima = new Date().toISOString(); nvSalvar();
      nvStatus = 'ok'; nvErro = '';
      if (recebidos) { nvAtualizarTela(); showToast(`Nuvem: ${recebidos} ${recebidos === 1 ? 'alteração recebida' : 'alterações recebidas'} da equipe`); }
      else if (manual) showToast(enviados ? `Nuvem: ${enviados} ${enviados === 1 ? 'alteração enviada' : 'alterações enviadas'}` : 'Tudo sincronizado');
    } catch (err) {
      nvStatus = err.rede ? 'offline' : 'erro'; nvErro = err.message || 'Erro na sincronização.';
      if (manual || err.sessao) showToast(nvErro, !err.rede);
      if (recebidos) nvAtualizarTela();
    } finally { nvRodando = null; nvMostrar(); }
  })();
  return nvRodando;
}

// Redesenha a tela com os dados recebidos, sem atrapalhar quem está preenchendo um formulário
function nvAtualizarTela() {
  const editando = modal.classList.contains('open') || (document.activeElement && view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  if (!editando) render();
}

function nvAgendar(ms = 3000) {
  if (!nvVinculado()) return;
  clearTimeout(nvAgenda);
  nvAgenda = setTimeout(() => { if (navigator.onLine !== false) nvSincronizar(); }, ms);
}

// Toda gravação local agenda um envio (com intervalo, para juntar várias alterações seguidas)
const salvarSemNuvem = save;
save = function () { const ok = salvarSemNuvem(); nvAgendar(); return ok; };

setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) nvSincronizar(); }, NV_INTERVALO);
addEventListener('online', () => nvAgendar(500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nvAgendar(500); });
addEventListener('DOMContentLoaded', () => nvAgendar(1500));

// ---------- Conta e fazenda ----------
async function nvComOcupado(fn) {
  if (nvOcupado) return; nvOcupado = true; nvMostrar();
  try { await fn(); } catch (err) { showToast(err.message || 'Não foi possível concluir.', true); } finally { nvOcupado = false; render(); }
}
const nvCampos = () => ({email: ($('#nv_email')?.value || '').trim().toLowerCase(), senha: $('#nv_senha')?.value || ''});
function nvValidar({email, senha}) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new NvErro('Digite um e-mail válido.');
  if (senha.length < 6) throw new NvErro('A senha precisa ter pelo menos 6 caracteres.');
}
function nvEsquecerFazenda() { nv.fazenda = null; nv.cursor = 0; nv.ultima = null; nvBase = {}; nvFazendas = null; nvStatus = 'parado'; nvErro = ''; }

const nvEntrar = () => nvComOcupado(async () => {
  const d = nvCampos(); nvValidar(d);
  const s = await nvHttp('/auth/v1/token?grant_type=password', {method: 'POST', body: {email: d.email, password: d.senha}, auth: false});
  if (nv.sessao?.usuario && nv.sessao.usuario !== s.user?.id) nvEsquecerFazenda();
  nvGuardarSessao(s); nvSalvar();
  showToast('Conta conectada');
  if (nvVinculado()) nvSincronizar();
});
const nvCriarConta = () => nvComOcupado(async () => {
  const d = nvCampos(); nvValidar(d);
  const s = await nvHttp('/auth/v1/signup', {method: 'POST', body: {email: d.email, password: d.senha}, auth: false});
  if (s?.access_token) { nvGuardarSessao(s); nvSalvar(); showToast('Conta criada'); }
  else showToast('Conta criada. Abra o e-mail de confirmação que enviamos e depois toque em “Entrar”.', true);
});
const nvSair = () => confirmDialog('Sair da conta neste aparelho? Os dados continuam aqui, mas deixam de sincronizar com a fazenda até você entrar de novo.', async () => {
  try { if (nv.sessao) await nvHttp('/auth/v1/logout', {method: 'POST', tentar: false}); } catch { /* sai mesmo sem internet */ }
  nv.sessao = null; nvEsquecerFazenda(); nvSalvar(); showToast('Você saiu da conta'); render();
}, 'Sair');

async function nvCarregarFazendas() {
  try { nvFazendas = await nvHttp('/rest/v1/farms?select=id,name,join_code&order=created_at.asc'); } catch (err) { nvFazendas = []; showToast(err.message, true); }
  const el = $('#nvFazendas'); if (el) el.innerHTML = nvListaFazendas();
}
const nvListaFazendas = () => nvFazendas === null ? '<p class="nota">Carregando suas fazendas…</p>'
  : nvFazendas.length ? `<p>Suas fazendas:</p><div class="btn-row">${nvFazendas.map(f => btn(f.name, 'nv-usar', f.id, 'secondary')).join('')}</div>` : '<p class="nota">Você ainda não participa de nenhuma fazenda. Crie uma ou entre com o código que alguém da equipe passou.</p>';

function nvVincular(f) {
  const n = COLLECTIONS.reduce((s, c) => s + db[c].length, 0);
  const ligar = () => { nvEsquecerFazenda(); nv.fazenda = {id: f.id, name: f.name, join_code: f.join_code}; nvSalvar(); showToast(`Sincronizando com “${f.name}”…`); nvSincronizar(true); };
  if (n) confirmDialog(`Este aparelho tem ${n} registros. Eles serão enviados para “${f.name}” e juntados com os dados que a equipe já tem lá. Se forem só dados de exemplo, apague-os antes em “Dados de exemplo e limpeza”. Continuar?`, ligar, 'Enviar e juntar');
  else { ligar(); render(); }
}
const nvCriarFazenda = () => nvComOcupado(async () => {
  const nome = ($('#nv_nome')?.value || '').trim();
  if (!nome) throw new NvErro('Dê um nome para a fazenda.');
  const f = await nvHttp('/rest/v1/rpc/create_farm', {method: 'POST', body: {p_name: nome}});
  nvFazendas = null; nvVincular(f);
});
const nvEntrarCodigo = () => nvComOcupado(async () => {
  const cod = ($('#nv_codigo')?.value || '').trim().toUpperCase();
  if (!cod) throw new NvErro('Digite o código da fazenda.');
  const f = await nvHttp('/rest/v1/rpc/join_farm', {method: 'POST', body: {p_code: cod}});
  nvFazendas = null; nvVincular(f);
});

// ---------- Tela (Cadastros e backup) ----------
function nvTextoStatus() {
  const pend = nvVinculado() ? nvPendentes().length : 0, aguardando = pend ? ` • ${pend} ${pend === 1 ? 'alteração aguardando envio' : 'alterações aguardando envio'}` : '';
  if (nvStatus === 'sincronizando') return 'Sincronizando…';
  if (nvStatus === 'erro') return '⚠ ' + nvErro + aguardando;
  if (nvStatus === 'offline' || navigator.onLine === false) return 'Sem internet: as alterações ficam guardadas e sobem sozinhas quando o sinal voltar' + aguardando;
  return (nv.ultima ? `Sincronizado em ${new Date(nv.ultima).toLocaleString('pt-BR')}` : 'Ainda não sincronizado') + aguardando;
}
function nvMostrar() {
  const s = $('#nvStatus'); if (s) s.textContent = nvTextoStatus();
  $$('[data-act^="nv-"]').forEach(b => { b.disabled = nvOcupado; });
}

function cartaoNuvem() {
  const titulo = '<h3>Nuvem da equipe</h3>';
  if (!nv.sessao) return `<article class="card panel">${titulo}
    <p>Crie uma conta para guardar os dados na internet e usar o Nexus Agro em vários celulares e computadores ao mesmo tempo. Tudo continua funcionando sem sinal; quando a internet volta, o app envia e recebe as alterações sozinho.</p>
    ${nv.fazenda ? `<p class="nota">Este aparelho estava ligado à fazenda “${esc(nv.fazenda.name)}”. Entre de novo para continuar sincronizando.</p>` : ''}
    <div class="form"><div class="field full"><label for="nv_email">E-mail</label><input id="nv_email" type="email" autocomplete="username" inputmode="email" value="${esc(nv.sessao?.email || '')}"></div>
    <div class="field full"><label for="nv_senha">Senha</label><input id="nv_senha" type="password" autocomplete="current-password" placeholder="Pelo menos 6 caracteres"></div></div>
    <div class="btn-row">${btn('Entrar', 'nv-entrar')}${btn('Criar conta', 'nv-criar', '', 'secondary')}</div></article>`;
  if (!nv.fazenda) return `<article class="card panel">${titulo}
    <p>Conectado como <b>${esc(nv.sessao.email)}</b>. Escolha a fazenda que este aparelho vai sincronizar.</p>
    <div id="nvFazendas">${nvListaFazendas()}</div>
    <div class="form"><div class="field full"><label for="nv_nome">Criar uma fazenda</label><input id="nv_nome" value="${esc(db.settings.farm || '')}" placeholder="Ex.: Fazenda Boa Vista"></div></div>
    <div class="btn-row">${btn('Criar fazenda', 'nv-nova')}</div>
    <div class="form"><div class="field full"><label for="nv_codigo">Entrar numa fazenda da equipe</label><input id="nv_codigo" autocapitalize="characters" placeholder="Código de 8 letras e números"></div></div>
    <div class="btn-row">${btn('Entrar com o código', 'nv-codigo', '', 'secondary')}${btn('Sair da conta', 'nv-sair', '', 'secondary')}</div></article>`;
  return `<article class="card panel">${titulo}
    <p>Fazenda <b>${esc(nv.fazenda.name)}</b> • conta ${esc(nv.sessao.email)}</p>
    <p>Código para a equipe entrar: <b style="font-size:1.15rem;letter-spacing:.12em">${esc(nv.fazenda.join_code)}</b></p>
    <p class="nota" id="nvStatus">${esc(nvTextoStatus())}</p>
    <div class="btn-row" style="margin-top:10px">${btn('⟳ Sincronizar agora', 'nv-sync')}${btn('Trocar de fazenda', 'nv-trocar', '', 'secondary')}${btn('Sair da conta', 'nv-sair', '', 'secondary')}</div>
    <p class="nota">Cada pessoa cria a própria conta e entra com o código acima. Quando o mesmo registro é alterado em dois aparelhos sem internet, vale a alteração mais recente; lançamentos de estoque dos dois lados são somados ao saldo.</p></article>`;
}

// Cartão da nuvem antes do cartão de sincronização por arquivo (que continua valendo para quem não tem internet)
const cartaoSincronizacaoArquivo = cartaoSincronizacao;
cartaoSincronizacao = () => cartaoNuvem() + cartaoSincronizacaoArquivo();
const cadastrosAfterSemNuvem = VIEWS.cadastros.after;
VIEWS.cadastros.after = arg => {
  cadastrosAfterSemNuvem?.(arg);
  if (nv.sessao && !nv.fazenda && nvFazendas === null) nvCarregarFazendas();
  const senha = $('#nv_senha'); if (senha) senha.onkeydown = e => { if (e.key === 'Enter') nvEntrar(); };
  nvMostrar();
};
Object.assign(ACTIONS, {
  'nv-entrar': nvEntrar, 'nv-criar': nvCriarConta, 'nv-sair': nvSair,
  'nv-nova': nvCriarFazenda, 'nv-codigo': nvEntrarCodigo,
  'nv-usar': id => { const f = (nvFazendas || []).find(x => x.id === id); if (f) nvVincular(f); },
  'nv-sync': () => nvSincronizar(true),
  'nv-trocar': () => confirmDialog('Desligar este aparelho da fazenda atual? Os dados continuam aqui; ao escolher outra fazenda, eles serão enviados para ela.', () => { nvEsquecerFazenda(); nvSalvar(); }, 'Trocar')
});
