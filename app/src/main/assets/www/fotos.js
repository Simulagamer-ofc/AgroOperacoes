'use strict';
/* Nexus Agro — fotos nos registros (pragas, manutenção, inspeção).
   A foto é reduzida no aparelho (lado maior 1600 px, WebP com qualidade automática em todos os aparelhos, ~150–250 KB, mais uma miniatura de ~15 KB), guardada no próprio celular (IndexedDB) e enviada
   sozinha para a nuvem da fazenda quando houver internet (bucket privado “fotos”, só quem é da fazenda vê).
   O registro guarda só a lista de fotos (id e data); os outros aparelhos baixam a imagem quando alguém abre. */

const FOTOS_MAX = 6, FOTO_LADO = 1600, MINI_LADO = 320;
// Qualidade automática: começa alta e só desce (até 0,66, sem perda visível) se a foto passar de ~250 KB
const FOTO_ALVO = 250 * 1024, FOTO_QUALIDADES = [0.82, 0.76, 0.7, 0.66], MINI_QUALIDADE = 0.7;
const FOTO_DIAS_CHEIA = 60; // no celular, foto já enviada e sem uso há 60 dias fica só a miniatura (a inteira continua na nuvem)
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

// ---------- Redução da foto ----------
const blobDoCanvas = (c, tipo, q) => new Promise(ok => c.toBlob(b => ok(b), tipo, q));
// WebP (cerca de 30% menor que JPEG com a mesma nitidez). Android/Chrome geram WebP nativo; no iPhone (Safari não gera)
// o app usa o codificador WebP oficial (libwebp, Google) embutido em lib/webp, carregado só quando precisa.
// Só se nenhum dos dois funcionar a foto sai em JPEG.
let webpNativo = null, webpWasm = null;
async function blobWebp(c, q) {
  if (webpNativo !== false) {
    const b = await blobDoCanvas(c, 'image/webp', q);
    if (b?.type === 'image/webp') { webpNativo = true; return b; }
    webpNativo = false;
  }
  webpWasm ??= import(new URL('lib/webp/webp_enc.js', document.baseURI).href).then(m => m.default({noInitialRun: true})).catch(e => { webpWasm = null; throw e; });
  const mod = await webpWasm, d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const r = mod.encode(d.data, c.width, c.height, {...WEBP_OPCOES, quality: Math.round(q * 100)});
  if (!r) throw new Error('WebP falhou');
  return new Blob([r], {type: 'image/webp'});
}
// Mesmos ajustes do libwebp padrão (os que o Chrome usa)
const WEBP_OPCOES = {quality: 80, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0};
async function codificarFoto(c, qualidades, alvo) {
  let tipo = 'image/webp', cod = q => blobWebp(c, q), b = await cod(qualidades[0]).catch(() => null);
  if (!b) { tipo = 'image/jpeg'; cod = q => blobDoCanvas(c, tipo, q); b = await cod(qualidades[0]); }
  if (!b) throw new Error('Não foi possível converter a foto');
  for (const q of qualidades.slice(1)) { if (!alvo || b.size <= alvo) break; b = await cod(q).catch(() => null) || b; }
  return {blob: b, tipo, ext: tipo === 'image/webp' ? 'webp' : 'jpg'};
}
function canvasReduzido(img, lado) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, lado / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
}
// Foto do celular (3–8 MB) → foto de ~150–250 KB (lado maior 1600 px) + miniatura de ~15 KB para listas e relatórios
async function reduzirFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('Imagem inválida')); i.src = url; });
    const grande = canvasReduzido(img, FOTO_LADO), cheia = await codificarFoto(grande, FOTO_QUALIDADES, FOTO_ALVO);
    const mini = await codificarFoto(canvasReduzido(grande, MINI_LADO), [MINI_QUALIDADE]);
    return {...cheia, mini: mini.tipo === cheia.tipo ? mini.blob : null};
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Nuvem (Supabase Storage) ----------
// Caminho: fazenda/coleção/registro/foto.webp (miniatura: foto_m.webp). Fotos antigas, sem “ext”, são .jpg sem miniatura.
const caminhoFoto = (f, mini) => `${f.fazendaId || nv.fazenda.id}/${f.colecao}/${f.recordId}/${f.id}${mini ? '_m' : ''}.${f.ext || 'jpg'}`;
const nuvemFotosOk = () => typeof nvVinculado === 'function' && nvVinculado() && navigator.onLine !== false;
const cabecalhoFotos = () => ({apikey: NUVEM.chave, Authorization: 'Bearer ' + nv.sessao.access_token});
// 'ok' | 'parar' (sem conexão/sessão: tenta depois) | 'erro'
async function enviarArquivoFoto(caminho, blob, tipo) {
  const r = await fetch(`${NUVEM.url}/storage/v1/object/fotos/${caminho}`, {method: 'POST', headers: {...cabecalhoFotos(), 'Content-Type': tipo || 'image/jpeg'}, body: blob}).catch(() => null);
  if (!r || r.status === 401 || r.status === 403) return 'parar';
  return r.ok || r.status === 409 ? 'ok' : 'erro'; // 409 = já estava lá (envio anterior que não foi marcado)
}
async function enviarFotosPendentes() {
  if (!nuvemFotosOk() || enviarFotosPendentes.rodando) return;
  enviarFotosPendentes.rodando = true;
  try {
    await nvTokenValido();
    if (await apagarFotosDaFila() === 'parar') return;
    for (const f of await todasFotosLocais()) {
      if (f.mini && !f.miniEnviada && f.ext) {
        const st = await enviarArquivoFoto(caminhoFoto(f, true), f.mini, f.tipo); if (st === 'parar') break;
        if (st === 'ok') { f.miniEnviada = true; await guardarFotoLocal(f); }
      }
      if (!f.enviada && f.blob) {
        const st = await enviarArquivoFoto(caminhoFoto(f), f.blob, f.tipo); if (st === 'parar') break;
        if (st === 'ok') { f.enviada = true; await guardarFotoLocal(f); }
      }
    }
    await limparFotosLocais();
  } finally { enviarFotosPendentes.rodando = false; }
}
// Fotos a apagar da nuvem (foto removida ou registro excluído); fica na fila se estiver sem internet
const FILA_APAGAR = 'agro-fotos-apagar';
const filaApagar = () => { try { return JSON.parse(safeStorage.get(FILA_APAGAR) || '[]'); } catch { return []; } };
function apagarFotosDaNuvem(caminhos) {
  if (!caminhos.length) return;
  safeStorage.set(FILA_APAGAR, JSON.stringify([...new Set([...filaApagar(), ...caminhos])].slice(-500)));
  setTimeout(enviarFotosPendentes, 300);
}
async function apagarFotosDaFila() {
  const fila = filaApagar(); if (!fila.length) return 'ok';
  for (let i = 0; i < fila.length; i += 100) {
    const lote = fila.slice(i, i + 100);
    const r = await fetch(`${NUVEM.url}/storage/v1/object/fotos`, {method: 'DELETE', headers: {...cabecalhoFotos(), 'Content-Type': 'application/json'}, body: JSON.stringify({prefixes: lote})}).catch(() => null);
    if (!r || r.status === 401) return 'parar';
    // apagadas (ou sem permissão / já não existiam): sai da fila
    safeStorage.set(FILA_APAGAR, JSON.stringify(filaApagar().filter(c => !lote.includes(c))));
  }
  return 'ok';
}
// Dados da foto guardados no registro (formato, se tem miniatura)
function metaFoto(colecao, recordId, fotoId) {
  return find(colecao, recordId)?.fotos?.find(f => f.id === fotoId) || fotosDoForm.get(recordId)?.find(f => f.id === fotoId) || {};
}
async function baixarFoto(colecao, recordId, fotoId, mini = false) {
  if (!nuvemFotosOk()) return null;
  const m = metaFoto(colecao, recordId, fotoId), ref = {colecao, recordId, id: fotoId, ext: m.ext};
  if (mini && !m.mini) return null;
  await nvTokenValido();
  const r = await fetch(`${NUVEM.url}/storage/v1/object/authenticated/fotos/${caminhoFoto(ref, mini)}`, {headers: cabecalhoFotos()}).catch(() => null);
  if (!r?.ok) return null;
  const blob = await r.blob(), local = await fotoLocal(fotoId) || {id: fotoId, colecao, recordId, ext: m.ext, tipo: blob.type, fazendaId: nv.fazenda?.id, criadaEm: Date.now()};
  await guardarFotoLocal({...local, [mini ? 'mini' : 'blob']: blob, enviada: true, miniEnviada: true, usadaEm: Date.now()}).catch(() => {});
  return blob;
}
const urlsFotos = new Map();
// Listas e relatórios usam a miniatura; a foto inteira só é baixada quando alguém toca nela
async function urlDaFoto(colecao, recordId, fotoId, cheia = false) {
  const chave = fotoId + (cheia ? '' : '|m');
  if (urlsFotos.has(chave)) return urlsFotos.get(chave);
  const local = await fotoLocal(fotoId);
  const blob = cheia ? local?.blob || await baixarFoto(colecao, recordId, fotoId)
    : local?.mini || local?.blob || await baixarFoto(colecao, recordId, fotoId, true) || await baixarFoto(colecao, recordId, fotoId);
  if (!blob) return null;
  if (cheia && local?.blob) guardarFotoLocal({...local, usadaEm: Date.now()}).catch(() => {});
  const u = URL.createObjectURL(blob); urlsFotos.set(chave, u); return u;
}
// Limpeza do celular (1× por dia): fotos inteiras já enviadas e sem uso há 60 dias ficam só como miniatura;
// fotos de registros excluídos saem; foto tirada num formulário que nunca foi salvo sai depois de 7 dias.
async function limparFotosLocais(forcar = false) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!forcar && safeStorage.get('agro-fotos-limpeza') === hoje) return;
  safeStorage.set('agro-fotos-limpeza', hoje);
  const usadas = new Set(), pend = new Set([...fotosDoForm.values()].flat().map(f => f.id));
  (typeof COLLECTIONS !== 'undefined' ? COLLECTIONS : Object.keys(db)).forEach(c => (db[c] || []).forEach(r => (r.fotos || []).forEach(f => usadas.add(f.id))));
  const agora = Date.now(), dia = 864e5, fazenda = nv?.fazenda?.id;
  for (const f of await todasFotosLocais()) {
    if (pend.has(f.id)) continue;
    const idade = (agora - (f.usadaEm || f.criadaEm || 0)) / dia, minha = !f.fazendaId || !fazenda || f.fazendaId === fazenda;
    if (!usadas.has(f.id) && minha && (f.enviada || idade > 7)) { await apagarFotoLocal(f.id); urlsFotos.delete(f.id); urlsFotos.delete(f.id + '|m'); continue; }
    if (f.enviada && f.blob && idade > FOTO_DIAS_CHEIA) {
      if (f.mini) { delete f.blob; await guardarFotoLocal(f).catch(() => {}); } else await apagarFotoLocal(f.id);
      urlsFotos.delete(f.id);
    }
  }
}
setInterval(() => { if (document.visibilityState === 'visible') enviarFotosPendentes(); }, 120000);
addEventListener('online', () => setTimeout(enviarFotosPendentes, 1500));
addEventListener('DOMContentLoaded', () => setTimeout(() => { enviarFotosPendentes(); if (!nuvemFotosOk()) limparFotosLocais(); }, 4000));

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
    const red = await reduzirFoto(arq), id = uid();
    await guardarFotoLocal({id, colecao, recordId, blob: red.blob, mini: red.mini, tipo: red.tipo, ext: red.ext, fazendaId: nv?.fazenda?.id || null, enviada: false, miniEnviada: !red.mini, criadaEm: Date.now()});
    if (!fotosDoForm.has(recordId)) fotosDoForm.set(recordId, []);
    fotosDoForm.get(recordId).push({id, em: new Date().toISOString(), por: nv?.sessao?.usuario || '', ext: red.ext, ...(red.mini ? {mini: true} : {})});
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
  // Mostra a miniatura na hora e troca pela foto inteira quando ela chegar
  const previa = urlsFotos.get(fotoId) || urlsFotos.get(fotoId + '|m'), cheia = urlDaFoto(colecao, recordId, fotoId, true);
  const u = previa || await cheia;
  if (!u) { showToast('Foto ainda não disponível neste aparelho. Ela aparece quando houver internet e o envio terminar.', true); return; }
  const r = find(colecao, recordId), meta = r?.fotos?.find(f => f.id === fotoId);
  const pode = !meta || !r || meta.por === nv?.sessao?.usuario || typeof nvComum !== 'function' || !nvComum();
  const camada = Object.assign(document.createElement('div'), {className: 'foto-tela'});
  camada.innerHTML = `<img src="${u}" alt="Foto do registro"><div class="foto-tela-bts">${meta && pode ? '<button class="danger" data-rm>Remover foto</button>' : ''}<button class="secondary" data-fechar>Fechar</button></div>`;
  document.body.append(camada);
  if (u !== urlsFotos.get(fotoId)) { camada.classList.add('carregando'); cheia.then(c => { if (c) $('img', camada).src = c; camada.classList.remove('carregando'); }); }
  const fechar = () => camada.remove();
  camada.onclick = e => { if (e.target === camada) fechar(); };
  $('[data-fechar]', camada).onclick = fechar;
  const rm = $('[data-rm]', camada);
  if (rm) rm.onclick = () => { fechar(); confirmDialog('Remover esta foto do registro?', () => removerFoto(colecao, recordId, fotoId), 'Remover'); };
}
async function removerFoto(colecao, recordId, fotoId) {
  const r = find(colecao, recordId), meta = metaFoto(colecao, recordId, fotoId);
  if (r?.fotos) { r.fotos = r.fotos.filter(f => f.id !== fotoId); save(); }
  const pend = fotosDoForm.get(recordId); if (pend) fotosDoForm.set(recordId, pend.filter(f => f.id !== fotoId));
  $$(`.foto-mini[data-foto-id="${fotoId}"]`).forEach(el => el.remove());
  await apagarFotoLocal(fotoId); urlsFotos.delete(fotoId); urlsFotos.delete(fotoId + '|m');
  if (typeof nvVinculado === 'function' && nvVinculado()) apagarFotosDaNuvem(caminhosNuvem(colecao, recordId, meta, fotoId));
  showToast('Foto removida'); render();
}
const caminhosNuvem = (colecao, recordId, meta, id = meta.id) => { const ref = {colecao, recordId, id, ext: meta.ext}; return [caminhoFoto(ref), ...(meta.mini ? [caminhoFoto(ref, true)] : [])]; };
// Registro excluído: as fotos dele saem do celular e da nuvem (não fica arquivo órfão ocupando espaço)
function fotosAoExcluir(colecao, registros) {
  const caminhos = [];
  [].concat(registros).forEach(r => (r?.fotos || []).forEach(f => {
    apagarFotoLocal(f.id); urlsFotos.delete(f.id); urlsFotos.delete(f.id + '|m');
    if (typeof nvVinculado === 'function' && nvVinculado() && nv.fazenda?.id) caminhos.push(...caminhosNuvem(colecao, r.id, f));
  }));
  apagarFotosDaNuvem(caminhos);
}
