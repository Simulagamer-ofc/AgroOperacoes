'use strict';
/* MercaPlant — Relatório de pesagem (Grãos → Moega → Relatório de pesagem).
   Cada carga numa linha: número, data e hora, placa, produto, origem, peso bruto, tara (com * quando é a tara cadastrada
   do caminhão), peso líquido (bruto − tara), umidade, descontos e peso final; no fim a soma de tudo (cargas, bruto, tara,
   líquido, descontos, final e sacas) e o resumo por produto. Filtro por período, produto e dono do grão. Tela, PDF e envio. */
const relPes = {de: '', ate: '', produto: '', dono: ''};
function relPesPeriodo(atalho) {
  const h = today();
  if (atalho === 'hoje') return [h, h];
  if (atalho === 'ontem') return [addDias(h, -1), addDias(h, -1)];
  if (atalho === '7') return [addDias(h, -6), h];
  if (atalho === 'mes') return [h.slice(0, 8) + '01', h];
  return ['', ''];
}
/** Cargas do filtro, em ordem de pesagem. */
function cargasPesagem(f = relPes) {
  return db.romaneios.filter(r => (!f.de || (r.date || '') >= f.de) && (!f.ate || (r.date || '') <= f.ate)
      && (!f.produto || chaveProduto(r.produto, r.produtoNome) === f.produto) && (!f.dono || (f.dono === 'terceiro' ? r.dono === 'terceiro' : r.dono !== 'terceiro')))
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`) || (Number(a.numero) || 0) - (Number(b.numero) || 0));
}
/** Soma das cargas: bruto, tara, líquido (bruto − tara), descontos, final e umidade média ponderada pelo líquido. */
function totaisPesagem(lista) {
  const t = lista.reduce((a, r) => { const liq = (Number(r.pesoBruto) || 0) - (Number(r.tara) || 0);
    a.cargas++; a.bruto += Number(r.pesoBruto) || 0; a.tara += Number(r.tara) || 0; a.liq += liq; a.desc += r.calc?.descontoKg || 0; a.fin += r.calc?.pesoFinal || 0;
    if (Number.isFinite(Number(r.umidade)) && r.umidade !== '' && r.umidade != null) { a.um += Number(r.umidade) * liq; a.liqU += liq; }
    return a; }, {cargas: 0, bruto: 0, tara: 0, liq: 0, desc: 0, fin: 0, um: 0, liqU: 0});
  return {...t, uMedia: t.liqU ? t.um / t.liqU : null};
}
const relPesOrigem = r => r.dono === 'terceiro' ? (r.depositante || 'Terceiro') : fieldName(r.fieldId) || 'Próprio';
const relPesTexto = f => [f.de || f.ate ? (f.de === f.ate ? fmtDate(f.de) : `${f.de ? fmtDate(f.de) : 'início'} a ${f.ate ? fmtDate(f.ate) : 'hoje'}`) : 'Todas as datas',
  f.produto ? nomeProd(f.produto.startsWith('outro:') ? 'outro' : f.produto, f.produto.startsWith('outro:') ? f.produto.slice(6) : '') : '', f.dono === 'proprio' ? 'grão próprio' : f.dono === 'terceiro' ? 'terceiros' : ''].filter(Boolean).join(' • ');

function telaPesagens() {
  if (!relPes.de && !relPes.ate && !relPes.iniciado) { [relPes.de, relPes.ate] = relPesPeriodo('hoje'); relPes.iniciado = true; if (!cargasPesagem().length) { relPes.de = ''; relPes.ate = ''; } }
  const lista = cargasPesagem(), t = totaisPesagem(lista);
  const prods = [...new Map(db.romaneios.map(r => [chaveProduto(r.produto, r.produtoNome), nomeProd(r.produto, r.produtoNome)])).entries()];
  const porProd = Object.values(lista.reduce((m, r) => { const k = nomeProd(r.produto, r.produtoNome); (m[k] ||= {nome: k, lista: []}).lista.push(r); return m; }, {})).map(p => ({nome: p.nome, ...totaisPesagem(p.lista)}));
  const atal = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['mes', 'Este mês'], ['tudo', 'Tudo']];
  const ativo = a => { const [d, e] = relPesPeriodo(a); return relPes.de === d && relPes.ate === e; };
  return `<div class="no-print">${head('Relatório de pesagem', relPesTexto(relPes), btn('← Moega', 'nav', 'graos/moega', 'secondary') + btn('PDF', 'pes-pdf', '', 'secondary') + btn('Enviar PDF', 'pes-pdf-enviar', '', 'secondary') + btn('Imprimir', 'af-imprimir'))}
    <div class="filters">${atal.map(([k, n]) => `<button class="${ativo(k) ? 'active' : ''}" data-act="pes-periodo" data-id="${k}">${n}</button>`).join('')}</div>
    <section class="card panel pes-filtro"><label>De <input type="date" id="pesDe" value="${esc(relPes.de)}"></label><label>Até <input type="date" id="pesAte" value="${esc(relPes.ate)}"></label>
      <label>Produto <select id="pesProd"><option value="">Todos</option>${prods.map(([k, n]) => `<option value="${esc(k)}" ${k === relPes.produto ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Dono <select id="pesDono"><option value="">Todos</option><option value="proprio" ${relPes.dono === 'proprio' ? 'selected' : ''}>Próprio</option><option value="terceiro" ${relPes.dono === 'terceiro' ? 'selected' : ''}>Terceiros</option></select></label></section></div>
  <article class="card panel relatorio pes-rel"><header class="rel-head"><div><strong>Relatório de pesagem</strong><br><small>${esc(db.settings.farm || '')}</small></div><small>${esc(relPesTexto(relPes))}</small></header>
    <div class="pes-kpis">${[['Cargas', n0(t.cargas)], ['Peso bruto', n0(t.bruto) + ' kg'], ['Tara', '− ' + n0(t.tara) + ' kg'], ['Peso líquido', n0(t.liq) + ' kg', kgT(t.liq)], ['Descontos', '− ' + n0(t.desc) + ' kg'], ['Peso final', n0(t.fin) + ' kg', sacas(t.fin)]]
      .map(([r, v, d]) => `<div><small>${r}</small><b>${v}</b>${d ? `<small>${d}</small>` : ''}</div>`).join('')}</div>
    ${lista.length ? `<div class="tbl-wrap"><table class="tbl pes-tab"><thead><tr><th>Nº</th><th>Placa</th><th class="num">Bruto (kg)</th><th class="num">Tara (kg)</th><th class="num">Líquido (kg)</th><th class="num">Final (kg)</th><th class="num">Umid.</th><th class="num">Desc. (kg)</th><th>Produto</th><th>Origem</th></tr></thead><tbody>
      ${lista.map(r => `<tr data-act="nav" data-id="graos/romaneio/${esc(r.id)}"><td>${esc(r.numero)}</td><td>${esc(r.placa || '—')}<small class="pes-hora">${fmtDate(r.date).slice(0, 5)} ${esc(r.time || '')}</small></td>
        <td class="num">${n0(r.pesoBruto)}</td><td class="num">${n0(r.tara)}${r.taraCadastrada ? '<sup title="Tara cadastrada do caminhão">*</sup>' : ''}</td><td class="num"><b>${n0((Number(r.pesoBruto) || 0) - (Number(r.tara) || 0))}</b></td><td class="num">${n0(r.calc?.pesoFinal || 0)}</td>
        <td class="num">${r.umidade !== '' && r.umidade != null ? n1(r.umidade) + '%' : '—'}</td><td class="num">${n0(r.calc?.descontoKg || 0)}</td><td>${esc(nomeProd(r.produto, r.produtoNome))}</td><td>${esc(relPesOrigem(r))}</td></tr>`).join('')}
      <tr class="pes-total"><td colspan="2"><b>Total</b><small class="pes-hora">${t.cargas} ${t.cargas === 1 ? 'carga' : 'cargas'}</small></td><td class="num"><b>${n0(t.bruto)}</b></td><td class="num"><b>${n0(t.tara)}</b></td><td class="num"><b>${n0(t.liq)}</b></td><td class="num"><b>${n0(t.fin)}</b></td><td class="num"><b>${t.uMedia != null ? n1(t.uMedia) + '%' : '—'}</b></td><td class="num"><b>${n0(t.desc)}</b></td><td colspan="2"></td></tr>
    </tbody></table></div>
    <p class="nota">Líquido = bruto − tara. Final = líquido − descontos de umidade, impureza e outros. ${lista.some(r => r.taraCadastrada) ? '* Tara cadastrada do caminhão (uma pesagem só). ' : ''}Umidade do total: média ponderada pelo líquido. Toque na carga para abrir o romaneio.</p>
    ${porProd.length > 1 ? `<h3>Por produto</h3><table class="tbl"><thead><tr><th>Produto</th><th class="num">Cargas</th><th class="num">Bruto (kg)</th><th class="num">Tara (kg)</th><th class="num">Líquido (kg)</th><th class="num">Final (kg)</th><th class="num">Sacas</th></tr></thead><tbody>
      ${porProd.map(p => `<tr><td>${esc(p.nome)}</td><td class="num">${p.cargas}</td><td class="num">${n0(p.bruto)}</td><td class="num">${n0(p.tara)}</td><td class="num">${n0(p.liq)}</td><td class="num">${n0(p.fin)}</td><td class="num">${sacas(p.fin)}</td></tr>`).join('')}</tbody></table>` : ''}`
    : `<p class="nota">Nenhuma carga pesada ${relPes.de || relPes.ate ? 'neste período' : 'ainda'}.</p>`}
  </article>`;
}

function gerarPdfPesagem(enviar = false) {
  if (!window.jspdf?.jsPDF || typeof pdfMercaPlant !== 'function') return showToast('Gerador de PDF não carregou. Atualize a página.', true);
  const lista = cargasPesagem(), t = totaisPesagem(lista);
  if (!lista.length) return showToast('Nenhuma carga no filtro para o relatório', true);
  const P = pdfMercaPlant({titulo: 'Relatório de pesagem', linha2: relPesTexto(relPes), continuacao: 'Pesagem ' + relPesTexto(relPes)});
  P.secao('Resumo');
  P.cartoes([['Cargas', n0(t.cargas), t.uMedia != null ? `umidade média ${n1(t.uMedia)}%` : ''], ['Peso bruto', n0(t.bruto) + ' kg', ''], ['Tara', n0(t.tara) + ' kg', 'caminhões vazios'],
    ['Peso líquido', n0(t.liq) + ' kg', `${kgT(t.liq)} (bruto - tara)`], ['Descontos', n0(t.desc) + ' kg', t.liq ? `${n1(t.desc / t.liq * 100)}% do líquido` : ''], ['Peso final', n0(t.fin) + ' kg', sacas(t.fin)]]);
  P.secao('Cargas', 'Líquido = bruto - tara | Final = líquido - descontos');
  P.tabela([{t: 'Nº', w: .7}, {t: 'Data', w: 1.5}, {t: 'Placa', w: 1.3}, {t: 'Produto', w: 1.6}, {t: 'Bruto', w: 1.25, dir: true}, {t: 'Tara', w: 1.25, dir: true}, {t: 'Líquido', w: 1.3, dir: true, negrito: true}, {t: 'Umid.', w: .9, dir: true}, {t: 'Final', w: 1.3, dir: true}],
    [...lista.map(r => [String(r.numero), `${fmtDate(r.date).slice(0, 5)} ${r.time || ''}`, r.placa || '-', nomeProd(r.produto, r.produtoNome), n0(r.pesoBruto), n0(r.tara) + (r.taraCadastrada ? '*' : ''),
      n0((Number(r.pesoBruto) || 0) - (Number(r.tara) || 0)), r.umidade !== '' && r.umidade != null ? n1(r.umidade) + '%' : '-', n0(r.calc?.pesoFinal || 0)]),
     ['Total', '', `${t.cargas} ${t.cargas === 1 ? 'carga' : 'cargas'}`, '', n0(t.bruto), n0(t.tara), n0(t.liq), t.uMedia != null ? n1(t.uMedia) + '%' : '-', n0(t.fin)]], {total: true});
  if (lista.some(r => r.taraCadastrada)) P.nota('* Tara cadastrada do caminhão (uma pesagem só).');
  const porProd = Object.values(lista.reduce((m, r) => { const k = nomeProd(r.produto, r.produtoNome); (m[k] ||= {nome: k, lista: []}).lista.push(r); return m; }, {}));
  if (porProd.length > 1) {
    P.secao('Por produto');
    P.tabela([{t: 'Produto', w: 2}, {t: 'Cargas', w: .9, dir: true}, {t: 'Bruto (kg)', w: 1.4, dir: true}, {t: 'Tara (kg)', w: 1.4, dir: true}, {t: 'Líquido (kg)', w: 1.4, dir: true}, {t: 'Final (kg)', w: 1.4, dir: true}, {t: 'Sacas', w: 1.1, dir: true}],
      porProd.map(p => { const x = totaisPesagem(p.lista); return [p.nome, String(x.cargas), n0(x.bruto), n0(x.tara), n0(x.liq), n0(x.fin), sacas(x.fin)]; }));
  }
  if (typeof assinaturasPadrao === 'function') P.assinaturas(assinaturasPadrao());
  const doc = P.finalizar();
  entregarPdf(doc, `mercaplant-pesagem-${(relPes.de || 'inicio')}-${(relPes.ate || 'hoje')}.pdf`, enviar, `Relatório de pesagem — ${relPesTexto(relPes)} — ${t.cargas} cargas, líquido ${n0(t.liq)} kg`);
}

// Rota graos/pesagens e filtros
(() => {
  const _vg = VIEWS.graos;
  VIEWS.graos = (a, ...x) => a === 'pesagens' ? telaPesagens() : _vg(a, ...x);
  document.addEventListener('change', e => {
    const id = e.target?.id; if (!['pesDe', 'pesAte', 'pesProd', 'pesDono'].includes(id)) return;
    Object.assign(relPes, {de: $('#pesDe')?.value || '', ate: $('#pesAte')?.value || '', produto: $('#pesProd')?.value || '', dono: $('#pesDono')?.value || '', iniciado: true}); render();
  });
})();
Object.assign(ACTIONS, {
  'pes-periodo': k => { [relPes.de, relPes.ate] = relPesPeriodo(k); relPes.iniciado = true; render(); },
  'pes-pdf': () => gerarPdfPesagem(false),
  'pes-pdf-enviar': () => gerarPdfPesagem(true)
});
