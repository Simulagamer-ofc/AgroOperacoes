/* Culturas dos talhões
   • Lista padrão de culturas (com a cor do mapa); o que for digitado igual a uma delas (sem acento/maiúscula) é gravado igual.
   • "Definir culturas" no mapa da tela inicial (ADM e supervisor): escolhe a cultura e toca nos talhões para pintar;
     safra e cultivar opcionais para os marcados; salva tudo de uma vez.
   • Histórico: ao mudar a safra de um talhão, a cultura anterior fica guardada (rotação: Soja 25/26 → Trigo 2026 → Soja 26/27). */
const CULTURAS = [['Soja', '#3fa45b'], ['Milho', '#e0b23a'], ['Trigo', '#c98a3c'], ['Aveia', '#9cbf5a'], ['Feijão', '#a0623a'], ['Canola', '#e3d24a'],
  ['Cevada', '#d6a85c'], ['Trigo mourisco', '#b07ab8'], ['Arroz', '#5fb7c9'], ['Sorgo', '#c45a3a'], ['Azevém', '#7fbf8f'], ['Nabo forrageiro', '#8f7fd1'], ['Pousio', '#9aa4ad']];
if (typeof I2_COR_CULT !== 'undefined') CULTURAS.forEach(([c, cor]) => { I2_COR_CULT[c] = cor; });
// Uma cor por cultura em todo o sistema (mapa do início, mapa de talhões, desenho e lista de talhões)
const CULTURAS_EXTRA = ['#4d8fd6', '#d16b8a', '#7a6fd1', '#4fb3a0', '#c77d2e', '#5c9e3a'];
function corCultura(c) {
  const t = String(c || '').trim(); if (!t) return '#9aa4ad';
  const k = culturaNorm(t), padrao = CULTURAS.find(([n]) => culturaNorm(n) === k);
  return padrao ? padrao[1] : CULTURAS_EXTRA[[...k].reduce((s, ch) => s + ch.charCodeAt(0), 0) % CULTURAS_EXTRA.length];
}
const culturaNorm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Lista padrão + culturas já usadas nos talhões (sem repetir grafias)
function culturasUsadas() {
  const out = [], vistos = new Set(), add = c => { const t = String(c || '').trim(), k = culturaNorm(t); if (t && !vistos.has(k)) { vistos.add(k); out.push(t); } };
  CULTURAS.forEach(([c]) => add(c)); (db.fields || []).forEach(f => { add(f.crop); (f.historico || []).forEach(h => add(h.crop)); });
  return out;
}
const culturaCanon = t => { const r = String(t || '').trim(); return r ? culturasUsadas().find(c => culturaNorm(c) === culturaNorm(r)) || r : ''; };
const safrasUsadas = () => [...new Set((db.fields || []).flatMap(f => [f.season, ...(f.historico || []).map(h => h.season)]).map(s => String(s || '').trim()).filter(Boolean))].sort().reverse();
// Ao trocar de safra, a cultura da safra anterior vai para o histórico do talhão
function culturaHistorico(antigo, novo) {
  const h = (antigo.historico || []).slice(), sa = String(antigo.season || '').trim(), sn = String(novo.season || '').trim();
  if (antigo.crop && sa !== sn && !h.some(x => x.season === sa && culturaNorm(x.crop) === culturaNorm(antigo.crop)))
    h.push({season: sa, crop: antigo.crop, cultivar: antigo.cultivar || '', plantingDate: antigo.plantingDate || '', ate: today()});
  return h.slice(-12);
}
const rotacaoTalhao = f => [...(f.historico || []), {season: f.season, crop: f.crop}].filter(x => x.crop).slice(-4).map(x => `${x.crop}${x.season ? ' ' + x.season : ''}`);

