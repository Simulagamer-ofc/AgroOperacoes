'use strict';
/* LCDPR — Livro Caixa Digital do Produtor Rural, leiaute 1.3 (ADE COPES nº 1/2020; Manual de Preenchimento, RFB, fev/2020).
   Gera o arquivo texto a partir do caixa realizado no ano (contas pagas/recebidas, gastos e manutenções à vista).
   Regras do manual: campos separados por "|" (sem pipe no início/fim), CRLF, UTF-8, números só com dígitos e
   2 casas fixas sem separador, datas ddmmaaaa, Q100 com saldo corrente a partir de zero, Q200 mensal acumulado,
   9999.QTD_LIN = total de linhas. A transmissão é pelo e-CAC com certificado digital (fora do app). */

const LC_VERSAO = '0013';
const LC_TIPO_DOC = [['1', 'Nota fiscal'], ['2', 'Fatura'], ['3', 'Recibo'], ['4', 'Contrato'], ['5', 'Folha de pagamento'], ['6', 'Outros']];
const LC_TIPO_LANC = [['1', 'Receita da atividade rural'], ['2', 'Despesa de custeio/investimento'], ['3', 'Receita de produto entregue (adiantamento)']];
const LC_EXPLORACAO = [['1', 'Exploração individual (imóvel próprio)'], ['2', 'Condomínio'], ['3', 'Imóvel arrendado'], ['4', 'Parceria'], ['5', 'Comodato'], ['6', 'Outros']];
const LC_CONTRAPARTE = [['1', 'Condômino'], ['2', 'Arrendador'], ['3', 'Parceiro'], ['4', 'Comodante'], ['5', 'Outro']];
let lcAno = String(new Date().getFullYear() - 1);

const lcCfg = () => (db.settings.lcdpr ||= {produtor: {}, imoveis: [], contas: [], contador: {}, lanc: {}, docs: {}});
const soDig = s => String(s ?? '').replace(/\D/g, '');
const lcData = iso => iso ? iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(0, 4) : '';
const lcValor = v => String(Math.round(Math.abs(Number(v) || 0) * 100)).padStart(3, '0'); // 2 casas fixas, sem separador (0 → 000)
const lcPct = v => String(Math.round((Number(v) || 0) * 100)).padStart(5, '0');           // N5 com 2 casas: 100% → 10000
const lcTxt = s => String(s ?? '').replace(/[|\r\n\t]/g, ' ').replace(/[\x00-\x1f]/g, '').trim(); // "|" e não imprimíveis não podem aparecer
const lcMax = (s, n) => [...lcTxt(s)].slice(0, n).join('').trim(); // corta no tamanho máximo do campo (leiaute 1.3)
const lcNumDoc = s => String(s ?? '').replace(/^\s*NF-?e\s*(n[º°o.]*\s*)?/i, '').trim(); // só o número do documento
const lcNome = s => semAcentoApp(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Dígitos verificadores (módulo 11) de CPF e CNPJ
function cpfValido(c) { c = soDig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false; for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i); if ((s * 10) % 11 % 10 !== Number(c[t])) return false; } return true; }
function cnpjValido(c) { c = soDig(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false; const dv = n => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, w, i) => a + Number(c[i]) * w, 0) % 11; return s < 2 ? 0 : 11 - s; }; return dv(12) === Number(c[12]) && dv(13) === Number(c[13]); }
const docValido = d => cpfValido(d) || cnpjValido(d);

