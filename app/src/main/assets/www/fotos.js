'use strict';
/* Nexus Agro — fotos nos registros (pragas, manutenção, inspeção).
   A foto é reduzida no aparelho (lado maior 1600 px, JPEG ~80%), guardada no próprio celular (IndexedDB) e enviada
   sozinha para a nuvem da fazenda quando houver internet (bucket privado “fotos”, só quem é da fazenda vê).
   O registro guarda só a lista de fotos (id e data); os outros aparelhos baixam a imagem quando alguém abre. */

const FOTOS_MAX = 6, FOTO_LADO = 1600, FOTO_QUALIDADE = 0.8;
let fotosBanco = null;
function bancoFotos() {
  fotosBanco ??= new Promise((ok, erro) => {
    if (!('indexedDB' in window)) return erro(new Error('Este aparelho não guarda fotos'));
    const r = indexedDB.open('agro-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', {keyPath: 'id'});
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  }).catch(e => { fotosBanco = null; throw e; });
  return fotosBanco;
}
async function fotoTx(modo, fn) { const b = await bancoFotos(); return new Promise((ok, erro) => { const t = b.transaction('fotos', modo), r = fn(t.objectStore('fotos')); t.oncomplete = () => ok(r?.result); t.onerror = () => erro(t.error); }); }
const fotoLocal = id => fotoTx('readonly', s => s.get(id)).catch(() => null);
const guardarFotoLocal = f => fotoTx('readwrite', s => s.put(f));
const apagarFotoLocal = id => fotoTx('readwrite', s => s.delete(id)).catch(() => {});
const todasFotosLocais = () => fotoTx('readonly', s => s.getAll()).catch(() => []);

// Reduz a imagem (fotos do celular têm 3–8 MB) e devolve um JPEG
async function reduzirFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('Imagem inválida')); i.src = url; });
    const k = Math.min(1, FOTO_LADO / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, erro) => c.toBlob(b => b ? ok(b) : erro(new Error('Não foi possível converter a foto')), 'image/jpeg', FOTO_QUALIDADE));
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Nuvem (Supabase Storage) ----------
const caminhoFoto = f => `${nv.fazenda.id}/${f.colecao}/${f.recordId}/${f.id}.jpg`;
async function enviarFotosPendentes() {
  if (typeof nvVinculado !== 'function' || !nvVinculado() || navigator.onLine === false || enviarFotosPendentes.rodando) return;
  enviarFotosPendentes.rodando = true;
  try {
    for (const f of (await todasFotosLocais()).filter(x => !x.enviada && x.blob)) {
      await nvTokenValido();
      const r = await fetch(`${NUVEM.url}/storage/v1/object/fotos/${caminhoFoto(f)}`, {method: 'POST', headers: {apikey: NUVEM.chave, Authorization: 'Bearer ' + nv.sessao.access_token, 'Content-Type': 'image/jpeg'}, body: f.blob}).catch(() => null);
      if (!r) break; // sem conexão: tenta depois
      // 200 = enviada; 409 = já estava lá (envio anterior que não foi marcado)
      if (r.ok || r.status === 409) { f.enviada = true; await guardarFotoLocal(f); }
      else if (r.status === 401 || r.status === 403) break;
    }
  } finally { enviarFotosPendentes.rodando = false; }
}
async function baixarFoto(colecao, recordId, fotoId) {
  if (typeof nvVinculado !== 'function' || !nvVinculado() || navigator.onLine === false) return null;
  await nvTokenValido();
  const r = await fetch(`${NUVEM.url}/storage/v1/object/authenticated/fotos/${caminhoFoto({colecao, recordId, id: fotoId})}`, {headers: {apikey: NUVEM.chave, Authorization: 'Bearer ' + nv.sessao.access_token}}).catch(() => null);
  if (!r?.ok) return null;
  const blob = await r.blob();
  await guardarFotoLocal({id: fotoId, colecao, recordId, blob, enviada: true}).catch(() => {});
  return blob;
}
const urlsFotos = new Map();
async function urlDaFoto(colecao, recordId, fotoId) {
  if (urlsFotos.has(fotoId)) return urlsFotos.get(fotoId);
  const blob = (await fotoLocal(fotoId))?.blob || await baixarFoto(colecao, recordId, fotoId);
  if (!blob) return null;
  const u = URL.createObjectURL(blob); urlsFotos.set(fotoId, u); return u;
}
setInterval(() => { if (document.visibilityState === 'visible') enviarFotosPendentes(); }, 120000);
addEventListener('online', () => setTimeout(enviarFotosPendentes, 1500));
addEventListener('DOMContentLoaded', () => setTimeout(enviarFotosPendentes, 4000));

