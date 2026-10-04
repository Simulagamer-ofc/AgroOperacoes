// Armazenamento local: IndexedDB, com localStorage como alternativa se ele não abrir.
import { STORES } from './schemas.js';

// Guardados só neste aparelho: fila de alterações a enviar e estado da sincronização.
export const LOCAL_STORES = ['outbox', 'meta'];
const ALL_STORES = [...STORES, ...LOCAL_STORES];

const DB_NAME = 'agro-operacoes';
const DB_VERSION = 2;

const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const finished = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Gravação cancelada'));
});

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB indisponível')); return; }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      for (const store of ALL_STORES) if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store, { keyPath: 'id' });
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Banco de dados bloqueado por outra aba'));
    open.onsuccess = () => {
      const db = open.result;
      resolve({
        kind: 'IndexedDB',
        async loadAll() {
          const tx = db.transaction(STORES, 'readonly');
          const lists = await Promise.all(STORES.map(s => request(tx.objectStore(s).getAll())));
          return Object.fromEntries(STORES.map((s, i) => [s, lists[i]]));
        },
        async get(store, id) {
          return (await request(db.transaction(store, 'readonly').objectStore(store).get(id))) ?? null;
        },
        getAll(store) {
          return request(db.transaction(store, 'readonly').objectStore(store).getAll());
        },
        put(store, record) {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(record);
          return finished(tx);
        },
        remove(store, id) {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).delete(id);
          return finished(tx);
        },
        replaceAll(data) {
          const tx = db.transaction(STORES, 'readwrite');
          for (const store of STORES) {
            const os = tx.objectStore(store);
            os.clear();
            for (const record of data[store] || []) os.put(record);
          }
          return finished(tx);
        },
      });
    };
  });
}

function localStorageBackend() {
  const key = store => `agro-db:${store}`;
  const read = store => {
    try { const v = JSON.parse(localStorage.getItem(key(store)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const write = (store, list) => localStorage.setItem(key(store), JSON.stringify(list));
  return {
    kind: 'armazenamento simples do navegador',
    async loadAll() { return Object.fromEntries(STORES.map(s => [s, read(s)])); },
    async get(store, id) { return read(store).find(r => r.id === id) ?? null; },
    async getAll(store) { return read(store); },
    async put(store, record) { write(store, [...read(store).filter(r => r.id !== record.id), record]); },
    async remove(store, id) { write(store, read(store).filter(r => r.id !== id)); },
    async replaceAll(data) { for (const store of STORES) write(store, data[store] || []); },
  };
}

export async function openDatabase() {
  try { return await openIndexedDb(); } catch { return localStorageBackend(); }
}
