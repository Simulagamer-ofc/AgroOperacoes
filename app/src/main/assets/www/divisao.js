'use strict';
/* MercaPlant — Talhão dividido: uma parte com uma cultura, outra parte com outra.
   • "Dividir talhão" (ADM e supervisor): cada parte vira um talhão com a sua cultura, cultivar e área. Assim a operação,
     a aplicação, a colheita, a moega (produto pela cultura do talhão) e o relatório da safra ficam certos para cada parte.
   • Com contorno: toque em dois pontos da divisa no satélite (ou mais, se a divisa faz curva). A linha vai até a borda
     do talhão e corta o contorno em dois; a área de cada parte sai do contorno (elipsoide WGS 84, igual ao GPS).
   • Sem contorno: informe a área da parte A; a parte B fica com o resto.
   • A parte A continua sendo o talhão de antes (fica com as operações, colheitas e lotes já registrados);
     a parte B é um talhão novo, com a mesma safra e o histórico de culturas. Dá para dividir uma parte de novo.
   • "Juntar as partes": desfaz a divisão; o que foi lançado nas partes passa para o talhão inteiro.
   tdvCortar é pura (sem tela), testada em referencias/tests/divisao.test.js. */

// ---------- Geometria: corta o contorno com a linha da divisa ----------
/** Corta o polígono (pontos [lat, lon]) com a linha da divisa (2 ou mais pontos [lat, lon]).
 *  Cada ponta vai até a borda mais perto; entre os pontos tocados a linha não pode sair do talhão.
 *  Devolve {partes: [p1, p2]} (cada uma [lat, lon]) ou {erro}. */
function tdvCortar(pontos, corte) {
  let P = (pontos || []).map(([la, lo]) => [Number(la), Number(lo)]);
  if (P.length > 3 && P[0][0] === P.at(-1)[0] && P[0][1] === P.at(-1)[1]) P = P.slice(0, -1);
  const C = (corte || []).map(([la, lo]) => [Number(la), Number(lo)]);
  if (P.length < 3) return {erro: 'O talhão não tem contorno'};
  if (C.length < 2) return {erro: 'Toque em dois pontos da divisa'};
  // Plano local em metros, em volta do talhão
  const la0 = P.reduce((s, p) => s + p[0], 0) / P.length, lo0 = P.reduce((s, p) => s + p[1], 0) / P.length;
  const kx = 111320 * Math.cos(la0 * Math.PI / 180), ky = 110574;
  const xy = ([la, lo]) => [(lo - lo0) * kx, (la - la0) * ky], ll = ([x, y]) => [la0 + y / ky, lo0 + x / kx];
  const p = P.map(xy), c = C.map(xy);
  const longe = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], d = Math.hypot(dx, dy) || 1; return [a[0] + dx / d * 1e6, a[1] + dy / d * 1e6]; };
  if (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 0.5) return {erro: 'Os dois pontos da divisa estão no mesmo lugar'};
  const L = [longe(c[0], c[1]), ...c, longe(c.at(-1), c.at(-2))];
  // Cruzamentos da linha com os lados do contorno: s = posição na linha, pos = posição no contorno (lado + fração)
  const X = [], n = p.length;
  for (let j = 0; j < L.length - 1; j++) for (let i = 0; i < n; i++) {
    const [ax, ay] = L[j], [bx, by] = L[j + 1], [cx, cy] = p[i], [dx, dy] = p[(i + 1) % n];
    const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(den) < 1e-12) continue;
    const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, t = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    if (u < 0 || u > 1 || t < 0 || t >= 1) continue;
    X.push({s: j + u, pos: i + t, pt: [ax + u * (bx - ax), ay + u * (by - ay)]});
  }
  X.sort((a, b) => a.s - b.s);
  const unicos = X.filter((x, k) => !k || Math.hypot(x.pt[0] - X[k - 1].pt[0], x.pt[1] - X[k - 1].pt[1]) > 0.01);
  // Cada ponta vai só até a borda mais perto (e não até o fim do mundo): em talhão com recortes, a linha esticada
  // sairia e entraria de novo. Ponta tocada por fora do talhão: a divisa começa onde a linha entra.
  const dentro = ([x, y]) => { let d = false; for (let i = 0, j = n - 1; i < n; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; };
  const a = 1, b = c.length, eps = 1e-9;
  const x1 = dentro(c[0]) ? unicos.filter(x => x.s < a + eps).at(-1) : unicos.find(x => x.s >= a - eps);
  const x2 = dentro(c.at(-1)) ? unicos.find(x => x.s > b - eps) : unicos.filter(x => x.s <= b + eps).at(-1);
  if (!x1 || !x2 || x2.s <= x1.s + eps) return {erro: 'A linha não atravessa o talhão: toque nos pontos da divisa por dentro do contorno'};
  if (unicos.some(x => x.s > x1.s + eps && x.s < x2.s - eps)) return {erro: 'A divisa sai do talhão entre os pontos tocados: toque os pontos por dentro do talhão, seguindo a divisa (mais pontos nas curvas)'};
  const meio = L.slice(Math.floor(x1.s) + 1, Math.floor(x2.s) + 1);
  const dist = (a, b) => ((b - a) % n + n) % n;
  const cantos = (de, ate) => p.map((q, k) => [dist(de, k), q]).filter(([d]) => d > 1e-9 && d < dist(de, ate) - 1e-9).sort((a, b) => a[0] - b[0]).map(([, q]) => q);
  const p1 = [x1.pt, ...meio, x2.pt, ...cantos(x2.pos, x1.pos)], p2 = [x2.pt, ...meio.slice().reverse(), x1.pt, ...cantos(x1.pos, x2.pos)];
  if (p1.length < 3 || p2.length < 3) return {erro: 'A divisa passa só pela borda do talhão: toque mais para dentro'};
  const r7 = v => Math.round(v * 1e7) / 1e7;
  return {partes: [p1, p2].map(q => q.map(ll).map(([la, lo]) => [r7(la), r7(lo)]))};
}