// Lançamentos de caixa realizados no ano, com referência à origem
function lancamentosAno(ano) {
  const ini = `${ano}-01-01`, fim = `${ano}-12-31`, out = [];
  const comConta = new Set(db.contas.filter(c => c.expenseId).map(c => c.expenseId));
  db.contas.filter(c => c.status === 'paga' && c.pagoEm >= ini && c.pagoEm <= fim).forEach(c => out.push({ref: 'conta:' + c.id, data: c.pagoEm, valor: Number(c.valorPago) || 0, entrada: c.tipo === 'receber', hist: c.descricao + (c.parcela ? ` (${c.parcela})` : ''), parceiro: c.parceiro || '', doc: lcNumDoc(c.doc), nfe: false}));
  db.expenses.filter(g => Number(g.value) > 0 && !g.contaId && !comConta.has(g.id) && g.date >= ini && g.date <= fim).forEach(g => out.push({ref: 'gasto:' + g.id, data: g.date, valor: Number(g.value), entrada: false, hist: g.description, parceiro: g.supplier || '', doc: lcNumDoc(g.doc), nfe: !!g.nfeChave, docParceiro: g.parceiroDoc || ''}));
  db.maintenances.filter(m => Number(m.cost) > 0 && m.status === 'Concluída' && (m.doneDate || m.date) >= ini && (m.doneDate || m.date) <= fim).forEach(m => out.push({ref: 'manut:' + m.id, data: m.doneDate || m.date, valor: Number(m.cost), entrada: false, hist: `Manutenção: ${m.description}${machineName(m.machineId) ? ' — ' + machineName(m.machineId) : ''}`, parceiro: '', doc: '', nfe: false}));
  const cfg = lcCfg();
  return out.sort((a, b) => a.data.localeCompare(b.data) || (b.entrada - a.entrada)).map(l => {
    const a = cfg.lanc[l.ref] || {}, docMapa = l.parceiro ? cfg.docs[lcNome(l.parceiro)] : '';
    return {...l, incluir: a.incluir !== false, imovel: a.imovel || cfg.imoveis[0]?.cod || '', conta: a.conta || cfg.contaPadrao || '', tipoDoc: a.tipoDoc || (l.nfe ? '1' : '6'),
      idPartic: soDig(a.idPartic || l.docParceiro || docMapa || ''), tipoLanc: a.tipoLanc || (l.entrada ? '1' : '2'), numDoc: a.numDoc ?? l.doc};
  });
}

