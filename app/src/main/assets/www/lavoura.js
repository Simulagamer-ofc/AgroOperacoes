'use strict';
/* MercaPlant — Avaliações da lavoura (agrônomo e produtor): estande de plantas e estimativa de produtividade.
   Contas feitas no campo, com o resultado guardado no talhão e comparado com a meta e com o que foi colhido.
   Estande: plantas/ha = (plantas contadas ÷ metros de linha) × (10.000 ÷ espaçamento entre linhas em m).
   Estimativa (componentes de rendimento):
     soja  kg/ha = plantas/m² × vagens/planta × grãos/vagem × PMG(g) ÷ 100
     milho kg/ha = espigas/ha × fileiras/espiga × grãos/fileira × PMG(g) ÷ 1.000.000
   Resultado bruto: antes das perdas de colheita e na umidade em que o PMG foi medido. */

const KG_SACA_LAV = 60;
const tipoLavoura = f => /milho/i.test(f?.crop || '') ? 'milho' : /soja/i.test(f?.crop || '') ? 'soja' : '';
const ESPAC_PADRAO = {soja: 0.45, milho: 0.5};

// ---------- Contas (puras, testadas) ----------
function calcEstande({contagens, metros, espacamento, meta}) {
  const cs = (contagens || []).map(Number).filter(x => Number.isFinite(x) && x >= 0);
  if (!cs.length || !(metros > 0) || !(espacamento > 0)) return null;
  const media = cs.reduce((a, b) => a + b, 0) / cs.length, porMetro = media / metros;
  const dp = cs.length > 1 ? Math.sqrt(cs.reduce((a, x) => a + (x - media) ** 2, 0) / (cs.length - 1)) : 0;
  const porHa = porMetro * 10000 / espacamento;
  return {pontos: cs.length, porMetro, porM2: porMetro / espacamento, porHa, cv: media > 0 ? dp / media * 100 : 0, pctMeta: meta > 0 ? porHa / meta * 100 : null};
}
function calcProdutividade(tipo, v) {
  const n = k => Number(v[k]);
  let kgHa = null;
  if (tipo === 'soja' && n('plantasM2') > 0 && n('vagens') > 0 && n('graosVagem') > 0 && n('pmg') > 0) kgHa = n('plantasM2') * n('vagens') * n('graosVagem') * n('pmg') / 100;
  if (tipo === 'milho' && n('espigasHa') > 0 && n('fileiras') > 0 && n('graosFileira') > 0 && n('pmg') > 0) kgHa = n('espigasHa') * n('fileiras') * n('graosFileira') * n('pmg') / 1e6;
  if (kgHa == null) return null;
  const perdas = Math.min(100, Math.max(0, Number(v.perdas) || 0)), liq = kgHa * (1 - perdas / 100);
  return {kgHa, scHa: kgHa / KG_SACA_LAV, perdas, kgHaLiq: liq, scHaLiq: liq / KG_SACA_LAV};
}

