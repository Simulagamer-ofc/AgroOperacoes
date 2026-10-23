'use strict';
/* Importação do XML da NF-e de compra (leiaute 4.00), no próprio aparelho.
   Lê emitente, número, data, itens (prod), rastreabilidade (rastro: nLote, dVal) e duplicatas (cobr/dup).
   O usuário confere cada item e escolhe o item do estoque; conversão de unidade nunca é suposta. */

let nfeLida = null;
const tagNfe = (el, nome) => el?.getElementsByTagNameNS('*', nome)[0] || null;
const txtNfe = (el, nome) => tagNfe(el, nome)?.textContent?.trim() || '';
const numNfe = s => { const n = Number(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function lerXmlNfe(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo XML inválido');
  const inf = tagNfe(doc, 'infNFe');
  if (!inf) throw new Error('Não é um XML de NF-e (sem infNFe)');
  const emit = tagNfe(inf, 'emit'), ide = tagNfe(inf, 'ide');
  const itens = [...inf.getElementsByTagNameNS('*', 'det')].map(det => {
    const p = tagNfe(det, 'prod');
    // Um item pode ter vários lotes (rastro se repete, cada um com nLote, qLote e dVal)
    const lotes = [...(p?.getElementsByTagNameNS('*', 'rastro') || [])].map(r => ({lote: txtNfe(r, 'nLote'), qtd: numNfe(txtNfe(r, 'qLote')), validade: txtNfe(r, 'dVal')}));
    const qtd = numNfe(txtNfe(p, 'qCom')), somaLotes = lotes.reduce((t, l) => t + l.qtd, 0);
    return {nItem: det.getAttribute('nItem'), codigo: txtNfe(p, 'cProd'), nome: txtNfe(p, 'xProd'), ncm: txtNfe(p, 'NCM'), unidade: txtNfe(p, 'uCom'),
      qtd, valor: numNfe(txtNfe(p, 'vProd')), desconto: numNfe(txtNfe(p, 'vDesc')), lote: lotes[0]?.lote || '', validade: lotes[0]?.validade || '', lotes,
      // Divide por lote só quando as quantidades dos lotes fecham com a do item
      porLote: lotes.length > 1 && lotes.every(l => l.qtd > 0) && Math.abs(somaLotes - qtd) <= 1e-6 * Math.max(1, qtd)};
  });
  const dups = [...inf.getElementsByTagNameNS('*', 'dup')].map(d => ({numero: txtNfe(d, 'nDup'), vencimento: txtNfe(d, 'dVenc'), valor: numNfe(txtNfe(d, 'vDup'))}));
  return {chave: (inf.getAttribute('Id') || '').replace(/^NFe/, ''), numero: txtNfe(ide, 'nNF'), serie: txtNfe(ide, 'serie'), data: (txtNfe(ide, 'dhEmi') || txtNfe(ide, 'dEmi')).slice(0, 10),
    emitente: txtNfe(emit, 'xNome'), cnpj: txtNfe(emit, 'CNPJ') || txtNfe(emit, 'CPF'), total: numNfe(txtNfe(tagNfe(inf, 'ICMSTot'), 'vNF')), itens, dups};
}

// Sugere o item do estoque pelo nome (só sugestão de vínculo; quantidade e unidade são conferidas pelo usuário)
const normNfe = s => semAcentoApp(s).replace(/[^a-z0-9]+/g, ' ').trim();
function itemParecido(nome, codigo) {
  // Mesmo código do produto (gravado no item na primeira importação ou no cadastro) é o vínculo mais seguro
  if (codigo) { const c = db.stock.find(s => s.codigo && String(s.codigo).trim() === String(codigo).trim()); if (c) return c; }
  const n = normNfe(nome).split(' ').filter(w => w.length > 2);
  let melhor = null, pts = 0, empate = false;
  for (const s of db.stock) { const t = normNfe(s.name); const p = n.filter(w => t.includes(w)).length; if (p > pts) { pts = p; melhor = s; empate = false; } else if (p === pts && p > 0) empate = true; }
  if (pts >= 2 || (pts === 1 && n.length === 1)) return melhor;
  // Uma palavra só, mas forte (5+ letras) e de um único item do estoque: ex. “UREIA 46% SACO 50KG” → “Ureia 46%”
  if (pts === 1 && !empate) { const w = n.find(x => normNfe(melhor.name).includes(x)); if (w && w.length >= 5 && !/^\d/.test(w)) return melhor; }
  return null;
}

function telaConferenciaNfe() {
  const n = nfeLida, ja = db.expenses.some(g => g.nfeChave && g.nfeChave === n.chave);
  const opcoes = sel => `<option value="">— escolher —</option><option value="__novo" ${sel === '__novo' ? 'selected' : ''}>+ Criar item novo</option>${db.stock.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} (${esc(s.unit)})</option>`).join('')}`;
  return head(`NF-e ${n.numero}${n.serie ? '-' + n.serie : ''} — ${n.emitente}`, `${fmtDate(n.data)} • total R$ ${num(n.total, 2)} • ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'}${n.dups.length ? ` • ${n.dups.length} ${n.dups.length === 1 ? 'duplicata' : 'duplicatas'}` : ' • sem duplicatas (à vista)'}`, btn('Cancelar', 'nfe-cancelar', '', 'secondary')) +
    (ja ? `<div class="es-validade-aviso">⚠ Esta nota (chave ${esc(n.chave)}) já foi importada. Importar de novo duplicaria o estoque e o gasto.</div>` : '') +
    `<section class="card panel"><p class="nota" style="margin-top:0">Confira cada item: escolha o item do estoque (ou crie um) e a quantidade <strong>na unidade do estoque</strong>. Quando a unidade da nota for diferente, a quantidade é convertida pela embalagem do item (se cadastrada) ou fica em branco para você converter.</p>
    <div class="tbl-wrap"><table class="tbl nfe-tab"><thead><tr><th>Item da nota</th><th class="num">Nota</th><th>Item do estoque</th><th class="num">Qtd. no estoque</th><th>Lote / validade</th></tr></thead><tbody>
    ${n.itens.map((it, i) => { const s = itemParecido(it.nome, it.codigo), sel = it.sel ?? (s ? s.id : '__novo'), alvo = find('stock', sel), mesmaUn = alvo ? normNfe(alvo.unit) === normNfe(it.unidade) : true;
      // Item com embalagem cadastrada (ex.: 1 saco = 50 kg) e nota em outra unidade: já converte pela embalagem (a pessoa confere)
      const conv = alvo && !mesmaUn && Number(alvo.conteudoEmb) > 0 ? Math.round(it.qtd * Number(alvo.conteudoEmb) * 1e4) / 1e4 : null;
      return `<tr><td><strong>${esc(it.nome)}</strong><br><small style="color:var(--muted)">cód. ${esc(it.codigo)}${it.ncm ? ' • NCM ' + esc(it.ncm) : ''}</small></td>
      <td class="num">${num(it.qtd, 4)} ${esc(it.unidade)}<br><small>R$ ${num(it.valor - it.desconto, 2)}</small></td>
      <td><select data-nfe-item="${i}">${opcoes(sel)}</select>${alvo && !mesmaUn ? (conv != null ? `<br><small class="nfe-aviso">Convertido pela embalagem: ${num(it.qtd, 4)} × ${num(alvo.conteudoEmb)} ${esc(alvo.unit)} — confira</small>` : `<br><small class="nfe-aviso">Unidade do estoque: ${esc(alvo.unit)} — converta a quantidade</small>`) : ''}</td>
      <td class="num"><input data-nfe-qtd="${i}" inputmode="decimal" value="${esc(it.qtdEst ?? (mesmaUn ? String(it.qtd).replace('.', ',') : conv != null ? String(conv).replace('.', ',') : ''))}"></td>
      <td><small>${it.lotes?.length > 1 ? it.lotes.map(l => `Lote ${esc(l.lote)} • ${num(l.qtd, 4)} ${esc(it.unidade)}${l.validade ? ' • val. ' + fmtDate(l.validade) : ''}`).join('<br>') + (it.porLote ? '<br>uma entrada por lote' : `<br><span class="nfe-aviso">⚠ Os lotes somam ${num(it.lotes.reduce((t, l) => t + l.qtd, 0), 4)} ${esc(it.unidade)} e o item ${num(it.qtd, 4)}: entra uma só vez, com o lote ${esc(it.lote)}</span>`)
        : `${it.lote ? 'Lote ' + esc(it.lote) : '—'}${it.validade ? '<br>val. ' + fmtDate(it.validade) : ''}`}</small></td></tr>`; }).join('')}
    </tbody></table></div>
    ${n.dups.length ? `<h3 style="margin-top:16px">Duplicatas → Financeiro (a pagar)</h3><table class="tbl"><tbody>${n.dups.map(d => `<tr><td>${esc(d.numero)}</td><td>${fmtDate(d.vencimento)}</td><td class="num">R$ ${num(d.valor, 2)}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="form" style="margin-top:14px"><div class="field"><label for="nfeCat">Categoria do gasto</label><select id="nfeCat">${CAT_GASTO.map(c => `<option ${c === 'Insumos' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div></div>
    <div class="actions"><button class="primary" data-act="nfe-confirmar">${ja ? 'Importar mesmo assim' : 'Dar entrada no estoque'}</button></div>
    <p class="nota">Cada item entra pelo valor do produto na nota (vProd − desconto); impostos destacados, frete e outras despesas não entram no custo do item. O gasto total da nota (R$ ${num(n.total, 2)}) vai para Controle de gastos${n.dups.length ? ', com as duplicatas em Financeiro → A pagar' : ' como pago à vista'}.</p></section>`;
}

// Categoria do item novo pelo NCM da nota (só sugestão; dá para mudar em Editar)
function categoriaPeloNcm(ncm) {
  const n = String(ncm || '');
  if (/^3808/.test(n)) return 'Defensivo';
  if (/^310[1-5]/.test(n)) return 'Fertilizante';
  if (/^(2521|2836|2520)/.test(n)) return 'Corretivo (calcário/gesso)';
  if (/^(120110|100510|100111|100191|100310|100410)/.test(n)) return 'Semente';
  if (/^(27101921|27101259|220710|220720)/.test(n)) return 'Combustível';
  if (/^(2710199|3403)/.test(n)) return 'Lubrificante / óleo';
  if (/^(8432|8433|8708|8482|8483|4011|8421)/.test(n)) return 'Peças';
  return '';
}
// Unidade da nota → unidade do estoque (LT → L, KG → kg, SC → sc, UN → un…)
function unidadeDaNota(u) {
  const t = normNfe(u || ''); const m = {l: 'L', lt: 'L', litro: 'L', litros: 'L', ml: 'mL', kg: 'kg', kgs: 'kg', g: 'g', gr: 'g', t: 't', ton: 't', tn: 't', sc: 'sc', saco: 'sc', sacos: 'sc', un: 'un', und: 'un', unid: 'un', pc: 'un', pca: 'un', peca: 'un', cx: 'un', gl: 'un', m3: 'm³', dose: 'dose', doses: 'dose'};
  return m[t] || u || 'un';
}
function confirmarNfe() {
  const n = nfeLida; if (!n) return;
  // Lê as escolhas da tela
  n.itens.forEach((it, i) => { it.sel = $(`[data-nfe-item="${i}"]`).value; it.qtdEst = $(`[data-nfe-qtd="${i}"]`).value.trim(); });
  for (const it of n.itens) {
    if (!it.sel) return showToast(`Escolha o item do estoque para “${it.nome}”`);
    if (umNum(it.qtdEst) === undefined || !(umNum(it.qtdEst) > 0)) return showToast(`Informe a quantidade no estoque para “${it.nome}”`);
  }
  const cat = $('#nfeCat').value, gastoId = uid();
  for (const it of n.itens) {
    let s = it.sel === '__novo' ? null : find('stock', it.sel);
    if (!s) { s = {id: uid(), name: it.nome, category: categoriaPeloNcm(it.ncm) || (cat === 'Combustível' ? 'Combustível' : cat === 'Peças' ? 'Peças' : 'Outro'), unit: unidadeDaNota(it.unidade), qty: 0, min: '', location: '', fornecedor: n.emitente, codigo: it.codigo}; db.stock.push(s); }
    const q = umNum(it.qtdEst), valor = Math.max(0, it.valor - it.desconto);
    // Vários lotes: uma entrada por lote, quantidade (na unidade do estoque) e valor proporcionais ao qLote; o último absorve o arredondamento
    const partes = it.porLote ? it.lotes.map(l => ({...l, f: l.qtd / it.qtd})) : [{lote: it.lote, validade: it.validade, f: 1}];
    let qRest = q, vRest = valor;
    partes.forEach((l, k) => {
      const ult = k === partes.length - 1, ql = ult ? qRest : Math.round(q * l.f * 1e4) / 1e4, vl = ult ? Math.round(vRest * 100) / 100 : Math.round(valor * l.f * 100) / 100;
      qRest -= ql; vRest -= vl;
      const mov = aplicarMovimento(s, 'Entrada', ql, vl);
      db.movements.push({id: uid(), itemId: s.id, kind: 'Entrada', qty: ql, date: n.data || today(), supplier: n.emitente, doc: `NF-e ${n.numero}`, lote: l.lote || undefined, validade: l.validade || undefined, nfeChave: n.chave, gastoId, ...mov});
    });
  }
  db.expenses.push({id: gastoId, date: n.data || today(), category: cat, description: `NF-e ${n.numero} — ${n.emitente}`, value: n.total, supplier: n.emitente, parceiroDoc: n.cnpj, doc: `NF-e ${n.numero}`, nfeChave: n.chave});
  if (n.dups.length) n.dups.forEach((d, i) => db.contas.push({id: uid(), tipo: 'pagar', grupo: gastoId, descricao: `NF-e ${n.numero} — ${n.emitente}`, categoria: cat, parceiro: n.emitente, valor: d.valor, vencimento: d.vencimento || n.data, parcela: `${i + 1}/${n.dups.length}`, doc: d.numero, status: 'aberta', expenseId: gastoId, lancarGasto: 'Não'}));
  save(); nfeLida = null; showToast(`NF-e ${n.numero} importada: ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'} no estoque`); go('estoque');
}

VIEWS.nfe = () => nfeLida ? telaConferenciaNfe() : head('Importar NF-e', 'Escolha o arquivo XML da nota de compra', btn('← Estoque', 'nav', 'estoque', 'secondary')) + `<section class="card">${empty('Nenhuma nota carregada', 'Toque em “Importar NF-e (XML)” no estoque e escolha o arquivo XML enviado pelo fornecedor.', {act: 'nfe-abrir', label: 'Escolher XML'})}</section>`;
TITLES.nfe = 'Importar NF-e';

(() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml'; inp.id = 'nfeInput'; inp.hidden = true; document.body.appendChild(inp);
  inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; try { nfeLida = lerXmlNfe(await f.text()); go('nfe'); } catch (e) { showToast('Não foi possível ler a nota: ' + e.message); } }; })();
Object.assign(ACTIONS, {
  'nfe-abrir': () => $('#nfeInput').click(),
  'nfe-cancelar': () => { nfeLida = null; go('estoque'); },
  'nfe-confirmar': confirmarNfe
});
document.addEventListener('change', e => { const el = e.target.closest?.('[data-nfe-item]'); if (!el || !nfeLida) return; const i = Number(el.dataset.nfeItem); nfeLida.itens.forEach((it, j) => { it.sel = $(`[data-nfe-item="${j}"]`)?.value; it.qtdEst = $(`[data-nfe-qtd="${j}"]`)?.value.trim(); if (j === i) delete it.qtdEst; }); render(); });