function validarLcdpr(ano, lanc) {
  const c = lcCfg(), p = c.produtor, e = [];
  const faltaP = [];
  if (!soDig(p.cpf)) faltaP.push('CPF');
  for (const [k, r] of [['nome', 'nome'], ['endereco', 'endereço'], ['num', 'número'], ['bairro', 'bairro'], ['uf', 'UF']]) if (!p[k]) faltaP.push(r);
  if (soDig(p.codMun).length !== 7) faltaP.push('código do município (IBGE, 7 dígitos)');
  if (soDig(p.cep).length !== 8) faltaP.push('CEP (8 dígitos)');
  if (!p.email) faltaP.push('e-mail');
  if (faltaP.length) e.push(`Produtor — falta: ${faltaP.join(', ')}.`);
  if (soDig(p.cpf) && !cpfValido(p.cpf)) e.push('Produtor: CPF inválido (confira os dígitos).');
  if (!c.imoveis.length) e.push('Cadastre pelo menos um imóvel rural.');
  c.imoveis.forEach(i => {
    const n = `Imóvel ${i.cod} (${i.nome || 'sem nome'})`;
    const falta = [!i.nome && 'nome', !i.endereco && 'endereço', !i.bairro && 'bairro', !i.uf && 'UF', soDig(i.codMun).length !== 7 && 'código do município (7 dígitos)', soDig(i.cep).length !== 8 && 'CEP (8 dígitos)'].filter(Boolean);
    if (falta.length) e.push(`${n} — falta: ${falta.join(', ')}.`);
    if (i.cafir && soDig(i.cafir).length !== 8) e.push(`${n}: CAFIR deve ter 8 dígitos (com DV).`);
    if (i.caepf && soDig(i.caepf).length !== 14) e.push(`${n}: CAEPF deve ter 14 dígitos.`);
    if (i.tipo === '1' && !i.caepf) e.push(`${n}: CAEPF obrigatório na exploração individual.`);
    const soma = Number(i.participacao || 0) + (i.terceiros || []).reduce((s, t) => s + Number(t.perc || 0), 0);
    if ((Number(i.participacao) < 100 || i.tipo !== '1') && !(i.terceiros || []).length) e.push(`${n}: informe os terceiros (participação menor que 100% ou exploração não individual).`);
    if (Math.abs(soma - 100) > 0.001 && !(i.tipo === '3' || i.tipo === '5')) e.push(`${n}: participações somam ${num(soma, 2)}% (devem somar 100%).`);
    (i.terceiros || []).forEach(t => { if (!docValido(t.doc)) e.push(`${n}: CPF/CNPJ inválido do terceiro ${t.nome || ''}.`); });
  });
  c.contas.forEach(b => { if (soDig(b.banco).length !== 3 || soDig(b.agencia).length < 1 || soDig(b.agencia).length > 4 || !soDig(b.numero)) e.push(`Conta ${b.cod}: confira banco (3 dígitos), agência (até 4 dígitos, sem DV) e número da conta com DV.`); });
  const usados = lanc.filter(l => l.incluir);
  if (!usados.length) e.push(`Nenhum lançamento incluído em ${ano}.`);
  const codsImovel = new Set(c.imoveis.map(i => i.cod)), codsConta = new Set(['000', '999', ...c.contas.map(b => b.cod)]);
  const semDoc = usados.filter(l => !docValido(l.idPartic)), semImovel = usados.filter(l => l.imovel !== '000' && !codsImovel.has(l.imovel)), semConta = usados.filter(l => !codsConta.has(l.conta));
  const nl = n => `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;
  if (semDoc.length) e.push(`${nl(semDoc.length)} sem CPF/CNPJ válido do participante.`);
  if (semImovel.length) e.push(`${nl(semImovel.length)} sem imóvel cadastrado.`);
  if (semConta.length) e.push(`${nl(semConta.length)} sem conta (use 000 = espécie, 999 = numerário em trânsito ou uma conta cadastrada).`);
  if (c.contador.cpfCnpj && !docValido(c.contador.cpfCnpj)) e.push('Contador: CPF/CNPJ inválido.');
  return e;
}

function gerarLcdpr(ano) {
  const c = lcCfg(), p = c.produtor, lanc = lancamentosAno(ano).filter(l => l.incluir), linhas = [];
  // Campo C sem tamanho no leiaute = até 255; os demais são cortados no tamanho do leiaute ao montar cada registro
  const L = (...campos) => linhas.push(campos.map(x => lcMax(x, 255)).join('|'));
  const dtIni = p.inicioAno && p.inicioAno.startsWith(ano) ? p.inicioAno : `${ano}-01-01`;
  L('0000', 'LCDPR', LC_VERSAO, soDig(p.cpf), p.nome, p.indSitIni || '0', p.sitEspecial || '0', p.dtSitEsp ? lcData(p.dtSitEsp) : '', lcData(dtIni), lcData(`${ano}-12-31`));
  L('0010', c.formaApur || '1');
  L('0030', lcMax(p.endereco, 150), lcMax(p.num, 6), lcMax(p.compl, 50), lcMax(p.bairro, 50), p.uf, soDig(p.codMun), soDig(p.cep), soDig(p.tel).slice(0, 15), lcMax(p.email, 115));
  c.imoveis.forEach(i => {
    L('0040', i.cod, 'BR', 'BRL', soDig(i.cafir), soDig(i.caepf), soDig(i.ie).slice(0, 14), lcMax(i.nome, 50), lcMax(i.endereco, 150), lcMax(i.num, 6), lcMax(i.compl, 50), lcMax(i.bairro, 50), i.uf, soDig(i.codMun), soDig(i.cep), i.tipo || '1', lcPct(i.participacao ?? 100));
    (i.terceiros || []).forEach(t => L('0045', i.cod, t.tipo, soDig(t.doc), lcMax(t.nome, 50), lcPct(t.perc)));
  });
  c.contas.forEach(b => L('0050', b.cod, 'BR', soDig(b.banco).padStart(3, '0'), lcMax(b.nomeBanco, 30), soDig(b.agencia).padStart(4, '0'), soDig(b.numero).padStart(16, '0')));
  let saldo = 0; const mes = {};
  lanc.forEach(l => {
    const ent = l.entrada ? l.valor : 0, sai = l.entrada ? 0 : l.valor; saldo = Math.round((saldo + ent - sai) * 100) / 100;
    L('Q100', lcData(l.data), l.imovel, l.conta, lcNumDoc(l.numDoc), l.tipoDoc, l.hist, l.idPartic, l.tipoLanc, lcValor(ent), lcValor(sai), lcValor(saldo), saldo < 0 ? 'N' : 'P');
    const k = l.data.slice(5, 7) + l.data.slice(0, 4); (mes[k] ||= {e: 0, s: 0}); mes[k].e += ent; mes[k].s += sai;
  });
  let acum = 0;
  Object.keys(mes).sort((a, b) => a.slice(2).localeCompare(b.slice(2)) || a.localeCompare(b)).forEach(k => { acum = Math.round((acum + mes[k].e - mes[k].s) * 100) / 100; L('Q200', k, lcValor(mes[k].e), lcValor(mes[k].s), lcValor(acum), acum < 0 ? 'N' : 'P'); });
  const ct = c.contador || {};
  L('9999', ct.nome, soDig(ct.cpfCnpj), ct.crc, lcMax(ct.email, 115), soDig(ct.tel).slice(0, 15), String(linhas.length + 1));
  return linhas.join('\r\n') + '\r\n';
}

// ---------- Tela ----------
VIEWS.lcdpr = () => {
  const c = lcCfg(), p = c.produtor, lanc = lancamentosAno(lcAno), erros = validarLcdpr(lcAno, lanc);
  const anos = [...new Set([String(new Date().getFullYear()), String(new Date().getFullYear() - 1), ...db.contas.map(x => (x.pagoEm || '').slice(0, 4)), ...db.expenses.map(g => (g.date || '').slice(0, 4))].filter(Boolean))].sort().reverse();
  const opt = (lista, v) => lista.map(([k, r]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${esc(r)}</option>`).join('');
  const contasOpt = v => `<option value="000" ${v === '000' ? 'selected' : ''}>000 — espécie</option><option value="999" ${v === '999' ? 'selected' : ''}>999 — numerário em trânsito</option>${c.contas.map(b => `<option value="${b.cod}" ${v === b.cod ? 'selected' : ''}>${b.cod} — ${esc(b.nomeBanco)}</option>`).join('')}${v ? '' : '<option value="" selected>—</option>'}`;
  const imovOpt = v => `${c.imoveis.map(i => `<option value="${i.cod}" ${v === i.cod ? 'selected' : ''}>${i.cod} — ${esc(i.nome)}</option>`).join('')}<option value="000" ${v === '000' ? 'selected' : ''}>000 — comum (condomínio/parceria)</option>${v ? '' : '<option value="" selected>—</option>'}`;
  const ent = lanc.filter(l => l.incluir && l.entrada).reduce((s, l) => s + l.valor, 0), sai = lanc.filter(l => l.incluir && !l.entrada).reduce((s, l) => s + l.valor, 0);
  return head('LCDPR — Livro Caixa Digital do Produtor Rural', 'Gera o arquivo no leiaute 1.3 da Receita Federal a partir do caixa realizado no ano', '') +
    `<div class="filters">${anos.map(a => `<button class="${a === lcAno ? 'active' : ''}" data-act="lc-ano" data-id="${a}">Ano ${a}</button>`).join('')}</div>
    <section class="es-kpis">
      <article class="card kpi"><div class="label">Receitas</div><div class="value">R$ ${num(ent, 2)}</div><div class="hint">entradas incluídas</div></article>
      <article class="card kpi"><div class="label">Despesas</div><div class="value">R$ ${num(sai, 2)}</div><div class="hint">saídas incluídas</div></article>
      <article class="card kpi"><div class="label">Resultado</div><div class="value">${ent - sai < 0 ? '− ' : ''}R$ ${num(Math.abs(ent - sai), 2)}</div><div class="hint">deve bater com a DIRPF</div></article>
      <article class="card kpi ${erros.length ? 'alerta' : ''}"><div class="label">Pendências</div><div class="value">${erros.length}</div><div class="hint">${erros.length ? 'corrija para gerar' : 'pronto para gerar'}</div></article>
    </section>
    <section class="grid">
      <article class="card panel"><h3>Produtor</h3>${p.cpf || p.nome ? `<p><strong>${esc(p.nome)}</strong> • ${p.cpf ? 'CPF ' + esc(p.cpf) : 'CPF não informado'}<br><small style="color:var(--muted)">${esc([p.endereco, p.num, p.bairro, p.uf, p.cep].filter(Boolean).join(', '))}</small></p>` : '<p class="nota">Não informado.</p>'}<p class="nota">Apuração: ${c.formaApur === '2' ? '20% da receita bruta' : 'Livro Caixa'}</p>${btn('Editar produtor', 'lc-produtor', '', 'secondary')}</article>
      <article class="card panel"><h3>Imóveis e contas bancárias</h3>
        ${c.imoveis.map(i => `<p><strong>${i.cod} — ${esc(i.nome)}</strong> ${mini('Editar', 'lc-imovel', i.cod)} ${mini('+ Terceiro', 'lc-terceiro', i.cod)}<br><small style="color:var(--muted)">${esc((LC_EXPLORACAO.find(x => x[0] === i.tipo) || [])[1] || '')} • ${num(i.participacao ?? 100, 2)}%${(i.terceiros || []).length ? ' • terceiros: ' + i.terceiros.map(t => `${esc(t.nome)} ${num(t.perc, 2)}%`).join(', ') : ''}</small></p>`).join('') || '<p class="nota">Nenhum imóvel.</p>'}
        ${c.contas.map(b => `<p><strong>Conta ${b.cod}</strong> — ${esc(b.nomeBanco)} ag. ${esc(b.agencia)} c/c ${esc(b.numero)} ${mini('Editar', 'lc-conta', b.cod)}</p>`).join('')}
        <div class="btn-row">${btn('+ Imóvel', 'lc-imovel', '', 'secondary')}${btn('+ Conta bancária', 'lc-conta', '', 'secondary')}${btn('Contador', 'lc-contador', '', 'secondary')}</div></article>
    </section>
    <div class="section-title"><h3>Lançamentos de ${lcAno} (${lanc.filter(l => l.incluir).length} de ${lanc.length} incluídos)</h3></div>
    <section class="card panel">${lanc.length ? `<div class="tbl-wrap"><table class="tbl lc-tab"><thead><tr><th></th><th>Data</th><th>Histórico</th><th class="num">Valor</th><th>Tipo</th><th>CPF/CNPJ do participante</th><th>Imóvel</th><th>Conta</th><th>Documento</th></tr></thead><tbody>
      ${lanc.map(l => `<tr class="${l.incluir ? '' : 'lc-fora'}" data-lc="${esc(l.ref)}"><td><input type="checkbox" data-lc-campo="incluir" ${l.incluir ? 'checked' : ''} aria-label="Incluir"></td><td>${fmtDate(l.data)}</td><td>${esc(l.hist)}${l.parceiro ? `<br><small style="color:var(--muted)">${esc(l.parceiro)}</small>` : ''}</td><td class="num">${l.entrada ? '+' : '−'} R$ ${num(l.valor, 2)}</td>
        <td><select data-lc-campo="tipoLanc">${opt(l.entrada ? LC_TIPO_LANC.filter(x => x[0] !== '2') : LC_TIPO_LANC.filter(x => x[0] === '2'), l.tipoLanc)}</select></td>
        <td><input data-lc-campo="idPartic" value="${esc(l.idPartic)}" inputmode="numeric" class="${l.idPartic && !docValido(l.idPartic) ? 'lc-inval' : ''}" placeholder="só números"></td>
        <td><select data-lc-campo="imovel">${imovOpt(l.imovel)}</select></td><td><select data-lc-campo="conta">${contasOpt(l.conta)}</select></td>
        <td><select data-lc-campo="tipoDoc">${opt(LC_TIPO_DOC, l.tipoDoc)}</select><input data-lc-campo="numDoc" value="${esc(l.numDoc || '')}" placeholder="nº"></td></tr>`).join('')}
    </tbody></table></div><p class="nota">Inclua só receitas e despesas da atividade rural (empréstimos recebidos não entram). O CPF/CNPJ digitado para um fornecedor ou cliente é lembrado nos próximos lançamentos dele.</p>` : empty('Nenhum lançamento de caixa neste ano', 'Contas pagas/recebidas, gastos e manutenções à vista do ano aparecem aqui.')}</section>
    <section class="card panel" style="margin-top:16px"><h3>Arquivo</h3>${erros.length ? `<p><strong>Para gerar o arquivo, complete:</strong></p><ul class="pend">${erros.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Tudo conferido pelas regras do manual (Pontos de atenção da RFB): contas e imóveis existentes, participações em 100%, CPF/CNPJ válidos, saldos e resumo mensal calculados.</p>'}
      <div class="actions"><button class="primary" data-act="lc-gerar" ${erros.length ? 'disabled' : ''}>Gerar arquivo LCDPR ${lcAno}</button></div>
      <p class="nota">Leiaute 1.3 (ADE COPES nº 1/2020). O arquivo é transmitido pelo e-CAC com certificado digital; confira com o seu contador antes de enviar.</p></section>`;
};
TITLES.lcdpr = 'LCDPR';

document.addEventListener('change', e => {
  const el = e.target.closest?.('[data-lc-campo]'), tr = el?.closest('[data-lc]'); if (!el || !tr) return;
  const cfg = lcCfg(), ref = tr.dataset.lc, campo = el.dataset.lcCampo, a = (cfg.lanc[ref] ||= {});
  a[campo] = campo === 'incluir' ? el.checked : campo === 'idPartic' ? soDig(el.value) : el.value;
  if (campo === 'idPartic') { const l = lancamentosAno(lcAno).find(x => x.ref === ref); if (l?.parceiro && docValido(a.idPartic)) cfg.docs[lcNome(l.parceiro)] = a.idPartic; }
  save(); render();
});

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const proxCod = l => String(Math.max(0, ...l.map(x => Number(x.cod) || 0)) + 1).padStart(3, '0');
Object.assign(ACTIONS, {
  'lc-ano': id => { lcAno = id; render(); },
  'lc-produtor': () => { const c = lcCfg(); openForm({title: 'Produtor rural (declarante)', values: {...c.produtor, formaApur: c.formaApur || '1', indSitIni: c.produtor.indSitIni || '0', sitEspecial: c.produtor.sitEspecial || '0'},
    fields: [{k: 'cpf', label: 'CPF do produtor', required: true}, {k: 'nome', label: 'Nome', required: true}, {k: 'endereco', label: 'Endereço', required: true, full: true}, {k: 'num', label: 'Número', required: true}, {k: 'compl', label: 'Complemento'},
      {k: 'bairro', label: 'Bairro / distrito', required: true}, {k: 'uf', label: 'UF', type: 'select', options: UFS, required: true}, {k: 'codMun', label: 'Código do município (IBGE, 7 dígitos)', required: true}, {k: 'cep', label: 'CEP', required: true},
      {k: 'tel', label: 'Telefone (DDD + número)'}, {k: 'email', label: 'E-mail', required: true}, {k: 'formaApur', label: 'Forma de apuração', type: 'select', options: [{value: '1', label: 'Livro Caixa'}, {value: '2', label: '20% da receita bruta (Lei 8.023/1990)'}], required: true},
      {k: 'indSitIni', label: 'Situação no início do período', type: 'select', options: [{value: '0', label: 'Regular (desde 1º de janeiro)'}, {value: '1', label: 'Início de atividades no ano'}, {value: '2', label: 'Início da obrigatoriedade no ano'}], required: true},
      {k: 'inicioAno', label: 'Data de início (se não for 1º de janeiro)', type: 'date'},
      {k: 'sitEspecial', label: 'Situação especial', type: 'select', options: [{value: '0', label: 'Normal'}, {value: '1', label: 'Falecimento'}, {value: '2', label: 'Espólio'}, {value: '3', label: 'Saída definitiva do país'}], required: true}, {k: 'dtSitEsp', label: 'Data da situação especial', type: 'date'}],
    onSubmit: v => { if (!cpfValido(v.cpf)) return 'CPF inválido'; const {formaApur, ...prod} = v; c.produtor = prod; c.formaApur = formaApur; save(); }}); },
  'lc-imovel': cod => { const c = lcCfg(), i = c.imoveis.find(x => x.cod === cod) || {}; openForm({title: i.cod ? `Imóvel ${i.cod}` : 'Novo imóvel rural', values: {tipo: '1', participacao: 100, ...i},
    fields: [{k: 'nome', label: 'Nome do imóvel', required: true, full: true, hint: 'Até 50 caracteres no arquivo.'}, {k: 'cafir', label: 'CAFIR (8 dígitos com DV)'}, {k: 'caepf', label: 'CAEPF (14 dígitos)'}, {k: 'ie', label: 'Inscrição estadual'},
      {k: 'endereco', label: 'Endereço', required: true, full: true}, {k: 'num', label: 'Número'}, {k: 'compl', label: 'Complemento'}, {k: 'bairro', label: 'Bairro / distrito', required: true}, {k: 'uf', label: 'UF', type: 'select', options: UFS, required: true},
      {k: 'codMun', label: 'Código do município (IBGE)', required: true}, {k: 'cep', label: 'CEP', required: true}, {k: 'tipo', label: 'Tipo de exploração', type: 'select', options: LC_EXPLORACAO.map(([value, label]) => ({value, label})), required: true},
      {k: 'participacao', label: 'Sua participação (%)', type: 'number', min: 0, required: true}],
    onSubmit: v => { const novo = {...i, ...v, cod: i.cod || proxCod(c.imoveis), terceiros: i.terceiros || []}; if (i.cod) c.imoveis = c.imoveis.map(x => x.cod === i.cod ? novo : x); else c.imoveis.push(novo); save(); }}); },
  'lc-terceiro': cod => { const c = lcCfg(), i = c.imoveis.find(x => x.cod === cod); if (!i) return; openForm({title: `Terceiro no imóvel ${cod}`, sub: 'Condômino, arrendador, parceiro ou comodante.', values: {tipo: '1'},
    fields: [{k: 'tipo', label: 'Tipo', type: 'select', options: LC_CONTRAPARTE.map(([value, label]) => ({value, label})), required: true}, {k: 'doc', label: 'CPF ou CNPJ', required: true}, {k: 'nome', label: 'Nome', required: true}, {k: 'perc', label: 'Participação (%)', type: 'number', min: 0, required: true}],
    onSubmit: v => { if (!docValido(v.doc)) return 'CPF/CNPJ inválido'; (i.terceiros ||= []).push(v); save(); }}); },
  'lc-conta': cod => { const c = lcCfg(), b = c.contas.find(x => x.cod === cod) || {}; openForm({title: b.cod ? `Conta ${b.cod}` : 'Nova conta bancária', values: b,
    fields: [{k: 'banco', label: 'Código do banco (COMPE, 3 dígitos)', required: true}, {k: 'nomeBanco', label: 'Nome do banco', required: true, hint: 'Até 30 caracteres no arquivo.'}, {k: 'agencia', label: 'Agência (sem dígito, até 4)', required: true}, {k: 'numero', label: 'Conta com dígito', required: true}],
    onSubmit: v => { const nova = {...b, ...v, cod: b.cod || proxCod(c.contas)}; if (b.cod) c.contas = c.contas.map(x => x.cod === b.cod ? nova : x); else { c.contas.push(nova); c.contaPadrao ||= nova.cod; } save(); }}); },
  'lc-contador': () => { const c = lcCfg(); openForm({title: 'Contador', sub: 'Opcional.', values: c.contador, fields: [{k: 'nome', label: 'Nome'}, {k: 'cpfCnpj', label: 'CPF/CNPJ'}, {k: 'crc', label: 'CRC'}, {k: 'email', label: 'E-mail'}, {k: 'tel', label: 'Telefone'}],
    onSubmit: v => { if (v.cpfCnpj && !docValido(v.cpfCnpj)) return 'CPF/CNPJ inválido'; c.contador = v; save(); }}); },
  'lc-gerar': () => { const lanc = lancamentosAno(lcAno); if (validarLcdpr(lcAno, lanc).length) { showToast('Corrija as pendências antes de gerar'); return; } downloadFile(`LCDPR-${soDig(lcCfg().produtor.cpf)}-${lcAno}.txt`, 'text/plain', gerarLcdpr(lcAno)); }
});