// ---------- Formulários ----------
function ultimaAvaliacao(fieldId, tipo) { return db.avaliacoes.filter(a => a.fieldId === fieldId && a.tipo === tipo).sort(byDateDesc)[0] || null; }
function estandeForm(fieldId) {
  const f = find('fields', fieldId); if (!f) return;
  const cult = tipoLavoura(f), ult = ultimaAvaliacao(fieldId, 'estande');
  openForm({title: `Estande — ${f.name}`, sub: 'Conte as plantas em alguns pontos do talhão, sempre no mesmo comprimento de linha. Quanto mais pontos, mais confiável.',
    values: {date: today(), metros: ult?.metros ?? 5, espacamento: ult?.espacamento ?? ESPAC_PADRAO[cult] ?? 0.5, meta: ult?.meta ?? f.populacaoMeta ?? ''},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'metros', label: 'Metros de linha contados em cada ponto', type: 'number', min: 0, required: true, hint: 'Ex.: 5 metros.'},
      ...[1, 2, 3, 4, 5, 6].map(i => ({k: 'c' + i, label: `Ponto ${i}: plantas contadas`, type: 'number', min: 0, required: i <= 3, hint: i === 1 ? 'Pelo menos 3 pontos, espalhados pelo talhão.' : ''})),
      {k: 'espacamento', label: 'Espaçamento entre linhas (m)', type: 'number', min: 0, required: true, mais: true, hint: 'Ex.: 0,45 para soja; 0,50 para milho.'},
      {k: 'meta', label: 'População planejada (plantas/ha)', type: 'number', min: 0, mais: true, hint: 'Da recomendação da cultivar. Para comparar.'},
      {k: 'notes', label: 'Observações', type: 'textarea', mais: true}],
    maisRotulo: 'Espaçamento, população planejada e observações', submit: 'Calcular e salvar',
    onSubmit: v => {
      if (v.espacamento > 3) return `Espaçamento de ${num(v.espacamento, 2)} m parece errado: informe em metros (ex.: 0,45).`;
      const contagens = [1, 2, 3, 4, 5, 6].map(i => v['c' + i]).filter(x => x !== '' && x != null);
      const r = calcEstande({contagens, metros: v.metros, espacamento: v.espacamento, meta: v.meta});
      if (!r) return 'Informe as contagens, os metros e o espaçamento';
      if (v.meta > 0) f.populacaoMeta = v.meta;
      upsert('avaliacoes', {id: uid(), tipo: 'estande', fieldId, season: f.season || '', date: v.date, metros: v.metros, espacamento: v.espacamento, meta: v.meta, contagens, notes: v.notes, resultado: r});
      showToast(`Estande: ${num(Math.round(r.porHa / 1000) * 1000)} plantas/ha (${num(r.porMetro, 1)} por metro)${r.pctMeta != null ? ` — ${num(Math.round(r.pctMeta))}% do planejado` : ''}`);
    }});
}
function produtividadeForm(fieldId) {
  const f = find('fields', fieldId); if (!f) return;
  let cult = tipoLavoura(f);
  if (!cult) return showToast('A estimativa é para soja ou milho: informe a cultura do talhão.', true);
  const est = ultimaAvaliacao(fieldId, 'estande'), ult = ultimaAvaliacao(fieldId, 'produtividade');
  const soja = cult === 'soja';
  openForm({title: `Estimativa de produtividade — ${f.name}`, sub: soja ? 'Conte em 10 plantas seguidas de alguns pontos e use a média. O peso de mil grãos (PMG) vem da cultivar ou da pesagem.' : 'Conte em 10 espigas de alguns pontos e use a média. O peso de mil grãos (PMG) vem do híbrido ou da pesagem.',
    values: {date: today(), ...(soja ? {plantasM2: est ? Math.round(est.resultado.porM2 * 10) / 10 : '', graosVagem: ult?.graosVagem ?? '', pmg: ult?.pmg ?? ''} : {espigasHa: est ? Math.round(est.resultado.porHa / 100) * 100 : '', pmg: ult?.pmg ?? ''}), perdas: ult?.perdas ?? ''},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true},
      ...(soja ? [
        {k: 'plantasM2', label: 'Plantas por m²', type: 'number', min: 0, required: true, hint: est ? `Do estande de ${fmtDate(est.date)}.` : 'Faça o estande para preencher sozinho.'},
        {k: 'vagens', label: 'Vagens por planta (média)', type: 'number', min: 0, required: true},
        {k: 'graosVagem', label: 'Grãos por vagem (média)', type: 'number', min: 0, required: true, hint: 'Normalmente entre 2 e 2,5.'},
        {k: 'pmg', label: 'Peso de mil grãos (g)', type: 'number', min: 0, required: true, hint: 'Ex.: 150 a 200 g, conforme a cultivar.'}] : [
        {k: 'espigasHa', label: 'Espigas por hectare', type: 'number', min: 0, required: true, hint: est ? `Do estande de ${fmtDate(est.date)} (1 espiga por planta).` : 'Plantas por ha × espigas por planta.'},
        {k: 'fileiras', label: 'Fileiras por espiga (média)', type: 'number', min: 0, required: true},
        {k: 'graosFileira', label: 'Grãos por fileira (média)', type: 'number', min: 0, required: true},
        {k: 'pmg', label: 'Peso de mil grãos (g)', type: 'number', min: 0, required: true, hint: 'Ex.: 300 a 400 g, conforme o híbrido.'}]),
      {k: 'perdas', label: 'Perdas de colheita esperadas (%)', type: 'number', min: 0, mais: true, hint: 'Opcional. A estimativa sem perdas é a produtividade da lavoura em pé.'},
      {k: 'notes', label: 'Observações', type: 'textarea', mais: true}],
    submit: 'Calcular e salvar',
    onSubmit: v => {
      const r = calcProdutividade(cult, v); if (!r) return 'Preencha todos os números';
      if (r.scHa > 400 || r.scHa < 1) return `Deu ${num(Math.round(r.scHa))} sc/ha, fora do possível: confira as contagens e o PMG (em gramas).`;
      upsert('avaliacoes', {id: uid(), tipo: 'produtividade', cultura: cult, fieldId, season: f.season || '', date: v.date, ...v, resultado: r});
      showToast(`Estimativa: ${num(Math.round(r.scHa))} sc/ha${r.perdas ? ` (${num(Math.round(r.scHaLiq))} sc/ha com ${num(r.perdas)}% de perdas)` : ''} • ${num(Math.round(r.scHaLiq * (Number(f.area) || 0)))} sc no talhão`);
    }});
}