// ---------- Tela ----------
let tdv = null; // {fieldId, corte: [[lat, lon]], troca, A: {name, crop, cultivar, area}, B: {...}}
const tdvGestor = () => typeof mcpGestor !== 'function' || mcpGestor();
const tdvTemContorno = f => f?.contorno?.pontos?.length > 2;
const tdvHa = pts => pts?.length > 2 && typeof areaGeodesicaM2 === 'function' ? areaGeodesicaM2(pts) / 1e4 : 0;
const tdvCor = c => typeof corCultura === 'function' ? corCultura(c) : '#9aa4ad';
/** Partes A e B com a área: pelo contorno cortado, ou pela área digitada (B = resto). */
function tdvPartes() {
  const f = find('fields', tdv.fieldId);
  if (!tdvTemContorno(f)) { const a = Number(tdv.A.area) || 0, tot = Number(f?.area) || 0; return {semContorno: true, haA: a, haB: Math.max(0, Math.round((tot - a) * 100) / 100), erro: a > 0 && a < tot ? '' : `Informe a área da parte A (menor que ${num(tot)} ha)`}; }
  if (tdv.corte.length < 2) return {erro: tdv.corte.length ? 'Toque no outro ponto da divisa' : 'Toque em dois pontos da divisa no mapa'};
  const r = tdvCortar(f.contorno.pontos, tdv.corte); if (r.erro) return r;
  const [pA, pB] = tdv.troca ? [r.partes[1], r.partes[0]] : r.partes;
  return {pA, pB, haA: tdvHa(pA), haB: tdvHa(pB)};
}
function tdvResumo() {
  const r = tdvPartes(), um = v => typeof um1 === 'function' ? um1(v) : num(v);
  const linha = (k, ha) => { const q = tdv[k]; return `<div class="tdv-res-l"><i style="background:${tdvCor(q.crop)}"></i><span><b>${k} • ${esc(q.name || '—')}</b><small>${esc([q.crop || 'sem cultura', q.cultivar].filter(Boolean).join(' • '))}</small></span><em>${ha > 0 ? um(ha) + ' ha' : '—'}</em></div>`; };
  return `${linha('A', r.haA)}${linha('B', r.haB)}${r.erro ? `<p class="tdv-erro">${esc(r.erro)}</p>` : ''}
    ${r.semContorno ? '' : `<div class="btn-row">${tdv.corte.length ? btn('Desfazer ponto', 'tdv-desfazer', '', 'secondary') + btn('Limpar divisa', 'tdv-limpar', '', 'secondary') : ''}${r.pA ? btn('Trocar A ↔ B', 'tdv-trocar', '', 'secondary') : ''}</div>`}`;
}
function tdvCampos(k, f, sem) {
  const q = tdv[k];
  return `<fieldset class="tdv-parte"><legend><i style="background:${tdvCor(q.crop)}" data-cor="${k}"></i>Parte ${k}${k === 'A' ? ' <small>fica com o histórico do talhão</small>' : ' <small>talhão novo</small>'}</legend>
    <div class="field"><label for="tdv${k}n">Nome</label><input id="tdv${k}n" class="tdv-campo" data-p="${k}" data-k="name" value="${esc(q.name)}" maxlength="60"></div>
    <div class="field"><label for="tdv${k}c">Cultura</label><input id="tdv${k}c" class="tdv-campo" data-p="${k}" data-k="crop" value="${esc(q.crop)}" list="tdvCulturas" placeholder="Ex.: Ervilhaca"></div>
    <div class="field"><label for="tdv${k}v">Cultivar (opcional)</label><input id="tdv${k}v" class="tdv-campo" data-p="${k}" data-k="cultivar" value="${esc(q.cultivar)}"></div>
    ${sem && k === 'A' ? `<div class="field"><label for="tdvAa">Área da parte A (ha)</label><input id="tdvAa" class="tdv-campo" data-p="A" data-k="area" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(q.area)}"></div>` : ''}
    ${sem && k === 'B' ? `<p class="nota">Área: o resto do talhão (${num(f.area)} ha − parte A).</p>` : ''}</fieldset>`;
}
VIEWS.dividir = id => {
  const f = find('fields', id); if (!f) return empty('Talhão não encontrado', '');
  const voltar = btn('← Talhão', 'nav', 'talhao/' + id, 'secondary');
  if (!tdvGestor()) return head('Dividir talhão', 'Só para o ADM e o supervisor.', voltar) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  if (!tdv || tdv.fieldId !== id) tdv = {fieldId: id, corte: [], troca: false, A: {name: `${f.name} A`, crop: f.crop || '', cultivar: f.cultivar || '', area: ''}, B: {name: `${f.name} B`, crop: '', cultivar: '', area: ''}};
  const sem = !tdvTemContorno(f);
  const culturas = `<datalist id="tdvCulturas">${(typeof culturasUsadas === 'function' ? culturasUsadas() : []).map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
  const painel = `<section class="card panel tdv-painel"><div id="tdvResumo">${tdvResumo()}</div>${tdvCampos('A', f, sem)}${tdvCampos('B', f, sem)}${culturas}
    <div class="btn-row">${btn('Salvar divisão', 'tdv-salvar')}${btn('Cancelar', 'tdv-cancelar', '', 'secondary')}</div></section>`;
  return head(`Dividir talhão — ${f.name}`, sem ? `${num(f.area)} ha sem contorno: informe a área de cada parte. Cada parte vira um talhão com a sua cultura.` : 'Toque em dois pontos da divisa entre as culturas (mais pontos se a divisa faz curva). A linha vai até a borda e corta o talhão em duas partes.', voltar) +
    (sem ? painel : `<div class="tm-desenho"><section class="card tm-caixa"><div class="tm-mapa" id="tdvMapa" aria-label="Mapa de satélite para marcar a divisa"></div>${typeof tmAvisoSemImagem === 'string' ? tmAvisoSemImagem : ''}</section>${painel}</div>`) +
    `<p class="nota">A parte A continua sendo o ${esc(f.name)}: as operações, colheitas e lotes já registrados ficam nela. A parte B começa limpa, com a mesma safra${f.season ? ` (${esc(f.season)})` : ''}. Depois, operação, colheita e moega são lançadas por parte.</p>`;
};
TITLES.dividir = 'Talhões';
function tdvDesenhar() {
  const L = window.L, mapa = tm?.mapa; if (!mapa || !tdv) return;
  (tdv.camadas || []).forEach(c => c.remove()); tdv.camadas = [];
  const r = tdvPartes(), add = c => { c.addTo(mapa); tdv.camadas.push(c); return c; };
  if (r.pA) [['A', r.pA, r.haA], ['B', r.pB, r.haB]].forEach(([k, pts, ha]) => {
    const cor = tdvCor(tdv[k].crop);
    add(L.polygon(pts, {color: '#fff', weight: 2, fillColor: cor, fillOpacity: 0.45, interactive: false}))
      .bindTooltip(`<b>${k}</b> • ${esc(tdv[k].crop || 'sem cultura')}<br>${um1(ha)} ha`, {permanent: true, direction: 'center', className: 'tm-rot'});
  });
  if (tdv.corte.length > 1) add(L.polyline(tdv.corte, {color: r.erro ? '#ff6b6b' : '#ffd400', weight: 3, dashArray: '6 6', interactive: false})); // vermelha: a divisa ainda não corta
  tdv.corte.forEach(pt => add(L.circleMarker(pt, {radius: 7, color: '#fff', weight: 2, fillColor: '#ffd400', fillOpacity: 1, interactive: false})));
  const el = $('#tdvResumo'); if (el) el.innerHTML = tdvResumo();
}
VIEWS.dividir.after = () => {
  const el = $('#tdvMapa'); if (!el || !tdv) return;
  carregarLeaflet().then(() => {
    if (!document.body.contains(el)) return;
    const L = window.L, mapa = tmNovoMapa(el), f = find('fields', tdv.fieldId); tdv.camadas = [];
    L.polygon(f.contorno.pontos.map(([la, lo]) => [la, lo]), {color: '#fff', weight: 2.5, fillColor: tdvCor(f.crop), fillOpacity: 0.12, interactive: false}).addTo(mapa);
    db.fields.filter(o => o.id !== f.id && tdvTemContorno(o)).forEach(o => L.polygon(o.contorno.pontos.map(([la, lo]) => [la, lo]), {color: '#fff', weight: 1, dashArray: '4 4', fillOpacity: 0.05, interactive: false})
      .bindTooltip(esc(o.name), {permanent: true, direction: 'center', className: 'tm-rot fraco'}).addTo(mapa));
    tmEnquadrar(mapa, [f.contorno.pontos]);
    mapa.on('click', e => { tdv.corte.push([e.latlng.lat, e.latlng.lng]); tdvDesenhar(); });
    tdvDesenhar();
    setTimeout(() => { if (tm.mapa === mapa && document.body.contains(el)) mapa.invalidateSize(); }, 50);
  }).catch(() => { el.innerHTML = '<p class="viz-vazio">Não foi possível abrir o mapa.</p>'; });
};
// Digitar no painel não redesenha a tela (o teclado não fecha); a cor e o resumo acompanham
document.addEventListener('input', e => {
  const el = e.target.closest?.('.tdv-campo'); if (!el || !tdv) return;
  tdv[el.dataset.p][el.dataset.k] = el.value;
  if (el.dataset.k === 'area') { const r = $('#tdvResumo'); if (r) r.innerHTML = tdvResumo(); }
});
document.addEventListener('change', e => {
  const el = e.target.closest?.('.tdv-campo'); if (!el || !tdv) return;
  if (el.dataset.k === 'crop' && typeof culturaCanon === 'function') { el.value = tdv[el.dataset.p].crop = culturaCanon(el.value); const i = $(`[data-cor="${el.dataset.p}"]`); if (i) i.style.background = tdvCor(el.value); }
  if (tm?.mapa && $('#tdvMapa')) tdvDesenhar(); else { const r = $('#tdvResumo'); if (r) r.innerHTML = tdvResumo(); }
});

