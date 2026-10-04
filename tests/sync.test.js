import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../app/src/main/assets/www/js/sync.js';

// Banco local em memória com a mesma interface do db.js.
function memoryDb() {
  const stores = new Map();
  const s = name => (stores.has(name) ? stores.get(name) : stores.set(name, new Map()).get(name));
  return {
    async get(store, id) { return structuredClone(s(store).get(id) ?? null); },
    async getAll(store) { return [...s(store).values()].map(v => structuredClone(v)); },
    async put(store, r) { s(store).set(r.id, structuredClone(r)); },
    async remove(store, id) { s(store).delete(id); },
  };
}

// Servidor simulado: guarda registros por fazenda, numera alterações e confere o token.
function fakeServer() {
  const rows = new Map();
  let seq = 0;
  const calls = [];
  let offline = false;
  const fetch = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url.replace('https://srv', '')}`);
    if (offline) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const json = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
    if (u.pathname === '/auth/v1/token') return json(200, { access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'a@b' } });
    if (opts.headers.Authorization !== 'Bearer tok') return json(401, { message: 'JWT expired' });
    if (u.pathname === '/rest/v1/farms') return json(200, [{ id: 'f1', name: 'Fazenda', join_code: 'ABC' }]);
    if (u.pathname === '/rest/v1/records' && opts.method === 'POST') {
      for (const r of JSON.parse(opts.body)) rows.set(`${r.store}:${r.id}`, { ...r, seq: ++seq });
      return json(201);
    }
    if (u.pathname === '/rest/v1/records') {
      const after = Number(u.searchParams.get('seq').slice(3));
      const limit = Number(u.searchParams.get('limit'));
      return json(200, [...rows.values()].filter(r => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit));
    }
    return json(404, { message: 'not found' });
  };
  return { fetch, rows, calls, setOffline: v => { offline = v; }, write: (store, id, data, deleted = false) => rows.set(`${store}:${id}`, { farm_id: 'f1', store, id, data, deleted, seq: ++seq }) };
}

async function linkedDevice(server) {
  globalThis.fetch = server.fetch;
  const db = memoryDb();
  const received = [];
  const sync = createSync({ db, enabled: true, onRemote: rows => received.push(...rows) });
  await sync.setServer('https://srv', 'anon');
  await sync.signIn('a@b', 'senha123');
  await sync.linkFarm({ id: 'f1', name: 'Fazenda', join_code: 'ABC' });
  return { sync, db, received };
}

test('envia a fila e esvazia depois do envio', async () => {
  const server = fakeServer();
  const { sync, db } = await linkedDevice(server);
  await sync.queue('fields', { id: 't1', name: 'Talhão 1' });
  await sync.queue('fields', { id: 't2', name: 'Talhão 2' }, true);
  await sync.syncNow();
  assert.equal((await db.getAll('outbox')).length, 0);
  assert.equal(server.rows.get('fields:t1').data.name, 'Talhão 1');
  assert.equal(server.rows.get('fields:t2').deleted, true);
  assert.equal(sync.info().status, 'idle');
});

test('recebe alterações dos outros em ordem e guarda o cursor', async () => {
  const server = fakeServer();
  const { sync, db, received } = await linkedDevice(server);
  server.write('machines', 'm1', { name: 'Trator' });
  server.write('machines', 'm1', { name: 'Trator 2' });
  server.write('fields', 'x', {}, true);
  await sync.syncNow();
  assert.deepEqual(received.map(r => [r.store, r.id, r.deleted, r.data?.name]), [['machines', 'm1', false, 'Trator 2'], ['fields', 'x', true, undefined]]);
  assert.equal(received[0].data.id, 'm1', 'o id do registro vem preenchido');
  assert.ok((await db.get('meta', 'sync')).cursor > 0);
  received.length = 0;
  await sync.syncNow();
  assert.equal(received.length, 0, 'não recebe de novo o que já recebeu');
});

test('alteração local pendente não é sobrescrita pela do servidor', async () => {
  const server = fakeServer();
  const { sync, received } = await linkedDevice(server);
  server.setOffline(true);
  await sync.queue('fields', { id: 't1', name: 'Local' });
  await sync.syncNow();
  assert.equal(sync.info().status, 'offline');
  assert.equal(sync.info().pending, 1);
  server.write('fields', 't1', { name: 'Remoto' });
  server.setOffline(false);
  await sync.syncNow();
  assert.equal(server.rows.get('fields:t1').data.name, 'Local', 'a versão local foi enviada por último');
  assert.equal(sync.info().pending, 0);
  assert.ok(!received.some(r => r.data?.name === 'Remoto'));
});

test('ignora cadastros desconhecidos e não sincroniza sem fazenda', async () => {
  const server = fakeServer();
  globalThis.fetch = server.fetch;
  const db = memoryDb();
  const sync = createSync({ db, enabled: true, onRemote: () => {} });
  await sync.setServer('https://srv', 'anon');
  await sync.syncNow();
  assert.equal(server.calls.length, 0);
  await sync.queue('settings', { id: 'app' });
  assert.equal((await db.getAll('outbox')).length, 0);
});

test('mensagens de erro em português', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
  const sync = createSync({ db: memoryDb(), enabled: true, onRemote: () => {} });
  await sync.setServer('https://srv', 'anon');
  await assert.rejects(sync.signIn('a@b', 'x'), /E-mail ou senha incorretos/);
});