// ---------- Campo de fotos dentro dos formulários ----------
// As fotos novas ficam aqui até o registro ser salvo (aí entram na lista “fotos” do registro)
const fotosDoForm = new Map(); // recordId → [{id, em}]
function campoFotos(colecao, recordId, atuais = []) {
  if (!fotosDoForm.has(recordId)) fotosDoForm.set(recordId, []);
  atuais = [...atuais, ...fotosDoForm.get(recordId).filter(f => !atuais.some(a => a.id === f.id))];
  return `<div class="field full fotos-campo" data-fotos="${esc(colecao)}|${esc(recordId)}"><label>Fotos <small>(opcional, até ${FOTOS_MAX})</small></label>
    <div class="fotos-lista">${atuais.map(f => `<span class="foto-mini" data-foto-id="${esc(f.id)}"></span>`).join('')}</div>
    <label class="foto-add secondary"><input type="file" accept="image/*" capture="environment" hidden data-foto-input> 📷 Adicionar foto</label></div>`;
}
// Encaixa o campo de fotos num formulário já aberto (antes dos botões)
function anexarCampoFotos(colecao, recordId, atuais = []) {
  const form = $('form', dialog); if (!form) return;
  (form.querySelector('.form') || form).insertAdjacentHTML('beforeend', campoFotos(colecao, recordId, atuais));
  ativarCamposFotos(dialog);
}
function ativarCamposFotos(raiz = document) { raiz.querySelectorAll('.fotos-campo').forEach(box => { const [c, id] = box.dataset.fotos.split('|'); carregarMiniaturas(box, c, id); }); }
// Foto escolhida/tirada: reduz, guarda no aparelho e mostra a miniatura
document.addEventListener('change', async e => {
  if (!e.target.matches?.('[data-foto-input]')) return;
  const box = e.target.closest('.fotos-campo'), [colecao, recordId] = box.dataset.fotos.split('|');
  const arq = e.target.files?.[0]; e.target.value = ''; if (!arq) return;
  if (box.querySelectorAll('.foto-mini').length >= FOTOS_MAX) { showToast(`No máximo ${FOTOS_MAX} fotos por registro`, true); return; }
  try {
    const blob = await reduzirFoto(arq), id = uid();
    await guardarFotoLocal({id, colecao, recordId, blob, enviada: false, criadaEm: Date.now()});
    if (!fotosDoForm.has(recordId)) fotosDoForm.set(recordId, []);
    fotosDoForm.get(recordId).push({id, em: new Date().toISOString(), por: nv?.sessao?.usuario || ''});
    $('.fotos-lista', box).insertAdjacentHTML('beforeend', `<span class="foto-mini nova" data-foto-id="${esc(id)}"></span>`);
    carregarMiniaturas(box, colecao, recordId);
  } catch (err) { showToast(err.message || 'Não foi possível usar esta foto', true); }
});
async function carregarMiniaturas(box, colecao, recordId) {
  for (const el of box.querySelectorAll('.foto-mini:not([data-ok])')) {
    el.dataset.ok = '1';
    const u = await urlDaFoto(colecao, recordId, el.dataset.fotoId);
    if (u) el.style.backgroundImage = `url("${u}")`; else { el.classList.add('sem'); el.title = 'Foto ainda não disponível neste aparelho (sem internet ou não enviada)'; }
    el.onclick = () => verFoto(colecao, recordId, el.dataset.fotoId);
  }
}
// Chamado depois de salvar o registro: junta as fotos novas ao registro e tenta enviar
function fotosAoSalvar(colecao, recordId) {
  const novas = fotosDoForm.get(recordId) || []; fotosDoForm.delete(recordId);
  if (!novas.length) return;
  const r = find(colecao, recordId); if (!r) return;
  r.fotos = [...(r.fotos || []), ...novas]; save();
  setTimeout(enviarFotosPendentes, 500);
}
// Miniaturas num relatório ou lista (só leitura; toque amplia)
function galeriaFotos(colecao, r) {
  if (!r?.fotos?.length) return '';
  return `<div class="fotos-galeria" data-fotos-gal="${esc(colecao)}|${esc(r.id)}">${r.fotos.map(f => `<span class="foto-mini" data-foto-id="${esc(f.id)}"></span>`).join('')}</div>`;
}
const contFotos = r => r?.fotos?.length ? ` • 📷 ${r.fotos.length}` : '';
// Depois de desenhar uma tela: carrega as miniaturas das galerias
function ativarGalerias(raiz = document) { raiz.querySelectorAll('[data-fotos-gal]').forEach(g => { const [c, id] = g.dataset.fotosGal.split('|'); carregarMiniaturas(g, c, id); }); }
const renderSemFotos = render;
render = function (...a) { const r = renderSemFotos.apply(this, a); setTimeout(() => { ativarGalerias(view); ativarCamposFotos(view); }, 0); return r; };