/** Grava a divisão: A = o talhão de antes (mesmo id), B = talhão novo. */
function tdvAplicar(f, r) {
  const hoje = today(), raiz = f.parteDe || {id: f.id, nome: f.name, area: Number(f.area) || 0, em: hoje};
  const ctn = pts => ({pontos: pts.map(([la, lo]) => [la, lo, 0]), areaHa: Math.round(tdvHa(pts) * 1e4) / 1e4, perimetroM: Math.round(perimetroM(pts)), data: hoje, origem: 'divisão'});
  const parte = (q, base) => {
    const crop = typeof culturaCanon === 'function' ? culturaCanon(q.crop) : q.crop.trim(), igual = typeof culturaNorm === 'function' ? culturaNorm(crop) === culturaNorm(f.crop) : crop === f.crop;
    return {...base, name: q.name.trim(), crop, cultivar: String(q.cultivar || '').trim(), ciclo: igual ? f.ciclo || '' : ''};
  };
  const antes = f.contorno;
  const A = parte(tdv.A, {...f}), B = parte(tdv.B, {id: uid(), season: f.season || '', plantingDate: f.plantingDate || '', historico: (f.historico || []).map(h => ({...h})), notes: ''});
  A.area = Math.round(r.haA * 100) / 100; B.area = Math.round(r.haB * 100) / 100;
  A.parteDe = {...raiz, id: raiz.id, ...(f.parteDe ? {} : {contornoInteiro: antes || null})}; B.parteDe = {id: raiz.id, nome: raiz.nome, em: hoje};
  if (r.pA) { A.contorno = ctn(r.pA); B.contorno = ctn(r.pB); }
  upsert('fields', A); db.fields.push(B);
  if (r.pA && typeof trvDepoisDeSalvar === 'function') { trvDepoisDeSalvar(find('fields', A.id), antes); const nb = find('fields', B.id); if (nb?.contorno) nb.contorno.por = A.contorno?.por; }
  save();
  return {A, B};
}
Object.assign(ACTIONS, {
  'tdv-desfazer': () => { if (!tdv) return; tdv.corte.pop(); tdvDesenhar(); },
  'tdv-limpar': () => { if (!tdv) return; tdv.corte = []; tdv.troca = false; tdvDesenhar(); },
  'tdv-trocar': () => { if (!tdv) return; tdv.troca = !tdv.troca; tdvDesenhar(); },
  'tdv-cancelar': () => { const id = tdv?.fieldId; tdv = null; go(id ? 'talhao/' + id : 'talhoes'); },
  'tdv-salvar': () => {
    if (!tdv || !tdvGestor()) return;
    const f = find('fields', tdv.fieldId); if (!f) return;
    const r = tdvPartes(); if (r.erro) return showToast(r.erro, true);
    const nA = String(tdv.A.name || '').trim(), nB = String(tdv.B.name || '').trim(), mesmo = (a, b) => a.toLowerCase() === b.toLowerCase();
    if (!nA || !nB) return showToast('Dê um nome para cada parte', true);
    if (mesmo(nA, nB)) return showToast('As duas partes estão com o mesmo nome', true);
    const dup = db.fields.find(o => o.id !== f.id && (mesmo(String(o.name || ''), nA) || mesmo(String(o.name || ''), nB)));
    if (dup) return showToast(`Já existe um talhão chamado ${dup.name}`, true);
    if (!String(tdv.A.crop || '').trim() || !String(tdv.B.crop || '').trim()) return showToast('Informe a cultura de cada parte', true);
    if (!(r.haA > 0 && r.haB > 0)) return showToast('Cada parte precisa ter área', true);
    if (r.pA && typeof trvTrancado === 'function' && trvTrancado(f.id)) { trvPedir(f.id, () => ACTIONS['tdv-salvar']()); return; }
    const um = v => um1(v);
    confirmDialog(`Dividir ${f.name} em ${nA} (${um(r.haA)} ha, ${tdv.A.crop}) e ${nB} (${um(r.haB)} ha, ${tdv.B.crop})? O que já foi registrado no talhão fica na parte A.`, () => {
      const {A, B} = tdvAplicar(f, r); tdv = null;
      showToast(`Talhão dividido: ${A.name} e ${B.name}`);
      go('talhao/' + A.id);
    }, 'Dividir');
  }
});
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.dividir = 'talhoes';