// ---------- Definir culturas no mapa ----------
let cuPintar = null; // {sel, mud: {fieldId: cultura}, safra, cultivar, outra}
const cuSafraPadrao = () => { const c = {}; (db.fields || []).forEach(f => { const s = String(f.season || '').trim(); if (s) c[s] = (c[s] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a] || b.localeCompare(a))[0] || ''; };
const cuCulturaDe = f => (cuPintar && cuPintar.mud[f.id]) || f.crop || '';
function cuPaleta() {
  const lista = culturasUsadas(), sel = cuPintar.sel;
  return `<div class="cu-paleta" role="radiogroup" aria-label="Cultura para pintar">${lista.map(c => `<button type="button" role="radio" aria-checked="${c === sel}" class="${c === sel ? 'on' : ''}" data-act="cu-sel" data-id="${esc(c)}"><i style="background:${i2CorCult(c)}"></i>${esc(c)}</button>`).join('')}
    <span class="cu-outra"><input class="cu-campo" data-k="outra" placeholder="Outra cultura…" value="${esc(cuPintar.outra || '')}" aria-label="Outra cultura"></span></div>`;
}
function cuPainel(fs) {
  const n = Object.keys(cuPintar.mud).length;
  return `<div class="cu-painel"><div class="cu-tit"><b>Definir culturas</b><small>Escolha a cultura e toque nos talhões, no mapa ou aqui na lista.</small></div>
    <div class="cu-campos"><label>Safra<input class="cu-campo" data-k="safra" list="cuSafras" value="${esc(cuPintar.safra)}" placeholder="Ex.: 2026/27 ou 2026"></label>
      <label>Cultivar (opcional)<input class="cu-campo" data-k="cultivar" value="${esc(cuPintar.cultivar)}" placeholder="Ex.: BMX Zeus"></label>
      <datalist id="cuSafras">${safrasUsadas().map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
    <div class="cu-lista">${fs.map(f => { const novo = cuPintar.mud[f.id], mudou = novo !== undefined;
      return `<button type="button" class="cu-l ${mudou ? 'mudou' : ''}" data-act="i2-tal" data-id="${esc(f.id)}"><i style="background:${i2CorCult(cuCulturaDe(f))}"></i><span><b>${esc(f.name)}</b><small>${num(f.area)} ha${f.contorno?.pontos?.length > 2 ? '' : ' • sem contorno'}</small></span>
        <em>${mudou ? `${esc(f.crop || '—')} → <b>${esc(novo)}</b>` : esc(f.crop || 'Sem cultura')}</em></button>`; }).join('')}</div>
    <div class="cu-bts"><button type="button" class="primary" data-act="cu-salvar" ${n ? '' : 'disabled'}>Salvar${n ? ` (${n})` : ''}</button><button type="button" class="secondary" data-act="cu-cancelar">Cancelar</button></div></div>`;
}
// Mapa: no modo de definir, pinta com a cultura nova e destaca os talhões marcados
if (typeof i2Pintura === 'function') {
  const _pintura = i2Pintura;
  i2Pintura = function (f, inf, modo) {
    if (cuPintar && modo === 'cultura') { const c = cuCulturaDe(f), m = cuPintar.mud[f.id] !== undefined; return {cor: i2CorCult(c), op: m ? .72 : .3, txt: c || 'Sem cultura', muda: m}; }
    return _pintura(f, inf, modo);
  };
}
document.addEventListener('input', e => { const el = e.target.closest?.('.cu-campo'); if (!el || !cuPintar) return; cuPintar[el.dataset.k] = el.value; });
document.addEventListener('change', e => {
  const el = e.target.closest?.('.cu-campo'); if (!el || !cuPintar) return;
  if (el.dataset.k === 'outra' && el.value.trim()) { cuPintar.sel = culturaCanon(el.value); cuPintar.outra = ''; i2AtualizarFazenda(); }
});
ACTIONS['cu-pintar'] = () => { cuPintar = {sel: CULTURAS[0][0], mud: {}, safra: cuSafraPadrao(), cultivar: '', outra: ''}; i2TalSel = ''; i2AtualizarFazenda(); };
ACTIONS['cu-sel'] = c => { if (!cuPintar) return; cuPintar.sel = c; i2AtualizarFazenda(); };
ACTIONS['cu-cancelar'] = () => { cuPintar = null; i2AtualizarFazenda(); };
{
  const _tal = ACTIONS['i2-tal'];
  ACTIONS['i2-tal'] = id => {
    if (!cuPintar) return _tal(id);
    if (!id) return;
    if (cuPintar.mud[id] === cuPintar.sel) delete cuPintar.mud[id]; else cuPintar.mud[id] = cuPintar.sel;
    i2AtualizarFazenda();
  };
}
ACTIONS['cu-salvar'] = () => {
  if (!cuPintar) return;
  const safra = String(cuPintar.safra || '').trim(), cultivar = String(cuPintar.cultivar || '').trim(); let n = 0;
  Object.entries(cuPintar.mud).forEach(([id, crop]) => {
    const f = find('fields', id); if (!f) return;
    const novaSafra = safra && safra !== String(f.season || '').trim(), trocou = culturaNorm(crop) !== culturaNorm(f.crop);
    const novo = {...f, crop: culturaCanon(crop)};
    if (safra) novo.season = safra;
    // Safra nova: o plantio, o ciclo e a cultivar da safra anterior ficam no histórico
    if (novaSafra) { novo.plantingDate = ''; novo.ciclo = ''; novo.cultivar = ''; }
    else if (trocou) { novo.cultivar = ''; novo.ciclo = ''; }
    if (cultivar) novo.cultivar = cultivar;
    novo.historico = culturaHistorico(f, novo);
    upsert('fields', novo); n++;
  });
  cuPintar = null;
  showToast(n === 1 ? 'Cultura do talhão salva' : `Culturas de ${n} talhões salvas`);
  render();
};