async function verFoto(colecao, recordId, fotoId) {
  const u = await urlDaFoto(colecao, recordId, fotoId);
  if (!u) { showToast('Foto ainda não disponível neste aparelho. Ela aparece quando houver internet e o envio terminar.', true); return; }
  const r = find(colecao, recordId), meta = r?.fotos?.find(f => f.id === fotoId);
  const pode = !meta || !r || meta.por === nv?.sessao?.usuario || typeof nvComum !== 'function' || !nvComum();
  const camada = Object.assign(document.createElement('div'), {className: 'foto-tela'});
  camada.innerHTML = `<img src="${u}" alt="Foto do registro"><div class="foto-tela-bts">${meta && pode ? '<button class="danger" data-rm>Remover foto</button>' : ''}<button class="secondary" data-fechar>Fechar</button></div>`;
  document.body.append(camada);
  const fechar = () => camada.remove();
  camada.onclick = e => { if (e.target === camada) fechar(); };
  $('[data-fechar]', camada).onclick = fechar;
  const rm = $('[data-rm]', camada);
  if (rm) rm.onclick = () => { fechar(); confirmDialog('Remover esta foto do registro?', () => removerFoto(colecao, recordId, fotoId), 'Remover'); };
}
async function removerFoto(colecao, recordId, fotoId) {
  const r = find(colecao, recordId);
  if (r?.fotos) { r.fotos = r.fotos.filter(f => f.id !== fotoId); save(); }
  const pend = fotosDoForm.get(recordId); if (pend) fotosDoForm.set(recordId, pend.filter(f => f.id !== fotoId));
  $$(`.foto-mini[data-foto-id="${fotoId}"]`).forEach(el => el.remove());
  await apagarFotoLocal(fotoId);
  if (typeof nvVinculado === 'function' && nvVinculado() && navigator.onLine !== false) {
    try { await nvTokenValido(); await fetch(`${NUVEM.url}/storage/v1/object/fotos/${caminhoFoto({colecao, recordId, id: fotoId})}`, {method: 'DELETE', headers: {apikey: NUVEM.chave, Authorization: 'Bearer ' + nv.sessao.access_token}}); } catch { /* fica na nuvem até a próxima limpeza */ }
  }
  showToast('Foto removida'); render();
}