// ---------- Juntar as partes (desfaz a divisão) ----------
// As partes voltam a ser um talhão só: o de antes (mesmo id), com o contorno inteiro guardado na divisão.
// O que foi lançado nas outras partes (operações, aplicações, colheitas, lotes, cargas, gastos, chuva) passa para ele;
// a colheita de cada parte continua com a cultura dela (fica certo no relatório da safra).
const tdvPartesDe = f => f?.parteDe ? db.fields.filter(o => o.parteDe?.id === f.parteDe.id) : [];
/** Troca o talhão em todos os registros (em qualquer coleção, também dentro de listas): de → para. Devolve quantos. */
function tdvTrocarTalhao(dados, de, para) {
  let n = 0;
  const andar = (v, nivel) => {
    if (!v || typeof v !== 'object' || nivel > 5) return;
    if (Array.isArray(v)) { v.forEach(x => andar(x, nivel + 1)); return; }
    if (v.fieldId === de) { v.fieldId = para; n++; }
    Object.values(v).forEach(x => { if (x && typeof x === 'object') andar(x, nivel + 1); });
  };
  Object.entries(dados).forEach(([k, v]) => { if (k !== 'fields' && Array.isArray(v)) andar(v, 0); });
  return n;
}
function tdvJuntar(id) {
  const f = find('fields', id), partes = tdvPartesDe(f); if (!f || partes.length < 2) return showToast('Este talhão não está dividido', true);
  if (!tdvGestor()) return showToast('Só o ADM e o supervisor juntam as partes', true);
  const raiz = f.parteDe, base = partes.find(o => o.id === raiz.id) || partes.slice().sort((a, b) => (Number(b.area) || 0) - (Number(a.area) || 0))[0];
  const inteiro = base.parteDe?.contornoInteiro || null;
  if (typeof trvTrancado === 'function' && trvTrancado(base.id)) { trvPedir(base.id, () => tdvJuntar(id)); return; }
  const area = Math.round(partes.reduce((s, o) => s + (Number(o.area) || 0), 0) * 100) / 100;
  const pousio = c => typeof culturaNorm === 'function' ? culturaNorm(c) === 'pousio' : /^pousio$/i.test(String(c || '').trim());
  const maior = partes.filter(o => o.crop && !pousio(o.crop)).sort((a, b) => (Number(b.area) || 0) - (Number(a.area) || 0))[0] || base;
  openForm({title: `Juntar as partes — ${raiz.nome}`,
    sub: `${partes.map(o => `${o.name} (${num(o.area)} ha, ${o.crop || 'sem cultura'})`).join(' + ')} voltam a ser um talhão só, com ${num(area)} ha${inteiro ? ' e o contorno de antes da divisão' : ''}. O que foi lançado nas partes (operações, aplicações, colheitas, lotes, cargas e gastos) passa para o talhão; a colheita de cada parte continua com a cultura dela.`,
    values: {name: raiz.nome, crop: maior.crop || '', cultivar: maior.cultivar || ''},
    fields: [{k: 'name', label: 'Nome do talhão', required: true, full: true},
      {k: 'crop', label: 'Cultura do talhão inteiro', sugestoes: () => typeof culturasUsadas === 'function' ? culturasUsadas() : [], canon: true},
      {k: 'cultivar', label: 'Cultivar'}],
    submit: 'Juntar as partes',
    onSubmit: v => {
      const nome = String(v.name || '').trim(); if (!nome) return 'Informe o nome do talhão';
      const dup = db.fields.find(o => !partes.some(p => p.id === o.id) && String(o.name || '').toLowerCase() === nome.toLowerCase());
      if (dup) return `Já existe um talhão chamado ${dup.name}`;
      const antes = base.contorno, outras = partes.filter(o => o.id !== base.id);
      const movidos = outras.reduce((s, o) => s + tdvTrocarTalhao(db, o.id, base.id), 0);
      const crop = typeof culturaCanon === 'function' ? culturaCanon(v.crop) : String(v.crop || '').trim();
      const novo = {...base, name: nome, crop, cultivar: String(v.cultivar || '').trim(), area};
      if (typeof culturaNorm === 'function' ? culturaNorm(crop) !== culturaNorm(base.crop) : crop !== base.crop) novo.ciclo = '';
      if (inteiro) novo.contorno = {...inteiro}; else delete novo.contorno; // sem o contorno de antes guardado: desenhe de novo
      delete novo.parteDe;
      outras.forEach(o => remove('fields', o.id));
      upsert('fields', novo);
      if (inteiro && typeof trvDepoisDeSalvar === 'function') trvDepoisDeSalvar(find('fields', base.id), antes);
      save();
      showToast(`${nome}: partes juntas (${num(area)} ha)${movidos ? ` • ${movidos} ${movidos === 1 ? 'registro passou' : 'registros passaram'} para o talhão` : ''}`);
      setTimeout(() => go('talhao/' + base.id), 0);
    }});
}
ACTIONS['tdv-juntar'] = id => tdvJuntar(id);