// ---------- Seção no talhão ----------
function secaoAvaliacoes(f) {
  const lista = db.avaliacoes.filter(a => a.fieldId === f.id).sort(byDateDesc), cult = tipoLavoura(f);
  const est = lista.find(a => a.tipo === 'estande'), prod = lista.find(a => a.tipo === 'produtividade');
  const colh = typeof analiseSafra === 'function' && f.season ? analiseSafra(f.season).linhas.find(x => (x.fieldId || x.id) === f.id) : null;
  const linha = a => a.tipo === 'estande'
    ? `<tr><td>${fmtDate(a.date)}</td><td>Estande</td><td class="num"><b>${num(Math.round(a.resultado.porHa / 1000) * 1000)}</b> pl/ha</td><td>${num(a.resultado.porMetro, 1)} por metro • ${a.resultado.pontos} pontos • variação ${num(Math.round(a.resultado.cv))}%${a.resultado.pctMeta != null ? ` • <b class="${a.resultado.pctMeta < 90 ? 'txt-red' : ''}">${num(Math.round(a.resultado.pctMeta))}% do planejado</b>` : ''}</td><td><button class="link" data-act="lav-del" data-id="${esc(a.id)}">Excluir</button></td></tr>`
    : `<tr><td>${fmtDate(a.date)}</td><td>Produtividade</td><td class="num"><b>${num(Math.round(a.resultado.scHaLiq))}</b> sc/ha</td><td>${a.cultura === 'soja' ? `${num(a.plantasM2, 1)} pl/m² × ${num(a.vagens, 1)} vagens × ${num(a.graosVagem, 1)} grãos × PMG ${num(a.pmg)} g` : `${num(a.espigasHa)} espigas/ha × ${num(a.fileiras, 1)} fileiras × ${num(a.graosFileira, 1)} grãos × PMG ${num(a.pmg)} g`}${a.resultado.perdas ? ` • ${num(a.resultado.perdas)}% de perdas` : ''}</td><td><button class="link" data-act="lav-del" data-id="${esc(a.id)}">Excluir</button></td></tr>`;
  const comp = prod && colh?.sacas > 0 ? `<p class="nota">Colhido na safra ${esc(f.season)}: <b>${num(Math.round(colh.scha))} sc/ha</b> — ${num(Math.round((colh.scha / prod.resultado.scHaLiq - 1) * 100))}% em relação à estimativa de ${fmtDate(prod.date)}.</p>` : '';
  return `<section class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Avaliações da lavoura</h3><div class="btn-row" style="margin:0">${btn('+ Estande', 'lav-estande', f.id, 'secondary')}${cult ? btn('+ Estimativa de produtividade', 'lav-prod', f.id, 'secondary') : ''}</div></div>
    ${est || prod ? `<div class="lote-nums">${est ? `<span><small>Estande</small><b>${num(Math.round(est.resultado.porHa / 1000) * 1000)} pl/ha</b><small>${fmtDate(est.date)}${est.resultado.pctMeta != null ? ` • ${num(Math.round(est.resultado.pctMeta))}% do planejado` : ''}</small></span>` : ''}${prod ? `<span><small>Produtividade estimada</small><b>${num(Math.round(prod.resultado.scHaLiq))} sc/ha</b><small>${num(Math.round(prod.resultado.scHaLiq * (Number(f.area) || 0)))} sc no talhão</small></span>` : ''}</div>${comp}
      <details style="margin-top:8px"><summary>Histórico (${lista.length})</summary><div class="tbl-wrap"><table class="tbl"><tbody>${lista.map(linha).join('')}</tbody></table></div></details>`
      : `<p class="nota" style="margin:0">Conte as plantas para saber a população real (estande) e, perto da colheita, estime a produtividade pelos componentes da planta${cult ? '' : ' (soja ou milho)'}. O sistema faz as contas e guarda o histórico do talhão.</p>`}</section>`;
}
if (VIEWS.talhao) {
  const talhaoSemAval = VIEWS.talhao;
  VIEWS.talhao = id => {
    const html = talhaoSemAval(id), f = find('fields', id); if (!f) return html;
    // Depois do cabeçalho do talhão e do resumo agronômico (cultura, aplicação, monitoramento, chuva, produtividade)
    const i1 = html.indexOf('</section>') + 10, i2 = html.indexOf('</section>', i1), i = i2 > 0 ? i2 + 10 : i1;
    return html.slice(0, i) + secaoAvaliacoes(f) + html.slice(i);
  };
}
Object.assign(ACTIONS, {
  'lav-estande': estandeForm, 'lav-prod': produtividadeForm,
  'lav-del': id => { const a = find('avaliacoes', id); if (!a) return; confirmDialog(`Excluir a avaliação de ${a.tipo === 'estande' ? 'estande' : 'produtividade'} de ${fmtDate(a.date)}?`, () => { remove('avaliacoes', id); showToast('Avaliação excluída'); render(); }); }
});
