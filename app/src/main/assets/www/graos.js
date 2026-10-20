'use strict';
/* Nexus Agro — Grãos: moega (romaneio de recebimento), secador (secagem por lote, planilha de hora em hora) e silos
   (saldo, saídas, termometria e horas boas para aerar). Tudo ligado: a carga recebida entra sozinha na colheita do talhão
   e no silo (direto ou depois do secador); o app calcula descontos, água retirada, rendimento do secador, lenha por
   tonelada e custo por saca. Referências técnicas vêm do banco de regras (avaliador), não ficam fixas aqui. */

// Culturas de grão do Brasil. Toda a operação (moega, secador, silo) vale para qualquer uma; classificação em tipo e
// referência de secagem só onde há norma conferida no banco — ou referência cadastrada pela fazenda (Referências técnicas).
const PRODUTOS_GRAO = [['soja', 'Soja'], ['milho', 'Milho'], ['trigo', 'Trigo'], ['arroz', 'Arroz'], ['feijao', 'Feijão'], ['sorgo', 'Sorgo'], ['algodao', 'Algodão (caroço)'],
  ['amendoim', 'Amendoim'], ['girassol', 'Girassol'], ['aveia', 'Aveia'], ['cevada', 'Cevada'], ['centeio', 'Centeio'], ['triticale', 'Triticale'], ['gergelim', 'Gergelim'],
  ['ervilha', 'Ervilha'], ['cafe', 'Café'], ['canola', 'Canola'], ['milheto', 'Milheto'], ['grao_de_bico', 'Grão-de-bico'], ['lentilha', 'Lentilha'], ['chia', 'Chia'], ['crambe', 'Crambe'],
  ['trigo_mourisco', 'Trigo mourisco (sarraceno)'], ['linho', 'Linho (linhaça)'],
  ['outro', 'Outro (digitar)']];
// Cultura digitada em “Outro”: vira uma chave própria (ex.: outro:quinoa), para ter referência da fazenda só dela
const slugCultura = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const chaveProduto = (p, nome) => p === 'outro' && nome ? 'outro:' + slugCultura(nome) : p;
const DESTINOS_GRAO = [['comercializacao', 'Grão — venda'], ['armazenamento_graos', 'Grão — armazenagem'], ['racao_animal', 'Grão — ração animal'], ['moagem_alimentacao_humana', 'Grão — moagem / alimentação humana'], ['agroindustria', 'Grão — agroindústria'], ['semente', 'Semente para plantio']];
const COMBUSTIVEIS = [['lenha', 'Lenha', 'm³ st'], ['cavaco', 'Cavaco', 't'], ['glp', 'GLP', 'kg'], ['gas', 'Gás natural', 'm³'], ['diesel', 'Diesel', 'L'], ['outro', 'Outro', 'un']];
const n0 = v => Math.round(Number(v) || 0).toLocaleString('pt-BR'), n1 = v => (Number(v) || 0).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const nomeProd = (p, nome) => p === 'outro' ? (nome || 'Outro') : String(p || '').startsWith('outro:') ? (nome || p.slice(6).replace(/_/g, ' ')) : (PRODUTOS_GRAO.find(x => x[0] === p) || [, p || '—'])[1];
const unComb = t => (COMBUSTIVEIS.find(x => x[0] === t) || [, , 'un'])[2];
const equipDoTipo = tipo => db.machines.filter(m => m.type === tipo && m.state !== 'Inativa' && m.status !== 'Inativa');
const nomeEquip = id => find('machines', id)?.name || '—';
const kgT = kg => n1((Number(kg) || 0) / 1000) + ' t';
const sacas = kg => n0((Number(kg) || 0) / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)) + ' sc';
const agoraISO = () => `${today()}T${nowTime()}`;
const horasEntre = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 36e5);
const fmtDH = iso => iso ? `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—';
// Padrões de desconto: os do último romaneio do mesmo produto (o contrato raramente muda na safra)
const PADRAO_INICIAL = {umidade: 14, impureza: 1, metodoDesc: 'balanco', fatorUmid: '', fatorImp: 1, quebraTecnica: ''};
const padroesGrao = p => ({...PADRAO_INICIAL, ...(db.settings.padroesGrao?.[p] || {})});

// ---------- Cálculos ----------
// Romaneio: peso líquido, descontos (balanço de massa ou tabela do comprador) e peso final seco e limpo
function calcRomaneio(r) {
  const liquido = (Number(r.pesoBruto) || 0) - (Number(r.tara) || 0);
  // Tabela da cooperativa: % de desconto por ponto acima do padrão; balanço de massa: só o excesso de água e impureza
  const tab = r.metodoDesc === 'tabela', acima = (v, p) => Math.max(0, (numOuU(v) ?? 0) - (numOuU(p) ?? 0));
  const outros = (numOuU(r.quebraTecnica) || 0) + (numOuU(r.outrosDesc) || 0);
  const d = liquido > 0 && typeof AV === 'function' && AV() ? AV().descontosCarga({pesoLiquido: liquido, umidade: numOuU(r.umidade), umidadePadrao: numOuU(r.umidadePadrao),
    impureza: numOuU(r.impureza), impurezaPadrao: numOuU(r.impurezaPadrao),
    descUmidadePct: tab && numOuU(r.umidade) != null ? arred2(acima(r.umidade, r.umidadePadrao) * (numOuU(r.fatorUmid) ?? 0)) : numOuU(r.descUmidTabela),
    descImpurezaPct: tab && numOuU(r.impureza) != null ? arred2(acima(r.impureza, r.impurezaPadrao) * (numOuU(r.fatorImp) ?? 1)) : numOuU(r.descImpTabela),
    outrosPct: outros > 0 ? outros : undefined}) : null;
  return {liquido, pesoFinal: d?.pesoFinalKg ?? liquido, descontoKg: d?.descontoTotalKg ?? 0, descontoPct: d?.descontoTotalPct ?? 0, linhas: d?.linhas || []};
}
const arred2 = v => Math.round(v * 10000) / 10000;
const numOuU = v => v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v);
// Secagem: massa final (água sai, matéria seca fica), água retirada, rendimento, combustível e custo
function calcSecagem(l) {
  const comU = (l.leituras || []).filter(x => numOuU(x.umidade) != null), lu = comU.at(-1);
  const mi = Number(l.massaEntradaKg) || 0, ui = numOuU(l.umidadeEntrada), uf = numOuU(l.umidadeSaida) ?? numOuU(lu?.umidade);
  const mf = mi > 0 && ui != null && uf != null && uf < 100 ? mi * (100 - ui) / (100 - uf) : null;
  const h = horasEntre(l.inicio, l.fim || agoraISO()), agua = mf != null ? mi - mf : null;
  const q = Number(l.combustivel?.qtd) || 0, preco = Number(l.combustivel?.preco) || 0, energia = (Number(l.energia?.kwh) || 0) * (Number(l.energia?.preco) || 0), custo = q * preco + energia;
  // Previsão de término (em andamento): ritmo das duas últimas umidades (ou desde o início) até a umidade desejada
  let previsao = null; const meta = numOuU(l.umidadeMeta);
  if (!l.fim && lu && meta != null && ui != null) {
    const ant = comU.at(-2), t0 = ant ? ant.em : l.inicio, u0 = ant ? Number(ant.umidade) : ui, dh = horasEntre(t0, lu.em), ritmo = dh > 0 ? (u0 - Number(lu.umidade)) / dh : null;
    if (Number(lu.umidade) <= meta) previsao = {chegou: true, meta};
    else if (ritmo > 0) { const fh = (Number(lu.umidade) - meta) / ritmo, fim = new Date(new Date(lu.em).getTime() + fh * 36e5); previsao = {meta, ritmo, faltamH: Math.max(0, horasEntre(agoraISO(), `${isoDate(fim)}T${String(fim.getHours()).padStart(2, '0')}:${String(fim.getMinutes()).padStart(2, '0')}`)), fim}; }
  }
  return {mi, mf, agua, ui, uf, horas: h, pontos: ui != null && uf != null ? ui - uf : null, tph: h > 0 ? mi / 1000 / h : null, ppH: h > 0 && ui != null && uf != null ? (ui - uf) / h : null,
    combPorT: q && mi ? q / (mi / 1000) : null, combPorTAgua: q && agua > 0 ? q / (agua / 1000) : null, custo: custo || null,
    previsao, energia: energia || null, custoT: custo && mf ? custo / (mf / 1000) : null, custoSc: custo && mf ? custo / (mf / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)) : null};
}
// Leitura do secador avaliada pelo banco de referências (mesma lógica das leituras avulsas)
function avaliarLeituraSecador(l, leit) {
  if (typeof AV !== 'function' || !AV() || !regrasGraos) return null;
  const tipo = find('machines', l.secadorId)?.tipoSecador, leituras = [];
  if (numOuU(leit.tMassa) != null) leituras.push({ponto: 'massa_graos', variavel: 'temperatura', valor: Number(leit.tMassa)});
  if (numOuU(leit.tAr) != null) leituras.push({ponto: 'ar_entrada', variavel: 'temperatura', valor: Number(leit.tAr)});
  if (!leituras.length) return null;
  const r = AV().avaliarSecagem({equipamentoFamilia: 'secador', produto: chaveProduto(l.produto, l.produtoNome), destino: l.destino, etapa: 'secagem', condicoes: {tipoSecador: tipo || undefined}, leituras}, regrasGraos);
  return r.leituras.map(x => ({ponto: x.ponto, status: x.avaliacao.status, limite: x.avaliacao.limiteMax, regra: x.avaliacao.regraId, acao: x.avaliacao.acaoRecomendada}));
}
function avaliarUmidadeSaida(l, u) {
  if (typeof AV !== 'function' || !AV() || !regrasGraos || numOuU(u) == null) return null;
  const r = AV().avaliarSecagem({equipamentoFamilia: 'secador', produto: chaveProduto(l.produto, l.produtoNome), destino: l.destino, etapa: 'pos_secagem', condicoes: {}, leituras: [{ponto: 'amostra', variavel: 'umidade_graos', valor: Number(u)}], umidadeFinal: Number(u)}, regrasGraos);
  const a = r.leituras[0]?.avaliacao; return a ? {status: a.status, acao: a.acaoRecomendada, regra: a.regraId, max: a.limiteMax} : null;
}
let regrasGraos = null;
const carregarRegrasGraos = () => { if (!regrasGraos && typeof dados === 'function') dados('regras').then(b => { regrasGraos = b; if (['graos'].includes(parseRoute().name)) render(); }).catch(() => {}); };

// ---------- Silos: saldo calculado de todas as entradas e saídas ----------
function movimentosSilo(siloId) {
  const ent = [
    ...db.romaneios.filter(r => r.destinoTipo === 'silo' && r.destinoId === siloId).map(r => ({date: r.date, kg: r.calc?.pesoFinal || 0, umidade: numOuU(r.umidade), tipo: 'Recebido direto', ref: `Romaneio nº ${r.numero}`})),
    ...db.lotesSecagem.filter(l => l.status === 'Concluída' && l.siloId === siloId).map(l => { const c = calcSecagem(l); return {date: (l.fim || '').slice(0, 10), kg: c.mf || 0, umidade: c.uf, tipo: 'Do secador', ref: `Secagem ${nomeProd(l.produto, l.produtoNome)} — ${nomeEquip(l.secadorId)}`}; }),
    ...db.movSilo.filter(m => m.tipo === 'transferencia' && m.destinoSiloId === siloId).map(m => ({date: m.date, kg: Number(m.kg) || 0, tipo: 'Transferência recebida', ref: `de ${nomeEquip(m.siloId)}`})),
    ...db.movSilo.filter(m => m.tipo === 'ajuste' && m.siloId === siloId && Number(m.kg) > 0).map(m => ({date: m.date, kg: Number(m.kg), tipo: 'Ajuste (+)', ref: m.notes || ''}))];
  const sai = db.movSilo.filter(m => m.siloId === siloId && (m.tipo !== 'ajuste' || Number(m.kg) < 0)).map(m => ({date: m.date, kg: Math.abs(Number(m.kg) || 0), tipo: m.tipo === 'transferencia' ? 'Transferência enviada' : m.tipo === 'ajuste' ? 'Ajuste (−)' : 'Saída / expedição', ref: [m.comprador, m.placa, m.tipo === 'transferencia' ? 'para ' + nomeEquip(m.destinoSiloId) : '', m.notes].filter(Boolean).join(' • '), id: m.id}));
  return {ent, sai};
}
function saldoSilo(s) {
  const {ent, sai} = movimentosSilo(s.id), e = ent.reduce((t, x) => t + x.kg, 0), sa = sai.reduce((t, x) => t + x.kg, 0);
  const comU = ent.filter(x => x.umidade != null && x.kg > 0), uMedia = comU.length ? comU.reduce((t, x) => t + x.umidade * x.kg, 0) / comU.reduce((t, x) => t + x.kg, 0) : null;
  const cap = Number(s.capacidadeT) > 0 ? Number(s.capacidadeT) * 1000 : null, saldo = Math.max(0, e - sa);
  return {entrou: e, saiu: sa, saldo, cap, ocupacao: cap ? saldo / cap * 100 : null, uMedia};
}
// Entrada que faria o silo passar da capacidade cadastrada: texto do aviso (ou '' se cabe / sem capacidade)
function avisoCapacidade(siloId, kg, jaContado = 0) {
  const s = find('machines', siloId); if (!s || !(kg > 0)) return '';
  const sd = saldoSilo(s); if (!sd.cap) return '';
  const depois = sd.saldo - jaContado + kg;
  return depois > sd.cap + 1 ? `${s.name} tem ${kgT(sd.saldo - jaContado)} de ${kgT(sd.cap)}: com mais ${kgT(kg)} fica com ${n0(depois / sd.cap * 100)}% da capacidade.` : '';
}
// Termometria: variação de cada cabo desde a leitura anterior do mesmo silo
function termometriaSilo(siloId) {
  const ls = db.termometrias.filter(t => t.siloId === siloId).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.criadoEm || 0) - (a.criadoEm || 0));
  const ult = ls[0], ant = ls[1]; if (!ult) return null;
  const cabos = (ult.cabos || []).map((t, i) => ({cabo: i + 1, t: Number(t), dif: ant && Number.isFinite(Number(ant.cabos?.[i])) ? Number(t) - Number(ant.cabos[i]) : null}));
  const validos = cabos.filter(c => Number.isFinite(c.t)), media = validos.length ? validos.reduce((s, c) => s + c.t, 0) / validos.length : null;
  return {ult, ant, cabos, media, max: validos.length ? Math.max(...validos.map(c => c.t)) : null, subindo: cabos.filter(c => c.dif != null && c.dif >= SUBIDA_CABO)};
}
const SUBIDA_CABO = 2; // critério operacional do app: cabo que subiu 2 °C ou mais desde a última leitura merece verificação
// Aeração: ar pelo menos 5 °C abaixo da temperatura dos grãos (Embrapa Milho e Sorgo, Circular Técnica 55, 2004)
function horasAerar(tGrao) {
  const c = typeof lerClima === 'function' ? lerClima() : null, h = c?.dados?.hourly; if (!h || tGrao == null) return null;
  const agora = `${today()}T${String(new Date().getHours()).padStart(2, '0')}:00`, fim = new Date(Date.now() + 36 * 36e5);
  const fimIso = `${isoDate(fim)}T${String(fim.getHours()).padStart(2, '0')}:00`;
  const boas = h.time.map((t, i) => ({t, ar: h.temperature_2m[i]})).filter(x => x.t >= agora && x.t <= fimIso && x.ar != null && x.ar <= tGrao - 5);
  const faixas = []; boas.forEach(x => { const u = faixas.at(-1), hora = new Date(x.t); if (u && (hora - u.fim) <= 36e5) u.fim = hora; else faixas.push({ini: hora, fim: hora}); });
  return faixas;
}
const fmtFaixa = f => `${f.ini.toLocaleDateString('pt-BR', {weekday: 'short'})} ${String(f.ini.getHours()).padStart(2, '0')}h–${String(f.fim.getHours() + 1).padStart(2, '0')}h`;

// ---------- Moega: romaneio ----------
const proximoRomaneio = () => db.romaneios.reduce((m, r) => Math.max(m, Number(r.numero) || 0), 0) + 1;
function romaneioForm(r = {}) {
  const prod0 = r.produto || db.romaneios.slice().sort(byDateDesc)[0]?.produto || 'soja', pad = padroesGrao(prod0);
  const f0 = r.fieldId ? find('fields', r.fieldId) : null;
  const destinos = [...equipDoTipo('Secador').map(m => ({value: 'secador|' + m.id, label: 'Secador — ' + m.name})), ...equipDoTipo('Silo/Armazém').map(m => ({value: 'silo|' + m.id, label: 'Silo direto — ' + m.name}))];
  openForm({title: r.id ? `Romaneio nº ${r.numero}` : 'Nova carga na moega', sub: 'Pesagem, amostra e descontos. A carga entra sozinha na colheita do talhão e no secador ou silo.',
    values: {date: today(), time: nowTime(), produto: prod0, season: f0?.season || safrasConhecidas?.()[0] || '', metodoDesc: pad.metodoDesc, fatorUmid: pad.fatorUmid, fatorImp: pad.fatorImp, quebraTecnica: pad.quebraTecnica, dono: 'proprio', umidadePadrao: pad.umidade, impurezaPadrao: pad.impureza,
      destino: r.destinoTipo ? r.destinoTipo + '|' + r.destinoId : destinos[0]?.value || '', ...r},
    fields: [
      {k: 'dono', label: 'Dono do grão', type: 'select', options: [{value: 'proprio', label: 'Próprio (da fazenda)'}, {value: 'terceiro', label: 'Terceiro (secagem / armazenagem para outro produtor)'}], required: true},
      {k: 'depositante', label: 'Nome do terceiro', placeholder: 'Produtor dono da carga', hint: depositantes().length ? 'Já cadastrados: ' + depositantes().join(', ') : ''},
      {k: 'fieldId', label: 'Talhão de origem', type: 'select', options: fieldOptions, hint: 'A carga vira colheita deste talhão em Produção. Deixe em branco para grão de terceiros.', full: true},
      {k: 'produto', label: 'Produto', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true},
      {k: 'produtoNome', label: 'Qual cultura (se “Outro”)', placeholder: 'Ex.: quinoa'},
      {k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'},
      {k: 'date', label: 'Data', type: 'date', required: true}, {k: 'time', label: 'Hora', type: 'time'},
      {k: 'placa', label: 'Placa', placeholder: 'ABC1D23'}, {k: 'motorista', label: 'Motorista'},
      {k: 'pesoBruto', label: 'Peso bruto (kg)', type: 'number', min: 0, required: true}, {k: 'tara', label: 'Tara (kg)', type: 'number', min: 0, required: true, hint: 'Peso do caminhão vazio.'},
      {k: 'umidade', label: 'Umidade da amostra (%)', type: 'number', min: 0, required: true}, {k: 'impureza', label: 'Impureza e matérias estranhas (%)', type: 'number', min: 0},
      {k: 'umidadePadrao', label: 'Umidade padrão do contrato (%)', type: 'number', min: 0, hint: 'Acima dela há desconto. Lembra o último usado.'},
      {k: 'impurezaPadrao', label: 'Impureza padrão do contrato (%)', type: 'number', min: 0},
      {k: 'metodoDesc', label: 'Como descontar', type: 'select', options: [{value: 'balanco', label: 'Balanço de massa (só o excesso de água e impureza)'}, {value: 'tabela', label: 'Tabela da cooperativa (% por ponto acima do padrão)'}], required: true, full: true},
      {k: 'fatorUmid', label: 'Tabela: desconto por ponto de umidade (%)', type: 'number', min: 0, hint: 'Ex.: 1,5 = 1,5% do peso por ponto acima do padrão.'},
      {k: 'fatorImp', label: 'Tabela: desconto por ponto de impureza (%)', type: 'number', min: 0, hint: 'Normalmente 1 (1% por ponto).'},
      {k: 'quebraTecnica', label: 'Quebra técnica (%)', type: 'number', min: 0, hint: 'Fixa por carga, se o contrato prevê. Vale nos dois métodos.'},
      {k: 'outrosDesc', label: 'Outros descontos (%)', type: 'number', min: 0, hint: 'Ex.: avariados acima da tolerância do comprador.'},
      {k: 'destino', label: 'Para onde vai a carga', type: 'select', options: destinos, required: true, full: true, hint: destinos.length ? 'Úmida acima do padrão: secador. Já seca: silo direto.' : 'Cadastre o secador e os silos em Máquinas (tipo Secador e Silo/Armazém).'},
      {k: 'amostraRetida', label: 'Amostra de contraprova (nº / lacre)', placeholder: 'Guardada para contestação', hint: 'Opcional.'},
      {k: 'notes', label: 'Observações', type: 'textarea'}],
    submit: r.id ? 'Salvar romaneio' : 'Registrar carga',
    onSubmit: v => {
      if (!(v.pesoBruto > 0) || !(v.tara >= 0) || v.pesoBruto <= v.tara) return 'O peso bruto precisa ser maior que a tara';
      if (!v.destino) return 'Escolha o secador ou o silo de destino';
      if (v.dono === 'terceiro' && !v.depositante) return 'Informe o nome do terceiro dono da carga';
      if (v.produto === 'outro' && !v.produtoNome) return 'Escreva qual é a cultura';
      if (v.produto !== 'outro') v.produtoNome = '';
      // Mesma placa registrada há pouco: provável lançamento em dobro
      const placa = String(v.placa || '').replace(/\W/g, '').toUpperCase(), min = t => { const [h, m] = String(t || '00:00').split(':'); return Number(h) * 60 + Number(m); };
      const dup = placa && db.romaneios.find(x => x.id !== r.id && String(x.placa || '').replace(/\W/g, '').toUpperCase() === placa && x.date === v.date && Math.abs(min(x.time) - min(v.time)) <= 30);
      if (dup && romaneioForm.avisoDup !== dup.id + v.pesoBruto) { romaneioForm.avisoDup = dup.id + v.pesoBruto; return `A placa ${v.placa} já tem o romaneio nº ${dup.numero} às ${dup.time} (${n0(dup.calc?.liquido)} kg). Se for outra viagem, toque em registrar de novo.`; }
      if (v.metodoDesc === 'tabela' && v.fatorUmid === '') return 'Informe o desconto por ponto de umidade da tabela';
      const [destinoTipo, destinoId] = v.destino.split('|'), padNovo = padroesGrao(v.produto);
      if (destinoTipo === 'silo' && numOuU(v.umidade) > (numOuU(v.umidadePadrao) ?? padNovo.umidade) && romaneioForm.avisoSilo !== v.pesoBruto + '|' + v.umidade) {
        romaneioForm.avisoSilo = v.pesoBruto + '|' + v.umidade;
        return `Umidade ${n1(v.umidade)}% acima do padrão: o normal é mandar para o secador. Toque em registrar de novo para mandar direto ao silo mesmo assim.`;
      }
      romaneioForm.avisoSilo = '';
      if (destinoTipo === 'silo') {
        const kgNovo = calcRomaneio({...r, ...v, destinoTipo, destinoId}).pesoFinal, ja = r.destinoTipo === 'silo' && r.destinoId === destinoId ? r.calc?.pesoFinal || 0 : 0;
        const cap = avisoCapacidade(destinoId, kgNovo, ja);
        if (cap && romaneioForm.avisoCap !== destinoId + v.pesoBruto) { romaneioForm.avisoCap = destinoId + v.pesoBruto; return `${cap} Toque em registrar de novo para confirmar.`; }
      }
      if (v.placa) v.placa = String(v.placa).trim().toUpperCase();
      const reg = {...r, ...v, id: r.id || uid(), numero: r.numero || proximoRomaneio(), destinoTipo, destinoId};
      delete reg.destino; reg.calc = calcRomaneio(reg);
      db.settings.padroesGrao = {...(db.settings.padroesGrao || {}), [v.produto]: {umidade: numOuU(v.umidadePadrao) ?? padNovo.umidade, impureza: numOuU(v.impurezaPadrao) ?? padNovo.impureza, metodoDesc: v.metodoDesc, fatorUmid: v.fatorUmid, fatorImp: v.fatorImp, quebraTecnica: v.quebraTecnica}};
      if (v.dono !== 'terceiro') reg.depositante = '';
      // Colheita do talhão em Produção (peso final, seco e limpo)
      if (reg.fieldId && reg.dono !== 'terceiro') {
        const f = find('fields', reg.fieldId), col = reg.colheitaId ? find('colheitas', reg.colheitaId) : null;
        reg.colheitaId = col?.id || uid();
        upsert('colheitas', {...(col || {}), id: reg.colheitaId, fieldId: reg.fieldId, cultura: f?.crop || nomeProd(reg.produto, reg.produtoNome), season: reg.season || f?.season || '', date: reg.date, kg: Math.round(reg.calc.pesoFinal),
          umidade: reg.umidade, destino: nomeEquip(destinoId), notes: `Romaneio nº ${reg.numero}${reg.placa ? ' • ' + reg.placa : ''} (peso já descontado)`, romaneioId: reg.id});
      } else if (reg.colheitaId) { remove('colheitas', reg.colheitaId); delete reg.colheitaId; }
      upsert('romaneios', reg);
      showToast(`Romaneio nº ${reg.numero}: ${kgT(reg.calc.pesoFinal)} (${sacas(reg.calc.pesoFinal)}) líquidos e limpos → ${nomeEquip(destinoId)}`);
    }});
}
function excluirRomaneio(id) {
  const r = find('romaneios', id); if (!r) return;
  if (db.lotesSecagem.some(l => (l.romaneioIds || []).includes(id))) return showToast('Esta carga já entrou numa secagem. Exclua ou edite a secagem primeiro.', true);
  confirmDialog(`Excluir o romaneio nº ${r.numero}? A colheita gerada por ele também sai de Produção.`, () => { if (r.colheitaId) remove('colheitas', r.colheitaId); remove('romaneios', id); showToast('Romaneio excluído'); go('graos/moega'); });
}

// ---------- Secador: secagem por lote ----------
const cargasEsperando = secadorId => db.romaneios.filter(r => r.destinoTipo === 'secador' && (!secadorId || r.destinoId === secadorId) && !db.lotesSecagem.some(l => (l.romaneioIds || []).includes(r.id)));
function iniciarSecagemForm(secadorId) {
  const sec = equipDoTipo('Secador'); if (!sec.length) return showToast('Cadastre o secador em Máquinas (tipo Secador).', true);
  const sid = secadorId || sec[0].id, todas = cargasEsperando(sid), aberta = db.lotesSecagem.find(l => l.secadorId === sid && l.status === 'Em andamento');
  if (aberta) return go('graos/lote/' + aberta.id);
  // Um lote seca um só produto: entram as cargas da cultura que chegou primeiro (soja e milho não se misturam no secador)
  const chave = r => r.produto === 'outro' ? 'outro|' + String(r.produtoNome || '').trim().toLowerCase() : r.produto;
  const ordem = [...todas].sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')) || (a.numero || 0) - (b.numero || 0));
  const espera = ordem.filter(r => chave(r) === chave(ordem[0] || {})), outras = todas.length - espera.length;
  // A pré-limpeza tira toda a impureza medida na amostra (o desconto do contrato é só o excesso sobre o padrão)
  const impMedida = r => numOuU(r.impureza) ?? r.calc?.linhas?.find(x => x.id === 'impureza')?.percentual ?? 0;
  const massa = espera.reduce((t, r) => t + (r.calc?.liquido || 0) * (1 - Math.min(100, impMedida(r)) / 100), 0);
  const uMed = espera.length ? espera.reduce((t, r) => t + (Number(r.umidade) || 0) * (r.calc?.liquido || 0), 0) / espera.reduce((t, r) => t + (r.calc?.liquido || 0), 0) : '';
  const prod = espera[0]?.produto || 'soja', ultimo = db.lotesSecagem.filter(l => l.secadorId === sid).sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''))[0];
  openForm({title: 'Iniciar secagem', sub: espera.length ? `${espera.length} ${espera.length === 1 ? 'carga' : 'cargas'} de ${esc(nomeProd(espera[0].produto, espera[0].produtoNome).toLowerCase())} esperando este secador: carga e umidade já calculadas (sem a impureza, que sai na pré-limpeza).${outras ? ` Outras ${outras} ${outras === 1 ? 'carga' : 'cargas'} de outra cultura ficam para o próximo lote.` : ''}` : 'Nenhuma carga da moega esperando: informe a carga e a umidade.',
    values: {secadorId: sid, produto: prod, produtoNome: espera[0]?.produtoNome || '', destino: ultimo?.destino || 'armazenamento_graos', massaT: massa ? Math.round(massa / 100) / 10 : '', umidadeEntrada: uMed !== '' ? Math.round(uMed * 10) / 10 : '', combTipo: ultimo?.combustivel?.tipo || 'lenha', umidadeMeta: ultimo?.umidadeMeta ?? 13, combPreco: ultimo?.combustivel?.preco || ''},
    fields: [
      {k: 'secadorId', label: 'Secador', type: 'select', options: sec.map(m => ({value: m.id, label: m.name})), required: true},
      {k: 'produto', label: 'Produto', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true},
      {k: 'produtoNome', label: 'Qual cultura (se “Outro”)'},
      {k: 'destino', label: 'Destino do produto', type: 'select', options: DESTINOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true, hint: 'Define a temperatura máxima e a umidade final de referência.', full: true},
      {k: 'umidadeMeta', label: 'Umidade final desejada (%)', type: 'number', min: 0, hint: 'Para prever o fim e avisar quando chegar. Soja em grão: 12–13% (Embrapa).'},
      {k: 'massaT', label: 'Carga de entrada (t)', type: 'number', min: 0, required: true}, {k: 'umidadeEntrada', label: 'Umidade de entrada (%)', type: 'number', min: 0, required: true},
      {k: 'lotId', label: 'Lote de semente (se for semente)', type: 'select', options: db.lots.map(x => ({value: x.id, label: `${x.code} — ${[x.species, x.cultivar].filter(Boolean).join(' ')}`})), hint: 'A secagem entra no histórico do lote.'},
      {k: 'combTipo', label: 'Combustível', type: 'select', options: COMBUSTIVEIS.map(([v, l, u]) => ({value: v, label: `${l} (${u})`}))}, {k: 'combPreco', label: 'Preço do combustível (R$ por unidade)', type: 'number', min: 0, hint: 'Para o custo por saca. Lembra o último.'}],
    submit: 'Iniciar secagem',
    onSubmit: v => {
      if (!(v.massaT > 0)) return 'Informe a carga de entrada';
      if (v.produto === 'outro' && !v.produtoNome) return 'Escreva qual é a cultura';
      const l = {id: uid(), secadorId: v.secadorId, produto: v.produto, produtoNome: v.produto === 'outro' ? v.produtoNome : '', destino: v.destino, inicio: agoraISO(), status: 'Em andamento', massaEntradaKg: v.massaT * 1000, umidadeEntrada: v.umidadeEntrada,
        romaneioIds: v.secadorId === sid ? todas.filter(r => chave(r) === chave(v)).map(r => r.id) : [], leituras: [], lotId: v.lotId || '', umidadeMeta: v.umidadeMeta, combustivel: {tipo: v.combTipo, preco: v.combPreco === '' ? null : v.combPreco}};
      db.lotesSecagem.push(l); save(); showToast('Secagem iniciada: registre a leitura de hora em hora'); go('graos/lote/' + l.id);
    }});
}
function leituraForm(id) {
  carregarRegrasGraos();
  const l = find('lotesSecagem', id); if (!l) return;
  openForm({title: 'Leitura do secador', sub: `${nomeEquip(l.secadorId)} • ${nomeProd(l.produto, l.produtoNome)} • ${fmtDH(agoraISO())}`, values: {hora: nowTime()},
    fields: [{k: 'hora', label: 'Hora', type: 'time', required: true}, {k: 'tAr', label: 'Temperatura do ar de entrada (°C)', type: 'number'},
      {k: 'tMassa', label: 'Temperatura da massa de grãos (°C)', type: 'number', hint: 'O limite de referência vale para a massa.'}, {k: 'umidade', label: 'Umidade na saída (%)', type: 'number', min: 0},
      {k: 'tDescarga', label: 'Temperatura do grão na descarga (°C)', type: 'number', hint: 'Opcional — grão quente vai para resfriamento/aeração antes de armazenar.'}],
    submit: 'Salvar leitura',
    onSubmit: v => {
      if ([v.tAr, v.tMassa, v.umidade, v.tDescarga].every(x => x === '')) return 'Informe pelo menos uma medida';
      // Hora mais de 10 min à frente do relógio = leitura de ontem anotada depois da meia-noite
      let em = `${today()}T${v.hora || nowTime()}`;
      if (new Date(em) - Date.now() > 10 * 60000) em = `${daysAgo(1)}T${v.hora}`;
      const leit = {em, tAr: v.tAr, tMassa: v.tMassa, umidade: v.umidade, tDescarga: v.tDescarga};
      leit.aval = avaliarLeituraSecador(l, leit); l.leituras = [...(l.leituras || []), leit].sort((a, b) => (a.em || '').localeCompare(b.em || '')); save();
      const fora = leit.aval?.find(a => a.status === 'FORA_DO_PADRAO');
      showToast(fora ? `Atenção: ${fora.ponto === 'massa_graos' ? 'massa' : 'ar'} acima de ${n0(fora.limite)} °C — ${fora.acao}` : 'Leitura registrada', !!fora);
    }});
}
function finalizarSecagemForm(id) {
  carregarRegrasGraos();
  const l = find('lotesSecagem', id); if (!l) return;
  const silos = equipDoTipo('Silo/Armazém'), ult = (l.leituras || []).at(-1);
  openForm({title: 'Finalizar secagem', sub: `${nomeEquip(l.secadorId)} • ${kgT(l.massaEntradaKg)} a ${n1(l.umidadeEntrada)}% • início ${fmtDH(l.inicio)}`,
    values: {umidadeSaida: [...(l.leituras || [])].reverse().find(x => numOuU(x.umidade) != null)?.umidade ?? '', siloId: silos[0]?.id || '', combPreco: l.combustivel?.preco ?? '', precoKwh: db.settings.precoKwh ?? ''},
    fields: [{k: 'umidadeSaida', label: 'Umidade final (%)', type: 'number', min: 0, required: true}, {k: 'siloId', label: 'Silo de destino', type: 'select', options: silos.map(m => ({value: m.id, label: m.name})), hint: silos.length ? '' : 'Cadastre os silos em Máquinas (tipo Silo/Armazém).'},
      {k: 'combQtd', label: `${(COMBUSTIVEIS.find(c => c[0] === l.combustivel?.tipo) || COMBUSTIVEIS[0])[1]} gasto (${unComb(l.combustivel?.tipo)})`, type: 'number', min: 0}, {k: 'combPreco', label: 'Preço (R$ por unidade)', type: 'number', min: 0},
      {k: 'tDescarga', label: 'Temperatura do grão na descarga (°C)', type: 'number', hint: 'Opcional — registra o resfriamento antes do silo.'},
      {k: 'kwh', label: 'Energia elétrica (kWh)', type: 'number', min: 0, hint: 'Opcional — leitura do medidor do secador (motores e ventiladores).'}, {k: 'precoKwh', label: 'Preço do kWh (R$)', type: 'number', min: 0}],
    submit: 'Finalizar',
    onSubmit: v => {
      const av = avaliarUmidadeSaida(l, v.umidadeSaida);
      if (av?.status === 'FORA_DO_PADRAO' && finalizarSecagemForm.aviso !== id + v.umidadeSaida) { finalizarSecagemForm.aviso = id + v.umidadeSaida; return `${av.acao} Toque em finalizar de novo para encerrar mesmo assim.`; }
      const cap = v.siloId ? avisoCapacidade(v.siloId, calcSecagem({...l, umidadeSaida: v.umidadeSaida}).mf) : '';
      if (cap && finalizarSecagemForm.avisoCap !== id + v.siloId) { finalizarSecagemForm.avisoCap = id + v.siloId; return `${cap} Escolha outro silo ou toque em finalizar de novo para confirmar.`; }
      if (v.precoKwh !== '') db.settings.precoKwh = v.precoKwh;
      Object.assign(l, {energia: v.kwh !== '' ? {kwh: v.kwh, preco: v.precoKwh === '' ? null : v.precoKwh} : null, umidadeSaida: v.umidadeSaida, siloId: v.siloId, tDescarga: v.tDescarga, fim: agoraISO(), status: 'Concluída', avalSaida: av, combustivel: {...(l.combustivel || {}), qtd: v.combQtd === '' ? null : v.combQtd, preco: v.combPreco === '' ? null : v.combPreco}});
      const c = calcSecagem(l); l.calc = {mf: c.mf, agua: c.agua, horas: c.horas};
      if (l.lotId && find('lots', l.lotId)) db.lotEvents.push({id: uid(), lotId: l.lotId, date: today(), title: `Secagem: ${nomeEquip(l.secadorId)}`, text: `${kgT(c.mi)} de ${n1(c.ui)}% para ${n1(c.uf)}% em ${um1(c.horas)} h • massa máx. ${(() => { const ms = (l.leituras || []).map(x => numOuU(x.tMassa)).filter(x => x != null); return ms.length ? n0(Math.max(...ms)) + ' °C' : 'não medida'; })()}${av ? ' — umidade final ' + (STATUS_INFO?.[av.status]?.rotulo || av.status) : ''}`});
      save();
      showToast(`Secagem concluída: ${kgT(c.mf)} a ${n1(c.uf)}%${v.siloId ? ' → ' + nomeEquip(v.siloId) : ''}`); go('graos/secador');
    }});
}

// ---------- Silos: saída, transferência, termometria, capacidade ----------
function saidaSiloForm(siloId) {
  const silos = equipDoTipo('Silo/Armazém'); if (!silos.length) return showToast('Cadastre os silos em Máquinas (tipo Silo/Armazém).', true);
  const deps = depositantes(), sf = typeof safrasConhecidas === 'function' ? safrasConhecidas()[0] : '';
  openForm({title: 'Saída do silo', sub: 'Expedição, transferência ou ajuste. Na expedição de grão próprio, a venda pode entrar em Produção e no Financeiro junto.', values: {date: today(), siloId: siloId || silos[0].id, tipo: 'saida', dono: 'proprio', lancarVenda: 'sim', season: sf || '', recebimento: 'À vista'},
    fields: [{k: 'siloId', label: 'Silo', type: 'select', options: silos.map(m => ({value: m.id, label: `${m.name} (${kgT(saldoSilo(m).saldo)})`})), required: true},
      {k: 'tipo', label: 'Tipo', type: 'select', options: [{value: 'saida', label: 'Expedição / venda'}, {value: 'transferencia', label: 'Transferência para outro silo'}, {value: 'ajuste', label: 'Ajuste de estoque (quebra, conferência)'}], required: true},
      {k: 'date', label: 'Data', type: 'date', required: true}, {k: 'kg', label: 'Quantidade (kg)', type: 'number', required: true, hint: 'No ajuste, use negativo para baixar e positivo para somar.'},
      {k: 'dono', label: 'Grão de quem', type: 'select', options: [{value: 'proprio', label: 'Próprio'}, ...deps.map(d => ({value: 'terceiro|' + d, label: 'Terceiro — ' + d}))], required: true},
      {k: 'destinoSiloId', label: 'Silo de destino (transferência)', type: 'select', options: silos.map(m => ({value: m.id, label: m.name}))},
      {k: 'umidade', label: 'Umidade na expedição (%)', type: 'number', min: 0}, {k: 'impureza', label: 'Impureza na expedição (%)', type: 'number', min: 0},
      {k: 'comprador', label: 'Comprador / destino'}, {k: 'placa', label: 'Placa'}, {k: 'motorista', label: 'Motorista'}, {k: 'doc', label: 'Nota fiscal / contrato'},
      {k: 'lancarVenda', label: 'Lançar como venda (grão próprio)', type: 'select', options: [{value: 'sim', label: 'Sim — Produção e Financeiro'}, {value: 'nao', label: 'Não'}]},
      {k: 'preco', label: 'Preço por saca (R$)', type: 'number', min: 0}, {k: 'season', label: 'Safra da venda'},
      {k: 'recebimento', label: 'Recebimento', type: 'select', options: ['À vista', 'A prazo']}, {k: 'vencimento', label: 'Vencimento (a prazo)', type: 'date'},
      {k: 'notes', label: 'Observações', type: 'textarea'}],
    submit: 'Registrar',
    onSubmit: v => {
      if (!v.kg) return 'Informe a quantidade';
      if (v.tipo !== 'ajuste' && v.kg < 0) return 'Use quantidade positiva';
      if (v.tipo === 'transferencia' && (!v.destinoSiloId || v.destinoSiloId === v.siloId)) return 'Escolha outro silo de destino';
      const s = find('machines', v.siloId), saldo = saldoSilo(s).saldo, exp = expurgoAtivo(v.siloId);
      if (v.tipo !== 'ajuste' && v.kg > saldo + 1) return `O silo tem ${kgT(saldo)}: a saída não pode passar do saldo`;
      const capT = v.tipo === 'transferencia' ? avisoCapacidade(v.destinoSiloId, v.kg) : '';
      if (capT && saidaSiloForm.avisoCap !== v.destinoSiloId + v.kg) { saidaSiloForm.avisoCap = v.destinoSiloId + v.kg; return `${capT} Toque em registrar de novo para confirmar.`; }
      const [dono, depositante] = v.dono.split('|');
      if (dono === 'terceiro' && v.tipo === 'saida') { const sd = extratoTerceiro(depositante).saldo; if (v.kg > sd + 1) return `${depositante} tem ${kgT(sd)} armazenados: a saída não pode passar disso`; }
      if (exp && v.tipo !== 'ajuste' && saidaSiloForm.aviso !== v.siloId + v.date) { saidaSiloForm.aviso = v.siloId + v.date; return `Silo em expurgo até ${fmtDH(exp.fimExposicao)} (${exp.produto}): não abrir nem movimentar antes do fim da exposição. Toque em registrar de novo só se a liberação já foi feita.`; }
      const venda = v.tipo === 'saida' && dono === 'proprio' && v.lancarVenda === 'sim';
      if (venda && !(v.preco > 0)) return 'Informe o preço por saca para lançar a venda (ou escolha “Não”)';
      if (venda && v.recebimento === 'A prazo' && !v.vencimento) return 'Informe o vencimento da venda a prazo';
      const mov = {id: uid(), siloId: v.siloId, tipo: v.tipo, date: v.date, kg: v.kg, dono, depositante: depositante || '', destinoSiloId: v.tipo === 'transferencia' ? v.destinoSiloId : '',
        umidade: v.umidade, impureza: v.impureza, comprador: v.comprador, placa: v.placa, motorista: v.motorista, doc: v.doc, notes: v.notes};
      if (venda) {
        const sc = v.kg / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60), valor = Math.round(sc * v.preco * 100) / 100, cultura = culturaDoSilo(v.siloId);
        const vd = {id: uid(), cultura, season: v.season, date: v.date, sacas: Math.round(sc * 100) / 100, preco: v.preco, comprador: v.comprador, recebimento: v.recebimento, vencimento: v.vencimento, doc: v.doc, valor, movSiloId: mov.id, notes: `Expedição do ${s.name}`};
        const conta = {id: uid(), tipo: 'receber', descricao: `Venda de ${cultura.toLowerCase()} — ${n0(sc)} sc`, categoria: 'Venda de grãos', parceiro: v.comprador, valor, doc: v.doc, season: v.season, vendaId: vd.id,
          vencimento: v.recebimento === 'A prazo' ? v.vencimento : v.date, ...(v.recebimento === 'A prazo' ? {status: 'aberta'} : {status: 'paga', pagoEm: v.date, valorPago: valor})};
        vd.contaId = conta.id; mov.vendaId = vd.id; db.vendas.push(vd); db.contas.push(conta);
      }
      upsert('movSilo', mov);
      showToast(v.tipo === 'saida' ? `Saída de ${kgT(v.kg)} (${sacas(v.kg)}) registrada${venda ? ' e venda lançada' : ''}` : 'Registrado');
      if (v.tipo === 'saida') setTimeout(() => go('graos/saida/' + mov.id), 0);
    }});
}
const culturaDoSilo = siloId => { const r = db.romaneios.find(x => x.destinoId === siloId) || db.lotesSecagem.find(l => l.siloId === siloId); return nomeProd(r?.produto, r?.produtoNome) || 'Grão'; };
function excluirMovSilo(id) {
  const m = find('movSilo', id); if (!m) return;
  confirmDialog(`Excluir este movimento do silo?${m.vendaId ? ' A venda e a conta a receber lançadas junto também saem.' : ''}`, () => {
    if (m.vendaId) { const vd = find('vendas', m.vendaId); db.contas = db.contas.filter(c => c.id !== vd?.contaId && c.vendaId !== m.vendaId); remove('vendas', m.vendaId); }
    remove('movSilo', id); closeModal(); render();
  });
}
function termometriaForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  const n = Number(s.cabosTermometria) || termometriaSilo(siloId)?.cabos.length || 4;
  openForm({title: `Termometria — ${s.name}`, sub: 'Maior temperatura de cada cabo. O app compara com a leitura anterior.', values: {date: today(), time: nowTime(), nCabos: n},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true}, {k: 'time', label: 'Hora', type: 'time'},
      ...Array.from({length: n}, (_, i) => ({k: 'c' + i, label: `Cabo ${i + 1} (°C)`, type: 'number'})),
      {k: 'insetos', label: 'Insetos vivos na amostra / calador', type: 'select', options: [{value: 'nao', label: 'Não encontrados'}, {value: 'poucos', label: 'Poucos'}, {value: 'muitos', label: 'Muitos'}]},
      {k: 'especie', label: 'Qual inseto', placeholder: 'Ex.: caruncho, traça, besourinho'},
      {k: 'nCabos', label: 'Cabos neste silo', type: 'number', min: 1, hint: 'Mude e salve para ajustar a quantidade de campos.'}],
    onSubmit: v => {
      const cabos = Array.from({length: n}, (_, i) => v['c' + i]);
      if (Number(v.nCabos) > 0 && Number(v.nCabos) !== n) { s.cabosTermometria = Number(v.nCabos); save(); setTimeout(() => termometriaForm(siloId), 0); return; }
      if (cabos.every(c => c === '')) return 'Informe a temperatura de pelo menos um cabo';
      s.cabosTermometria = n; upsert('termometrias', {id: uid(), siloId, date: v.date, time: v.time, cabos, insetos: v.insetos, especie: v.especie, criadoEm: Date.now()});
      const t = termometriaSilo(siloId); showToast(t.subindo.length ? `Atenção: ${t.subindo.map(c => 'cabo ' + c.cabo).join(', ')} subiu ${SUBIDA_CABO} °C ou mais — verifique e considere aerar` : 'Termometria registrada', t.subindo.length > 0);
    }});
}
function capacidadeForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  openForm({title: `Capacidade — ${s.name}`, values: {capacidadeT: s.capacidadeT ?? ''}, fields: [{k: 'capacidadeT', label: 'Capacidade (t)', type: 'number', min: 0, required: true}],
    onSubmit: v => { s.capacidadeT = v.capacidadeT; save(); showToast('Capacidade salva'); }});
}

// ---------- Telas ----------
const ABAS_GRAOS = [['', 'Painel'], ['moega', 'Moega'], ['secador', 'Secador'], ['silos', 'Silos'], ['terceiros', 'Terceiros']];
const abasGraos = atual => `<div class="filters graos-abas">${ABAS_GRAOS.map(([a, n]) => `<button class="${atual === a ? 'active' : ''}" data-act="nav" data-id="graos${a ? '/' + a : ''}">${n}</button>`).join('')}<button data-act="nav" data-id="secagem">Leituras avulsas</button></div>`;
const semEquip = tipo => `<section class="card">${empty(`Nenhum ${tipo === 'Secador' ? 'secador' : tipo === 'Moega' ? 'moega' : 'silo'} cadastrado`, `Cadastre em Máquinas e manutenção com o tipo “${tipo}”.`, {act: 'mc-new', label: '+ Cadastrar'})}</section>`;
VIEWS.graos = arg => {
  carregarRegrasGraos();
  if (arg?.startsWith('lote/')) return telaLote(arg.slice(5));
  if (arg?.startsWith('romaneio/')) return comprovanteRomaneio(arg.slice(9));
  if (arg?.startsWith('saida/')) return comprovanteSaida(arg.slice(6));
  if (arg === 'relatorio' || arg?.startsWith('relatorio/')) return relatorioSafraGraos(decodeURIComponent(arg.slice(10)));
  if (arg?.startsWith('extrato/')) return telaExtrato(decodeURIComponent(arg.slice(8)));
  const aba = ['moega', 'secador', 'silos', 'terceiros'].includes(arg) ? arg : '';
  const topo = head('Moega, secador e silos', 'Recebimento, secagem e armazenagem ligados: a carga vira colheita do talhão e estoque no silo.', btn('+ Carga na moega', 'gr-romaneio') + btn('Iniciar secagem', 'gr-secar', '', 'secondary') + btn('Saída do silo', 'gr-saida', '', 'secondary') + btn('Relatório da safra', 'nav', 'graos/relatorio', 'secondary')) + abasGraos(aba);
  return topo + (aba === 'moega' ? telaMoega() : aba === 'secador' ? telaSecador() : aba === 'silos' ? telaSilos() : aba === 'terceiros' ? telaTerceiros() : telaPainelGraos());
};
TITLES.graos = 'Grãos';
function telaPainelGraos() {
  const t = today(), hoje = db.romaneios.filter(r => r.date === t), sf = safrasConhecidas?.()[0];
  const safra = sf ? db.romaneios.filter(r => r.season === sf) : db.romaneios, soma = rs => rs.reduce((s, r) => s + (r.calc?.pesoFinal || 0), 0);
  const abertas = db.lotesSecagem.filter(l => l.status === 'Em andamento'), espera = cargasEsperando();
  const silos = equipDoTipo('Silo/Armazém');
  return `<section class="kpis graos-kpis">
      <article class="card kpi"><div class="label">Recebido hoje</div><div class="value">${kgT(soma(hoje))}</div><div class="hint">${hoje.length} ${hoje.length === 1 ? 'carga' : 'cargas'} • ${sacas(soma(hoje))}</div></article>
      <article class="card kpi"><div class="label">Recebido ${sf ? 'na safra ' + esc(sf) : 'no total'}</div><div class="value">${kgT(soma(safra))}</div><div class="hint">${sacas(soma(safra))} líquidas e limpas</div></article>
      <article class="card kpi"><div class="label">Esperando secagem</div><div class="value">${kgT(espera.reduce((s, r) => s + (r.calc?.liquido || 0), 0))}</div><div class="hint">${espera.length} ${espera.length === 1 ? 'carga' : 'cargas'}</div></article>
      <article class="card kpi"><div class="label">Nos silos</div><div class="value">${kgT(silos.reduce((s, m) => s + saldoSilo(m).saldo, 0))}</div><div class="hint">${silos.length} ${silos.length === 1 ? 'silo' : 'silos'}</div></article></section>
    <div class="section-title"><h3>Secagem agora</h3></div>${abertas.length ? abertas.map(cartaoLote).join('') : `<section class="card panel"><p class="nota" style="margin:0">Nenhuma secagem em andamento.${espera.length ? ` ${espera.length} ${espera.length === 1 ? 'carga espera' : 'cargas esperam'} o secador.` : ''}</p>${espera.length ? `<div class="btn-row" style="margin-top:10px">${btn('Iniciar secagem', 'gr-secar')}</div>` : ''}</section>`}
    <div class="section-title"><h3>Silos</h3><button data-act="nav" data-id="graos/silos">Ver silos</button></div>${silos.length ? `<section class="silos-grade">${silos.map(cartaoSilo).join('')}</section>` : semEquip('Silo/Armazém')}`;
}
function cartaoLote(l) {
  const c = calcSecagem(l), ult = (l.leituras || []).at(-1), fora = ult?.aval?.find(a => a.status === 'FORA_DO_PADRAO');
  const semLeitura = ult ? horasEntre(ult.em, agoraISO()) : horasEntre(l.inicio, agoraISO());
  return `<section class="card panel lote-card clickable" data-act="nav" data-id="graos/lote/${esc(l.id)}"><div class="lote-topo"><strong>${esc(nomeEquip(l.secadorId))} — ${esc(nomeProd(l.produto, l.produtoNome))}</strong><span class="chip ${fora ? 'sit-red' : semLeitura > 2 ? 'sit-orange' : 'sit-green'}">${fora ? 'Temperatura acima da referência' : semLeitura > 2 ? `Sem leitura há ${um1(semLeitura)} h` : 'Em andamento'}</span></div>
    <div class="lote-nums"><span><small>Carga</small><b>${kgT(c.mi)}</b></span><span><small>Umidade</small><b>${n1(c.ui)}% → ${c.uf != null ? n1(c.uf) + '%' : '—'}</b></span><span><small>Tempo</small><b>${um1(c.horas)} h</b></span><span><small>Previsão</small><b>${c.previsao?.chegou ? 'chegou à meta' : c.previsao?.fim ? `~${String(c.previsao.fim.getHours()).padStart(2, '0')}:${String(c.previsao.fim.getMinutes()).padStart(2, '0')} (${um1(c.previsao.faltamH)} h)` : '—'}</b></span><span><small>Última massa</small><b>${ult?.tMassa !== '' && ult?.tMassa != null ? n0(ult.tMassa) + ' °C' : '—'}</b></span></div></section>`;
}
function cartaoSilo(s) {
  const sd = saldoSilo(s), tm = termometriaSilo(s.id), aer = tm?.media != null ? horasAerar(tm.media) : null;
  return `<article class="card panel silo-card"><div class="lote-topo"><strong>${esc(s.name)}</strong>${tm?.subindo.length ? `<span class="chip sit-orange">Cabo subindo</span>` : ''}</div>
    <div class="silo-barra"><span style="width:${Math.min(100, sd.ocupacao ?? 0)}%" class="${(sd.ocupacao ?? 0) >= 95 ? 'cheio' : ''}"></span></div>
    <div class="lote-nums"><span><small>Saldo</small><b>${kgT(sd.saldo)}</b></span><span><small>Ocupação</small><b>${sd.ocupacao != null ? n0(sd.ocupacao) + '%' : `<button class="link" data-act="gr-cap" data-id="${esc(s.id)}">informar capacidade</button>`}</b></span><span><small>Umidade média</small><b>${sd.uMedia != null ? n1(sd.uMedia) + '%' : '—'}</b></span><span><small>Grãos</small><b>${tm?.media != null ? `${n1(tm.media)} °C (máx. ${n0(tm.max)})` : '—'}</b></span></div>
    ${tm ? `<p class="nota" style="margin:6px 0 0">Termometria ${fmtDate(tm.ult.date)} ${esc(tm.ult.time || '')}${tm.subindo.length ? ` • <b class="txt-red">${tm.subindo.map(c => `cabo ${c.cabo} +${n1(c.dif)} °C`).join(', ')}</b>` : ''}${aer ? (aer.length ? ` • Boas horas para aerar: ${aer.slice(0, 3).map(fmtFaixa).join(', ')}` : ' • Sem horas boas para aerar nas próximas 36 h') : ''}</p>` : ''}
    ${expurgoAtivo(s.id) ? `<p class="nota txt-red" style="margin:6px 0 0"><b>Em expurgo</b> (${esc(expurgoAtivo(s.id).produto)}) até ${fmtDH(expurgoAtivo(s.id).fimExposicao)} — não abrir nem movimentar. <button class="link" data-act="gr-expurgo-fim" data-id="${esc(expurgoAtivo(s.id).id)}">Liberar agora</button></p>` : ''}
    ${(() => { const iv = ultimoInventario(s.id); return iv ? `<p class="nota" style="margin:6px 0 0">Inventário ${fmtDate(iv.date)}: medido ${kgT(iv.medidoKg)}, sistema ${kgT(iv.sistemaKg)} → ${iv.difKg >= 0 ? '+' : '−'}${kgT(Math.abs(iv.difKg))} (${num(iv.difPct, 2)}%)</p>` : ''; })()}
    ${tm?.ult?.insetos && tm.ult.insetos !== 'nao' ? `<p class="nota txt-red" style="margin:6px 0 0">Insetos vivos (${tm.ult.insetos === 'muitos' ? 'muitos' : 'poucos'}${tm.ult.especie ? ': ' + esc(tm.ult.especie) : ''}) na última vistoria — avalie expurgo com o agrônomo.</p>` : ''}
    <div class="row-actions" style="justify-content:flex-start;margin-top:8px">${mini('Termometria', 'gr-termo', s.id)}${mini('Saída', 'gr-saida', s.id)}${mini('Inventário', 'gr-inventario', s.id)}${mini('Expurgo', 'gr-expurgo', s.id)}${mini('Movimentos', 'gr-movs', s.id)}</div></article>`;
}
function telaMoega() {
  return blocoMedidores() + telaMoegaLista();
}
function telaMoegaLista() {
  const lista = db.romaneios.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  return lista.length ? `<section class="card panel"><div class="tbl-wrap"><table class="tbl tbl-moega"><thead><tr><th>Carga</th><th>Origem e destino</th><th class="num">Líquido</th><th class="num">Amostra e desconto</th><th class="num">Final</th><th>Tipo</th></tr></thead><tbody>
    ${lista.map(r => `<tr class="clickable" data-act="nav" data-id="graos/romaneio/${esc(r.id)}"><td><b>Nº ${r.numero}</b><br><small class="nota">${fmtDate(r.date).slice(0, 5)} ${esc(r.time || '')}</small></td><td>${esc(r.dono === 'terceiro' ? 'Terceiro: ' + r.depositante : fieldName(r.fieldId) || 'Sem talhão')} • ${esc(nomeProd(r.produto, r.produtoNome))}<br><small class="nota">${esc([r.placa, '→ ' + nomeEquip(r.destinoId)].filter(Boolean).join(' '))}</small></td>
      <td class="num">${n0(r.calc?.liquido)} kg</td><td class="num">${n1(r.umidade)}%${r.impureza !== '' && r.impureza != null ? ' • ' + n1(r.impureza) + '%' : ''}<br><small class="nota">− ${n0(r.calc?.descontoKg)} kg (${num(r.calc?.descontoPct, 2)}%)</small></td>
      <td class="num"><b>${n0(r.calc?.pesoFinal)} kg</b><br><small class="nota">${sacas(r.calc?.pesoFinal)}</small></td>
      <td>${r.classif?.resultado?.enquadramento ? `<span class="chip sit-${/Fora|Desclass/.test(r.classif.resultado.enquadramento) ? 'red' : 'green'}">${esc(r.classif.resultado.enquadramento)}</span>` : '<small class="nota">—</small>'}</td></tr>`).join('')}
    </tbody></table></div><p class="nota">Toque na carga para ver o comprovante, classificar, editar ou excluir. Desconto por balanço de massa sobre o padrão do contrato: o grão seco e limpo se conserva, desconta-se só o excesso de água e impureza. Cada romaneio com talhão vira colheita em Produção.</p></section>`
    : `<section class="card">${empty('Nenhuma carga recebida', 'Registre a pesagem, a amostra e o destino de cada caminhão.', {act: 'gr-romaneio', label: '+ Carga na moega'})}</section>`;
}
function telaSecador() {
  const sec = equipDoTipo('Secador'); if (!sec.length) return semEquip('Secador');
  const abertas = db.lotesSecagem.filter(l => l.status === 'Em andamento'), feitas = db.lotesSecagem.filter(l => l.status === 'Concluída').sort((a, b) => (b.fim || '').localeCompare(a.fim || ''));
  const espera = cargasEsperando();
  const limp = `<section class="card panel"><h3 style="margin-bottom:8px">Limpeza e inspeção</h3>${sec.map(m => { const u = ultimaLimpeza(m.id), d = u ? diasEntreAuto(u.date, today()) : null; return `<div class="hoje-item"><span class="alert-icon ${d == null || d > DIAS_LIMPEZA ? 'orange' : 'green'}">⚙</span><div><strong>${esc(m.name)}</strong><small>${u ? `Última em ${fmtDate(u.date)} (há ${d} ${d === 1 ? 'dia' : 'dias'})${u.pendentes ? ` • ${u.pendentes} ${u.pendentes === 1 ? 'item pendente' : 'itens pendentes'}` : ' • tudo feito'}` : 'Nenhuma limpeza registrada'}</small></div>${mini('Registrar limpeza', 'gr-limpeza', m.id)}</div>`; }).join('')}<p class="nota" style="margin:6px 0 0">Pó, palha e grãos acumulados no secador são a principal causa de incêndio. O app lembra a cada ${DIAS_LIMPEZA} dias de uso (critério do app; siga o manual do fabricante).</p></section>`;
  const tot = feitas.reduce((a, l) => { const c = calcSecagem(l); a.mf += c.mf || 0; a.agua += c.agua || 0; a.h += c.horas; a.custo += c.custo || 0; return a; }, {mf: 0, agua: 0, h: 0, custo: 0});
  return `${limp}${espera.length ? `<section class="card panel"><strong>${espera.length} ${espera.length === 1 ? 'carga esperando' : 'cargas esperando'} secagem</strong><small class="nota"> — ${kgT(espera.reduce((s, r) => s + (r.calc?.liquido || 0), 0))}</small><div class="btn-row" style="margin-top:8px">${btn('Iniciar secagem', 'gr-secar')}</div></section>` : ''}
    ${abertas.map(cartaoLote).join('')}
    ${feitas.length ? `<div class="section-title"><h3>Secagens concluídas</h3></div><section class="kpis"><article class="card kpi"><div class="label">Grão seco</div><div class="value">${kgT(tot.mf)}</div><div class="hint">${sacas(tot.mf)}</div></article><article class="card kpi"><div class="label">Água retirada</div><div class="value">${kgT(tot.agua)}</div></article><article class="card kpi"><div class="label">Rendimento médio</div><div class="value">${tot.h ? n1(feitas.reduce((s, l) => s + (Number(l.massaEntradaKg) || 0), 0) / 1000 / tot.h) + ' t/h' : '—'}</div></article><article class="card kpi"><div class="label">Custo de combustível</div><div class="value">${tot.custo ? 'R$ ' + num(tot.custo / (tot.mf / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)), 2) + '/sc' : '—'}</div><div class="hint">${tot.custo ? 'R$ ' + n0(tot.custo) + ' no total' : 'informe o preço ao finalizar'}</div></article></section>
    <section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fim</th><th>Secador / produto</th><th class="num">Entrada</th><th class="num">Umidade</th><th class="num">Saída</th><th class="num">Horas</th><th class="num">t/h</th><th class="num">Combustível</th><th class="num">R$/sc</th></tr></thead><tbody>
      ${feitas.map(l => { const c = calcSecagem(l); return `<tr class="clickable" data-act="nav" data-id="graos/lote/${esc(l.id)}"><td>${fmtDH(l.fim)}</td><td>${esc(nomeEquip(l.secadorId))}<br><small class="nota">${esc(nomeProd(l.produto, l.produtoNome))}</small></td><td class="num">${kgT(c.mi)}</td><td class="num">${n1(c.ui)} → ${n1(c.uf)}%</td><td class="num">${c.mf ? kgT(c.mf) : '—'}</td><td class="num">${um1(c.horas)}</td><td class="num">${c.tph ? n1(c.tph) : '—'}</td><td class="num">${c.combPorT ? num(c.combPorT, 2) + ' ' + unComb(l.combustivel?.tipo) + '/t' : '—'}</td><td class="num">${c.custoSc ? num(c.custoSc, 2) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div></section>` : !abertas.length && !espera.length ? `<section class="card">${empty('Nenhuma secagem registrada', 'Inicie a secagem com as cargas da moega e registre a leitura de hora em hora.', {act: 'gr-secar', label: 'Iniciar secagem'})}</section>` : ''}`;
}
function telaLote(id) {
  const l = find('lotesSecagem', id); if (!l) return empty('Secagem não encontrada', '', {act: 'nav', id: 'graos/secador', label: 'Voltar'});
  const c = calcSecagem(l), aberta = l.status === 'Em andamento', roms = (l.romaneioIds || []).map(r => find('romaneios', r)).filter(Boolean);
  const pontosMassa = (l.leituras || []).filter(x => x.tMassa !== '' && x.tMassa != null);
  const lim = (l.leituras || []).flatMap(x => x.aval || []).find(a => a.ponto === 'massa_graos' && a.limite != null)?.limite;
  return head(`Secagem — ${nomeEquip(l.secadorId)}`, `${nomeProd(l.produto, l.produtoNome)} • ${(DESTINOS_GRAO.find(d => d[0] === l.destino) || [, l.destino])[1]} • início ${fmtDH(l.inicio)}${l.fim ? ' • fim ' + fmtDH(l.fim) : ''}`,
    btn('← Secador', 'nav', 'graos/secador', 'secondary') + (aberta ? btn('+ Leitura', 'gr-leitura', l.id) + btn('Finalizar', 'gr-finalizar', l.id, 'secondary') : '') + `<button class="danger" data-act="gr-lote-del" data-id="${esc(l.id)}">Excluir</button>`) +
    `<section class="kpis"><article class="card kpi"><div class="label">Carga</div><div class="value">${kgT(c.mi)}</div><div class="hint">${roms.length ? roms.length + ' ' + (roms.length === 1 ? 'carga da moega' : 'cargas da moega') : 'informada'}</div></article>
      <article class="card kpi"><div class="label">Umidade</div><div class="value">${n1(c.ui)}% → ${c.uf != null ? n1(c.uf) + '%' : '—'}</div><div class="hint">${c.pontos != null ? n1(c.pontos) + ' pontos' + (c.ppH ? ` • ${num(c.ppH, 2)} pontos/h` : '') : 'sem umidade de saída ainda'}</div></article>
      <article class="card kpi"><div class="label">Grão seco ${aberta ? '(previsão)' : ''}</div><div class="value">${c.mf ? kgT(c.mf) : '—'}</div><div class="hint">${c.agua ? `água retirada ${kgT(c.agua)} • ${sacas(c.mf)}` : ''}</div></article>
      <article class="card kpi"><div class="label">Rendimento${aberta ? ' até agora' : ''}</div><div class="value">${c.tph ? n1(c.tph) + ' t/h' : '—'}</div><div class="hint">${um1(c.horas)} h${c.custoSc ? ` • R$ ${num(c.custoSc, 2)}/sc${c.energia ? ' (com energia)' : ''}` : ''}${c.combPorT ? ` • ${num(c.combPorT, 2)} ${unComb(l.combustivel?.tipo)}/t` : ''}</div></article></section>
    ${aberta && c.previsao ? `<section class="card panel previsao-secagem ${c.previsao.chegou ? 'ok' : ''}">${c.previsao.chegou ? `<strong>Chegou à umidade desejada (${n1(c.previsao.meta)}%).</strong> Confira a amostra e finalize a secagem.` : `<strong>Previsão de término: ~${String(c.previsao.fim.getHours()).padStart(2, '0')}:${String(c.previsao.fim.getMinutes()).padStart(2, '0')}</strong> (em ${um1(c.previsao.faltamH)} h) para chegar a ${n1(c.previsao.meta)}%, no ritmo atual de ${num(c.previsao.ritmo, 2)} pontos/h.`}</section>` : aberta && numOuU(l.umidadeMeta) != null ? `<section class="card panel"><p class="nota" style="margin:0">Registre a umidade na saída em duas leituras para o app prever quando chega a ${n1(l.umidadeMeta)}%.</p></section>` : ''}
    ${l.avalSaida ? `<section class="card panel"><span class="chip ${l.avalSaida.status === 'OK' ? 'sit-green' : l.avalSaida.status === 'ATENCAO' ? 'sit-orange' : l.avalSaida.status === 'FORA_DO_PADRAO' ? 'sit-red' : 'sit-gray'}">Umidade final: ${esc(STATUS_INFO?.[l.avalSaida.status]?.rotulo || l.avalSaida.status)}</span> <span class="nota">${esc(l.avalSaida.acao || '')}${l.avalSaida.regra ? ` (${esc(l.avalSaida.regra)})` : ''}</span>${l.avalSaida.status === 'SEM_REFERENCIA' && typeof botaoInserirNorma === 'function' ? ' ' + botaoInserirNorma(ctxNormaGrao(l, 'pos_secagem', 'amostra', 'umidade_graos', l.umidadeSaida), 'lote:' + l.id) : ''}</section>` : ''}
    ${pontosMassa.length > 1 ? `<section class="card panel"><h3>Temperatura da massa</h3>${graficoMassa(pontosMassa, lim)}</section>` : ''}
    <div class="section-title"><h3>Planilha de secagem (${(l.leituras || []).length})</h3>${aberta ? `<button data-act="gr-leitura" data-id="${esc(l.id)}">+ Leitura</button>` : ''}</div>
    <section class="card panel">${(l.leituras || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hora</th><th class="num">Ar de entrada</th><th class="num">Massa</th><th class="num">Umidade saída</th><th class="num">Descarga</th><th>Referência</th></tr></thead><tbody>
      ${l.leituras.map(x => { const f = x.aval?.find(a => a.status === 'FORA_DO_PADRAO'), ok = x.aval?.some(a => a.status === 'OK'); return `<tr><td>${esc(x.em.slice(11, 16))}<br><small class="nota">${fmtDate(x.em.slice(0, 10))}</small></td><td class="num">${x.tAr !== '' && x.tAr != null ? n0(x.tAr) + ' °C' : '—'}</td><td class="num ${f?.ponto === 'massa_graos' ? 'txt-red' : ''}">${x.tMassa !== '' && x.tMassa != null ? n0(x.tMassa) + ' °C' : '—'}</td><td class="num">${x.umidade !== '' && x.umidade != null ? n1(x.umidade) + '%' : '—'}</td><td class="num">${x.tDescarga !== '' && x.tDescarga != null ? n0(x.tDescarga) + ' °C' : '—'}</td><td>${f ? `<span class="chip sit-red">acima de ${n0(f.limite)} °C</span>` : ok ? '<span class="chip sit-green">ok</span>' : (() => { const sr = x.aval?.find(a => a.status === 'SEM_REFERENCIA'); return sr && typeof botaoInserirNorma === 'function' ? botaoInserirNorma(ctxNormaGrao(l, 'secagem', sr.ponto, 'temperatura', sr.ponto === 'massa_graos' ? x.tMassa : x.tAr), 'lote:' + l.id) : '<small class="nota">sem referência</small>'; })()}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<p class="nota" style="margin:0">Registre a temperatura do ar, a da massa e a umidade na saída de hora em hora. A massa é comparada com a referência do produto e destino.</p>`}</section>
    ${roms.length ? `<div class="section-title"><h3>Cargas da moega</h3></div><section class="card panel"><table class="tbl"><tbody>${roms.map(r => `<tr><td>Nº ${r.numero} • ${fmtDate(r.date)}</td><td>${esc(fieldName(r.fieldId) || 'Terceiros')}</td><td class="num">${n0(r.calc?.liquido)} kg a ${n1(r.umidade)}%</td></tr>`).join('')}</tbody></table></section>` : ''}`;
}
function graficoMassa(pts, lim) {
  const vs = pts.map(p => Number(p.tMassa)), max = Math.max(...vs, lim || 0) + 5, min = Math.max(0, Math.min(...vs) - 5), W = 600, H = 160;
  const x = i => 30 + i / Math.max(1, pts.length - 1) * (W - 40), y = v => H - 20 - (v - min) / (max - min) * (H - 30);
  return `<svg class="massa-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura da massa de grãos ao longo da secagem">${lim ? `<line class="massa-lim" x1="30" x2="${W - 10}" y1="${y(lim).toFixed(1)}" y2="${y(lim).toFixed(1)}"/><text class="massa-rot" x="${W - 12}" y="${(y(lim) - 5).toFixed(1)}" text-anchor="end">limite ${n0(lim)} °C</text>` : ''}
    <polyline class="massa-linha" points="${vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>${vs.map((v, i) => `<circle class="${lim && v > lim ? 'massa-fora' : 'massa-pt'}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"><title>${esc(pts[i].em.slice(11, 16))}: ${n0(v)} °C</title></circle>`).join('')}
    ${pts.map((p, i) => i % Math.ceil(pts.length / 8) === 0 ? `<text class="massa-rot" x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(p.em.slice(11, 16))}</text>` : '').join('')}</svg>`;
}
function telaSilos() {
  const silos = equipDoTipo('Silo/Armazém'); if (!silos.length) return semEquip('Silo/Armazém');
  return `<section class="silos-grade">${silos.map(cartaoSilo).join('')}</section><p class="nota">Saldo = cargas recebidas direto + grão seco que saiu do secador + transferências − saídas. Aeração: o ar deve estar pelo menos 5 °C abaixo da temperatura dos grãos (Embrapa Milho e Sorgo, Circular Técnica 55). Cabo que sobe ${SUBIDA_CABO} °C ou mais entre leituras é marcado para verificação (critério do app).</p>`;
}
function movimentosDialog(siloId) {
  const s = find('machines', siloId); if (!s) return;
  const {ent, sai} = movimentosSilo(siloId), linhas = [...ent.map(x => ({...x, sinal: 1})), ...sai.map(x => ({...x, sinal: -1}))].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const org = origemSilo(siloId);
  dialog.innerHTML = `<h3>Movimentos — ${esc(s.name)}</h3>${org.length ? `<p class="nota"><b>Origem do grão que entrou:</b> ${org.map(o => `${esc(o.nome)} ${n0(o.pct)}%`).join(' • ')}</p>` : ''}<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Movimento</th><th class="num">kg</th><th></th></tr></thead><tbody>${linhas.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.tipo)}<br><small class="nota">${esc(x.ref || '')}</small></td><td class="num ${x.sinal < 0 ? 'txt-red' : ''}">${x.sinal < 0 ? '−' : '+'} ${n0(x.kg)}</td><td>${x.id ? mini('Excluir', 'gr-mov-del', x.id, 'del') : ''}</td></tr>`).join('') || '<tr><td colspan="4">Sem movimentos.</td></tr>'}</tbody></table></div><div class="actions"><button class="secondary" data-close>Fechar</button></div>`;
  $('[data-close]', dialog).onclick = closeModal; modal.classList.add('open');
}

Object.assign(ACTIONS, {
  'gr-romaneio': () => romaneioForm(), 'gr-rom-edit': id => romaneioForm(find('romaneios', id)), 'gr-rom-del': excluirRomaneio,
  'gr-secar': id => iniciarSecagemForm(id), 'gr-leitura': leituraForm, 'gr-finalizar': finalizarSecagemForm,
  'gr-lote-del': id => confirmDialog('Excluir esta secagem? As cargas voltam para “esperando secagem” e o grão seco sai do silo.', () => { remove('lotesSecagem', id); go('graos/secador'); }),
  'gr-saida': id => saidaSiloForm(id), 'gr-termo': termometriaForm, 'gr-cap': capacidadeForm, 'gr-movs': movimentosDialog,
  'gr-mov-del': excluirMovSilo, 'gr-classif': classificacaoForm, 'gr-tarifas': tarifasForm, 'gr-expurgo': expurgoForm, 'gr-limpeza': limpezaForm, 'gr-inventario': inventarioForm, 'gr-medidor': medidorForm, 'gr-inmetro': inmetroForm,
  'gr-expurgo-fim': id => { const e = find('checklistsGraos', id); if (!e) return; e.liberadoEm = agoraISO(); save(); showToast('Silo liberado do expurgo'); render(); }
});
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.graos = 'secagem';

// ---------- Avisos na tela inicial ----------
const alertasSemGraos = alerts;
alerts = function () {
  const lista = alertasSemGraos(), pode = typeof nvPodeRota !== 'function' || nvPodeRota('graos');
  if (!pode) return lista;
  db.lotesSecagem.filter(l => l.status === 'Em andamento').forEach(l => {
    const ult = (l.leituras || []).at(-1), fora = ult?.aval?.find(a => a.status === 'FORA_DO_PADRAO'), h = horasEntre(ult?.em || l.inicio, agoraISO());
    if (fora) lista.unshift({color: 'red', icon: '♨', title: `Secador acima da referência: ${nomeEquip(l.secadorId)}`, text: `${fora.ponto === 'massa_graos' ? 'Massa' : 'Ar'} a ${n0(fora.ponto === 'massa_graos' ? ult.tMassa : ult.tAr)} °C (limite ${n0(fora.limite)} °C). ${fora.acao}`, route: 'graos/lote/' + l.id});
    else if (h > 2) lista.push({color: 'orange', icon: '♨', title: `Secador sem leitura há ${um1(h)} h: ${nomeEquip(l.secadorId)}`, text: 'Registre temperatura e umidade de hora em hora.', route: 'graos/lote/' + l.id});
  });
  const esp = cargasEsperando(); if (esp.length && !db.lotesSecagem.some(l => l.status === 'Em andamento')) lista.push({color: 'blue', icon: '♨', title: `${esp.length} ${esp.length === 1 ? 'carga esperando' : 'cargas esperando'} secagem`, text: `${kgT(esp.reduce((s, r) => s + (r.calc?.liquido || 0), 0))} na moega.`, route: 'graos/secador'});
  equipDoTipo('Silo/Armazém').forEach(s => {
    const sd = saldoSilo(s), tm = termometriaSilo(s.id);
    if (sd.ocupacao != null && sd.ocupacao >= 95) lista.push({color: 'orange', icon: '□', title: `Silo quase cheio: ${s.name}`, text: `${n0(sd.ocupacao)}% (${kgT(sd.saldo)} de ${kgT(sd.cap)}).`, route: 'graos/silos'});
    if (tm?.subindo.length) lista.push({color: 'orange', icon: '!', title: `Temperatura subindo no ${s.name}`, text: `${tm.subindo.map(c => `cabo ${c.cabo}: +${n1(c.dif)} °C`).join(', ')} desde a leitura anterior. Verifique e considere aerar.`, route: 'graos/silos'});
  });
  return lista;
};

// Leituras avulsas (tela antiga): com as abas do módulo, para não perder o caminho
const secagemSemAbas = VIEWS.secagem, secagemAfter = VIEWS.secagem.after;
VIEWS.secagem = arg => { const html = secagemSemAbas(arg); if (arg) return html; const i = html.indexOf('</section>') + 10; return html.slice(0, i) + abasGraos('leituras').replace('<button data-act="nav" data-id="secagem">', '<button class="active" data-act="nav" data-id="secagem">') + html.slice(i); };
VIEWS.secagem.after = secagemAfter;


// ---------- Classificação completa da carga (tabela oficial do produto) ----------
function classificacaoForm(id) {
  const r = find('romaneios', id); if (!r) return;
  if (!regrasGraos) { carregarRegrasGraos(); return showToast('Carregando as tabelas de classificação… tente de novo em instantes.'); }
  const pk = chaveProduto(r.produto, r.produtoNome);
  const tabs0 = (regrasGraos.tabelasClassificacao || []).filter(t => t.produto === pk && t.statusValidacao === 'validada');
  const tabs = tabs0.filter(t => t.origem !== 'fazenda' || !tabs0.some(o => o.origem !== 'fazenda' && (o.grupo?.valor || '') === (t.grupo?.valor || '')));
  if (!tabs.length) {
    if (!podeEditarReferencias()) return showToast(`Não há norma de classificação para ${nomeProd(r.produto, r.produtoNome).toLowerCase()}. Peça ao agrônomo ou ao ADM para inserir.`, true);
    return confirmDialog(`Não há norma oficial conferida de classificação para ${nomeProd(r.produto, r.produtoNome).toLowerCase()}. Inserir a tabela usada pela fazenda (contrato, cooperativa ou recomendação técnica)? Depois o app volta para classificar esta carga.`, () => {
      normaCtx = {tipo: 'tabela', produto: pk, produtoSel: r.produto, produtoNome: r.produtoNome || '', produtoNomeExib: nomeProd(r.produto, r.produtoNome), retorno: {hash: location.hash, depois: 'classif:' + r.id}}; go('norma');
    }, 'Inserir norma');
  }
  const grupos = tabs.filter(t => t.grupo).map(t => ({value: t.grupo.valor, label: t.grupo.rotulo})), defs = [...new Map(tabs.flatMap(t => t.defeitos).map(d => [d.id, d])).values()];
  const atual = r.classif || {};
  openForm({title: `Classificação — romaneio nº ${r.numero}`, sub: `${nomeProd(r.produto, r.produtoNome)} • % em peso, como no laudo do classificador. Deixe em branco o que não foi determinado.`,
    values: {grupo: atual.grupo || (grupos.length ? 'II' : ''), ...Object.fromEntries(defs.map(d => [d.id, atual.valores?.[d.id] ?? '']))},
    fields: [...(grupos.length ? [{k: 'grupo', label: 'Grupo (uso proposto)', type: 'select', options: grupos, required: true, full: true}] : []), ...defs.map(d => ({k: d.id, label: `${d.rotulo} (%)`, type: 'number', min: 0, hint: d.ajuda || ''}))],
    submit: 'Classificar',
    onSubmit: v => {
      const valores = Object.fromEntries(defs.map(d => [d.id, numOuU(v[d.id])]).filter(([, x]) => x != null));
      if (!Object.keys(valores).length) return 'Informe pelo menos um defeito';
      const res = AV().classificarGraos({produto: pk, destino: 'comercializacao', etapa: 'recebimento', grupo: v.grupo || undefined, valores}, regrasGraos);
      r.classif = {grupo: v.grupo, valores, resultado: {status: res.status, enquadramento: res.enquadramento, motivos: res.motivos, consequencias: res.consequencias, pendencias: res.pendencias, tabelaId: res.tabelaId, grupoRotulo: res.grupoRotulo, origem: res.origem, fonte: res.fontes?.[0]?.organizacao || ''}};
      save(); showToast(res.enquadramento ? `Romaneio nº ${r.numero}: ${res.enquadramento}` : 'Classificação registrada — faltam defeitos para enquadrar em tipo');
    }});
}

// Contexto do “Inserir norma” para uma secagem (cultura, destino, etapa, ponto)
const ctxNormaGrao = (l, etapa, ponto, variavel, valor) => ({tipo: 'grao', produto: chaveProduto(l.produto, l.produtoNome), produtoSel: l.produto, produtoNome: l.produtoNome || '', produtoNomeExib: nomeProd(l.produto, l.produtoNome),
  destino: l.destino, etapa, ponto, variavel, valor: numOuU(valor) ?? null, tipoSecador: find('machines', l.secadorId)?.tipoSecador || ''});

// ---------- Comprovantes impressos ----------
// k é texto do próprio app (pode ter <b>); valores vindos do usuário são escapados por quem chama
const linhaC = (k, v) => v !== '' && v != null ? `<tr><td>${k}</td><td>${v}</td></tr>` : '';
const rotuloDefeito = (prod, id) => (regrasGraos?.tabelasClassificacao || []).filter(t => t.produto === prod || t.produto.startsWith('outro:')).flatMap(t => t.defeitos).find(d => d.id === id)?.rotulo || id.replace(/_/g, ' ');
function assinaturas(a, b) { return `<div class="insp-assinatura rom-assin"><div><span></span><small>${esc(a)}</small></div><div><span></span><small>${esc(b)}</small></div></div>`; }
function comprovanteRomaneio(id) {
  const r = find('romaneios', id); if (!r) return empty('Romaneio não encontrado', '', {act: 'nav', id: 'graos/moega', label: 'Voltar'});
  const c = r.calc || calcRomaneio(r), cl = r.classif?.resultado;
  return `<div class="no-print">${head(`Comprovante — romaneio nº ${r.numero}`, `${fmtDate(r.date)} ${r.time || ''} • ${nomeProd(r.produto, r.produtoNome)}`, btn('← Moega', 'nav', 'graos/moega', 'secondary') + btn('Classificar', 'gr-classif', r.id, 'secondary') + btn('Editar', 'gr-rom-edit', r.id, 'secondary') + `<button class="danger" data-act="gr-rom-del" data-id="${esc(r.id)}">Excluir</button>` + btn('Imprimir / PDF', 'af-imprimir'))}</div>
  <article class="card panel relatorio"><header class="rel-head"><div><strong>Romaneio de recebimento nº ${r.numero}</strong><br><small>${esc(db.settings.farm || '')}</small></div><small>${fmtDate(r.date)} ${esc(r.time || '')}</small></header>
    <h3>1. Carga</h3><table class="tbl"><tbody>${linhaC('Produto', esc(nomeProd(r.produto, r.produtoNome)))}${linhaC('Safra', esc(r.season || ''))}${linhaC('Dono do grão', esc(r.dono === 'terceiro' ? 'Terceiro — ' + r.depositante : 'Próprio'))}${linhaC('Talhão de origem', esc(fieldName(r.fieldId) || ''))}${linhaC('Placa', esc(r.placa || ''))}${linhaC('Motorista', esc(r.motorista || ''))}${linhaC('Destino', esc(nomeEquip(r.destinoId)))}${linhaC('Amostra de contraprova', esc(r.amostraRetida || ''))}</tbody></table>
    <h3>2. Pesagem</h3><table class="tbl"><tbody>${linhaC('Peso bruto', n0(r.pesoBruto) + ' kg')}${linhaC('Tara', n0(r.tara) + ' kg')}${linhaC('<b>Peso líquido</b>', '<b>' + n0(c.liquido) + ' kg</b>')}</tbody></table>
    <h3>3. Amostra e descontos</h3><table class="tbl"><tbody>${linhaC('Umidade', n1(r.umidade) + `% (padrão ${n1(r.umidadePadrao)}%)`)}${r.impureza !== '' && r.impureza != null ? linhaC('Impureza e matérias estranhas', n1(r.impureza) + `% (padrão ${n1(r.impurezaPadrao)}%)`) : ''}${linhaC('Método', r.metodoDesc === 'tabela' ? `Tabela: ${num(r.fatorUmid, 2)}% por ponto de umidade, ${num(r.fatorImp ?? 1, 2)}% por ponto de impureza` : 'Balanço de massa')}
      ${c.linhas.map(l => linhaC(esc('Desconto — ' + l.rotulo.toLowerCase()), `${num(l.percentual, 2)}% → − ${n0(l.descontoKg)} kg`)).join('')}${linhaC('<b>Peso final (líquido e limpo)</b>', `<b>${n0(c.pesoFinal)} kg = ${sacas(c.pesoFinal)}</b>`)}</tbody></table>
    ${cl ? `<h3>4. Classificação</h3><table class="tbl"><tbody>${linhaC('Grupo', esc(cl.grupoRotulo || ''))}${Object.entries(r.classif.valores || {}).map(([k, x]) => linhaC(esc(rotuloDefeito(r.produto, k)), num(x, 2) + '%')).join('')}${linhaC('<b>Enquadramento</b>', `<b>${esc(cl.enquadramento || 'faltam defeitos para enquadrar')}</b>`)}${(cl.consequencias || []).length ? linhaC('Observação', esc(cl.consequencias.join(' '))) : ''}</tbody></table><p class="nota">${cl.origem === 'fazenda' ? `Tabela da fazenda (${esc(cl.fonte || '')}) — não é norma oficial.` : `Tabela ${esc(cl.tabelaId || '')} (MAPA).`} A classificação oficial é feita por classificador credenciado.</p>` : ''}
    ${r.notes ? `<p><b>Observações:</b> ${esc(r.notes)}</p>` : ''}${assinaturas('Responsável pela balança / recebimento', 'Motorista' + (r.motorista ? ' — ' + r.motorista : ''))}</article>`;
}
function comprovanteSaida(id) {
  const m = find('movSilo', id); if (!m) return empty('Saída não encontrada', '', {act: 'nav', id: 'graos/silos', label: 'Voltar'});
  const vd = m.vendaId ? find('vendas', m.vendaId) : null;
  return `<div class="no-print">${head('Comprovante de expedição', `${fmtDate(m.date)} • ${nomeEquip(m.siloId)}`, btn('← Silos', 'nav', 'graos/silos', 'secondary') + btn('Imprimir / PDF', 'af-imprimir'))}</div>
  <article class="card panel relatorio"><header class="rel-head"><div><strong>Expedição de grãos</strong><br><small>${esc(db.settings.farm || '')}</small></div><small>${fmtDate(m.date)}</small></header>
    <table class="tbl"><tbody>${linhaC('Silo', esc(nomeEquip(m.siloId)))}${linhaC('Produto', esc(culturaDoSilo(m.siloId)))}${linhaC('Dono do grão', esc(m.dono === 'terceiro' ? 'Terceiro — ' + m.depositante : 'Próprio'))}${linhaC('<b>Quantidade</b>', `<b>${n0(m.kg)} kg = ${sacas(m.kg)}</b>`)}
      ${linhaC('Umidade na expedição', m.umidade !== '' && m.umidade != null ? n1(m.umidade) + '%' : '')}${linhaC('Impureza na expedição', m.impureza !== '' && m.impureza != null ? n1(m.impureza) + '%' : '')}${linhaC('Comprador / destino', esc(m.comprador || ''))}${linhaC('Placa', esc(m.placa || ''))}${linhaC('Motorista', esc(m.motorista || ''))}${linhaC('Nota / contrato', esc(m.doc || ''))}
      ${vd ? linhaC('Venda', `${num(vd.sacas, 2)} sc × R$ ${num(vd.preco, 2)} = <b>R$ ${num(vd.valor, 2)}</b> (${esc(vd.recebimento || '')})`) : ''}</tbody></table>
    ${m.notes ? `<p><b>Observações:</b> ${esc(m.notes)}</p>` : ''}${assinaturas('Responsável pela expedição', 'Motorista' + (m.motorista ? ' — ' + m.motorista : ''))}</article>`;
}

// ---------- Terceiros: grão de outros produtores (secagem e armazenagem como serviço) ----------
const depositantes = () => [...new Set([...db.romaneios.filter(r => r.dono === 'terceiro').map(r => r.depositante), ...db.movSilo.filter(m => m.dono === 'terceiro').map(m => m.depositante)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
const tarifas = () => ({secagemT: '', armazenagemScMes: '', ...(db.settings.tarifasGraos || {})});
function extratoTerceiro(nome) {
  const ent = db.romaneios.filter(r => r.dono === 'terceiro' && r.depositante === nome).map(r => ({date: r.date, kg: r.calc?.pesoFinal || 0, umido: r.calc?.liquido || 0, secou: r.destinoTipo === 'secador', ref: `Romaneio nº ${r.numero}`, id: r.id}));
  const sai = db.movSilo.filter(m => m.dono === 'terceiro' && m.depositante === nome && m.tipo === 'saida').map(m => ({date: m.date, kg: Number(m.kg) || 0, ref: [m.comprador, m.placa].filter(Boolean).join(' • ') || 'Retirada', id: m.id}));
  const t = tarifas(), kgSc = typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60;
  const entrou = ent.reduce((s, x) => s + x.kg, 0), saiu = sai.reduce((s, x) => s + x.kg, 0);
  const secagem = (Number(t.secagemT) || 0) * ent.filter(x => x.secou).reduce((s, x) => s + x.umido, 0) / 1000;
  // Armazenagem: saldo de cada dia × tarifa por saca por mês ÷ 30, do primeiro recebimento até hoje
  let arm = 0; const tarDia = (Number(t.armazenagemScMes) || 0) / 30;
  if (tarDia && ent.length) { const datas = [...ent, ...sai]; let d = ent.map(x => x.date).sort()[0]; while (d <= today()) { const sd = datas.filter(x => x.date <= d).reduce((s, x) => s + (ent.includes(x) ? x.kg : -x.kg), 0); arm += Math.max(0, sd) / kgSc * tarDia; d = addDias(d, 1); } }
  return {ent, sai, entrou, saiu, saldo: Math.max(0, entrou - saiu), secagem, armazenagem: arm, total: secagem + arm};
}
function tarifasForm() {
  const t = tarifas();
  openForm({title: 'Tarifas para terceiros', sub: 'Preço do serviço cobrado de outros produtores. Usadas no extrato de cada um.', values: t,
    fields: [{k: 'secagemT', label: 'Secagem e limpeza (R$ por tonelada recebida úmida)', type: 'number', min: 0}, {k: 'armazenagemScMes', label: 'Armazenagem (R$ por saca por mês)', type: 'number', min: 0, hint: 'Cobrada por dia sobre o saldo de cada dia.'}],
    onSubmit: v => { db.settings.tarifasGraos = v; save(); showToast('Tarifas salvas'); }});
}
function telaTerceiros() {
  const deps = depositantes(), t = tarifas();
  return `<section class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Grão de terceiros</h3><button data-act="gr-tarifas">Tarifas${t.secagemT || t.armazenagemScMes ? `: secagem R$ ${num(t.secagemT || 0, 2)}/t • armazenagem R$ ${num(t.armazenagemScMes || 0, 2)}/sc/mês` : ' (definir)'}</button></div>
    ${deps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produtor</th><th class="num">Recebido</th><th class="num">Retirado</th><th class="num">Saldo</th><th class="num">A cobrar</th><th></th></tr></thead><tbody>${deps.map(d => { const e = extratoTerceiro(d); return `<tr><td><b>${esc(d)}</b></td><td class="num">${kgT(e.entrou)}</td><td class="num">${kgT(e.saiu)}</td><td class="num"><b>${kgT(e.saldo)}</b><br><small class="nota">${sacas(e.saldo)}</small></td><td class="num">${e.total ? 'R$ ' + num(e.total, 2) : '—'}</td><td>${mini('Extrato', 'nav', 'graos/extrato/' + encodeURIComponent(d))}</td></tr>`; }).join('')}</tbody></table></div>`
      : `<p class="nota" style="margin:0">Na moega, escolha “Dono do grão: Terceiro” para receber carga de outro produtor. O app separa o saldo de cada um, não lança como colheita da fazenda e calcula a cobrança de secagem e armazenagem.</p>`}</section>`;
}
function telaExtrato(nome) {
  const e = extratoTerceiro(nome), t = tarifas();
  const linhas = [...e.ent.map(x => ({...x, tipo: 'Entrada', sinal: 1})), ...e.sai.map(x => ({...x, tipo: 'Retirada', sinal: -1}))].sort((a, b) => a.date.localeCompare(b.date));
  let saldo = 0;
  return `<div class="no-print">${head(`Extrato — ${nome}`, 'Grão de terceiro: entradas, retiradas, saldo e serviços', btn('← Terceiros', 'nav', 'graos/terceiros', 'secondary') + btn('Imprimir / PDF', 'af-imprimir'))}</div>
  <article class="card panel relatorio"><header class="rel-head"><div><strong>Extrato de grãos — ${esc(nome)}</strong><br><small>${esc(db.settings.farm || '')}</small></div><small>até ${fmtDate(today())}</small></header>
    <table class="tbl"><thead><tr><th>Data</th><th>Movimento</th><th class="num">kg</th><th class="num">Saldo</th></tr></thead><tbody>${linhas.map(x => { saldo += x.sinal * x.kg; return `<tr><td>${fmtDate(x.date)}</td><td>${x.tipo} — ${esc(x.ref)}</td><td class="num">${x.sinal < 0 ? '−' : '+'} ${n0(x.kg)}</td><td class="num">${n0(saldo)}</td></tr>`; }).join('')}</tbody></table>
    <h3>Resumo</h3><table class="tbl"><tbody>${linhaC('Recebido (líquido e limpo)', `${n0(e.entrou)} kg = ${sacas(e.entrou)}`)}${linhaC('Retirado', `${n0(e.saiu)} kg = ${sacas(e.saiu)}`)}${linhaC('<b>Saldo armazenado</b>', `<b>${n0(e.saldo)} kg = ${sacas(e.saldo)}</b>`)}
      ${linhaC('Secagem e limpeza', t.secagemT ? `R$ ${num(e.secagem, 2)} (R$ ${num(t.secagemT, 2)}/t sobre o peso úmido que passou no secador)` : 'tarifa não definida')}${linhaC('Armazenagem', t.armazenagemScMes ? `R$ ${num(e.armazenagem, 2)} (R$ ${num(t.armazenagemScMes, 2)}/sc/mês, por dia sobre o saldo)` : 'tarifa não definida')}${linhaC('<b>Total a cobrar</b>', `<b>R$ ${num(e.total, 2)}</b>`)}</tbody></table>
    ${assinaturas('Armazém / responsável', nome)}</article>`;
}

// ---------- Expurgo (fumigação) e limpeza do secador ----------
function expurgoForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  openForm({title: `Expurgo — ${s.name}`, sub: 'Fumigação contra pragas de grãos armazenados. Produto, dose e tempo de exposição vêm do receituário e da bula.', values: {date: today(), time: nowTime(), exposicaoH: ''},
    fields: [{k: 'date', label: 'Início', type: 'date', required: true}, {k: 'time', label: 'Hora', type: 'time'},
      {k: 'produto', label: 'Produto (ingrediente ativo)', required: true, placeholder: 'Ex.: fosfina'}, {k: 'dose', label: 'Dose aplicada', placeholder: 'Ex.: 2 g/m³'},
      {k: 'exposicaoH', label: 'Tempo de exposição (horas, da bula)', type: 'number', min: 1, required: true}, {k: 'praga', label: 'Praga alvo', placeholder: 'Ex.: caruncho, traça'},
      {k: 'receituario', label: 'Receituário agronômico'}, {k: 'responsavel', label: 'Aplicador responsável'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    submit: 'Registrar expurgo',
    onSubmit: v => {
      const ini = new Date(`${v.date}T${v.time || '00:00'}`), fim = new Date(ini.getTime() + v.exposicaoH * 36e5);
      upsert('checklistsGraos', {id: uid(), tipo: 'expurgo', equipId: siloId, ...v, inicio: `${v.date}T${v.time || '00:00'}`, fimExposicao: `${isoDate(fim)}T${String(fim.getHours()).padStart(2, '0')}:${String(fim.getMinutes()).padStart(2, '0')}`});
      showToast(`Expurgo registrado: silo fechado até ${fmtDH(`${isoDate(fim)}T${String(fim.getHours()).padStart(2, '0')}:${String(fim.getMinutes()).padStart(2, '0')}`)}`);
    }});
}
const expurgoAtivo = siloId => db.checklistsGraos.filter(c => c.tipo === 'expurgo' && c.equipId === siloId && !c.liberadoEm && c.fimExposicao > agoraISO()).sort((a, b) => b.fimExposicao.localeCompare(a.fimExposicao))[0] || null;
const ITENS_LIMPEZA = [['camara', 'Câmara de ar quente e dutos sem pó e palha'], ['colunas', 'Colunas / calhas de secagem limpas (sem grão preso)'], ['fornalha', 'Fornalha: cinzas retiradas, grelha e portas conferidas'],
  ['ciclone', 'Ciclone, exaustor e coletores de pó limpos'], ['elevadores', 'Elevadores e transportadores sem acúmulo'], ['sensores', 'Termômetros / sensores de temperatura funcionando'], ['extintores', 'Extintores no lugar e dentro da validade']];
const DIAS_LIMPEZA = 7;
function limpezaForm(secadorId) {
  const m = find('machines', secadorId); if (!m) return;
  openForm({title: `Limpeza e inspeção — ${m.name}`, sub: 'Marque o que foi feito. Itens pendentes ficam registrados.', values: {date: today(), ...Object.fromEntries(ITENS_LIMPEZA.map(([k]) => [k, 'sim']))},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true}, ...ITENS_LIMPEZA.map(([k, n]) => ({k, label: n, type: 'select', options: [{value: 'sim', label: 'Feito / ok'}, {value: 'nao', label: 'Pendente'}], full: true})), {k: 'responsavel', label: 'Responsável'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => { const pend = ITENS_LIMPEZA.filter(([k]) => v[k] === 'nao').length; upsert('checklistsGraos', {id: uid(), tipo: 'limpeza_secador', equipId: secadorId, ...v, pendentes: pend}); showToast(pend ? `Limpeza registrada com ${pend} ${pend === 1 ? 'pendência' : 'pendências'}` : 'Limpeza registrada'); }});
}
const ultimaLimpeza = secadorId => db.checklistsGraos.filter(c => c.tipo === 'limpeza_secador' && c.equipId === secadorId).sort((a, b) => b.date.localeCompare(a.date))[0] || null;

// ---------- Rastreabilidade: de quais talhões veio o grão do silo ----------
function origemSilo(siloId) {
  const por = {};
  const somar = (fieldId, kg, dono, dep) => { const k = dono === 'terceiro' ? 'Terceiro: ' + dep : fieldName(fieldId) || 'Sem talhão'; por[k] = (por[k] || 0) + kg; };
  db.romaneios.filter(r => r.destinoTipo === 'silo' && r.destinoId === siloId).forEach(r => somar(r.fieldId, r.calc?.pesoFinal || 0, r.dono, r.depositante));
  db.lotesSecagem.filter(l => l.status === 'Concluída' && l.siloId === siloId).forEach(l => {
    const rs = (l.romaneioIds || []).map(i => find('romaneios', i)).filter(Boolean), tot = rs.reduce((s, r) => s + (r.calc?.liquido || 0), 0), mf = calcSecagem(l).mf || 0;
    if (!rs.length || !tot) somar('', mf); else rs.forEach(r => somar(r.fieldId, mf * (r.calc?.liquido || 0) / tot, r.dono, r.depositante));
  });
  const total = Object.values(por).reduce((s, x) => s + x, 0);
  return total ? Object.entries(por).map(([nome, kg]) => ({nome, kg, pct: kg / total * 100})).sort((a, b) => b.kg - a.kg) : [];
}

// ---------- Avisos adicionais ----------
const alertasSemGraos2 = alerts;
alerts = function () {
  const lista = alertasSemGraos2();
  if (typeof nvPodeRota === 'function' && !nvPodeRota('graos')) return lista;
  equipDoTipo('Secador').forEach(m => {
    const usado = db.lotesSecagem.some(l => l.secadorId === m.id && (l.status === 'Em andamento' || (l.fim || '') >= daysAgo(DIAS_LIMPEZA) + 'T')), u = ultimaLimpeza(m.id);
    if (usado && (!u || diasEntreAuto(u.date, today()) > DIAS_LIMPEZA)) lista.push({color: 'orange', icon: '⚙', title: `Limpeza do secador: ${m.name}`, text: u ? `Última há ${diasEntreAuto(u.date, today())} dias. Pó e palha acumulados causam incêndio.` : 'Nenhuma limpeza registrada com o secador em uso.', route: 'graos/secador'});
  });
  equipDoTipo('Silo/Armazém').forEach(m => {
    const sd = saldoSilo(m);
    if (sd.cap && sd.saldo > sd.cap + 1) lista.push({color: 'red', icon: '⚠', title: `Silo acima da capacidade: ${m.name}`, text: `${kgT(sd.saldo)} lançados para ${kgT(sd.cap)} (${n0(sd.ocupacao)}%). Confira os lançamentos ou a capacidade cadastrada.`, route: 'graos/silos'});
  });
  equipDoTipo('Silo/Armazém').forEach(s => {
    const e = expurgoAtivo(s.id), tm = termometriaSilo(s.id);
    if (e) lista.push({color: 'purple', icon: '!', title: `${s.name} em expurgo`, text: `${e.produto} até ${fmtDH(e.fimExposicao)}: não abrir nem movimentar.`, route: 'graos/silos'});
    if (tm?.ult?.insetos && tm.ult.insetos !== 'nao' && !e) lista.push({color: tm.ult.insetos === 'muitos' ? 'red' : 'orange', icon: '✱', title: `Insetos no ${s.name}`, text: `${tm.ult.insetos === 'muitos' ? 'Muitos' : 'Poucos'} insetos vivos${tm.ult.especie ? ' (' + tm.ult.especie + ')' : ''} em ${fmtDate(tm.ult.date)}. Avalie expurgo com o agrônomo.`, route: 'graos/silos'});
  });
  return lista;
};

// ---------- Inventário do silo: medição real × saldo do sistema (quebra de armazenagem) ----------
function inventarioForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  const sd = saldoSilo(s).saldo;
  openForm({title: `Inventário — ${s.name}`, sub: `Saldo no sistema: ${kgT(sd)} (${sacas(sd)}). Informe o que foi medido; o app calcula a diferença e ajusta o estoque.`, values: {date: today(), metodo: 'cubagem'},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true}, {k: 'medidoT', label: 'Quantidade medida (t)', type: 'number', min: 0, required: true},
      {k: 'metodo', label: 'Como foi medido', type: 'select', options: [{value: 'cubagem', label: 'Cubagem (altura × volume × densidade)'}, {value: 'balanca', label: 'Pesagem total na balança'}, {value: 'estimativa', label: 'Estimativa'}]},
      {k: 'responsavel', label: 'Responsável'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    submit: 'Registrar e ajustar',
    onSubmit: v => {
      const medido = v.medidoT * 1000, dif = medido - sd, pct = sd ? dif / sd * 100 : 0, id = uid();
      upsert('checklistsGraos', {id, tipo: 'inventario', equipId: siloId, date: v.date, metodo: v.metodo, responsavel: v.responsavel, notes: v.notes, medidoKg: medido, sistemaKg: sd, difKg: dif, difPct: pct});
      if (Math.abs(dif) >= 1) upsert('movSilo', {id: uid(), siloId, tipo: 'ajuste', date: v.date, kg: Math.round(dif), dono: 'proprio', inventarioId: id, notes: `Inventário (${v.metodo}): medido ${n0(medido)} kg, sistema ${n0(sd)} kg`});
      showToast(`Inventário: diferença de ${dif >= 0 ? '+' : '−'}${kgT(Math.abs(dif))} (${num(pct, 2)}%) — estoque ajustado`);
    }});
}
const ultimoInventario = siloId => db.checklistsGraos.filter(c => c.tipo === 'inventario' && c.equipId === siloId).sort((a, b) => b.date.localeCompare(a.date))[0] || null;

// ---------- Medidor de umidade da moega: conferência com referência e verificação anual do Inmetro ----------
// Portaria Inmetro nº 47/2022 (medidores de umidade de grãos): verificação periódica obrigatória, anual (subitem 6.3.1.1).
const medidores = () => [...new Set(db.checklistsGraos.filter(c => c.tipo === 'conf_umidade' || c.tipo === 'inmetro_umidade').map(c => c.medidor).filter(Boolean))].sort();
const ultimoDoMedidor = (nome, tipo) => db.checklistsGraos.filter(c => c.tipo === tipo && c.medidor === nome).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
function medidorForm(nome = '') {
  const tol = db.settings.toleranciaMedidor ?? '';
  openForm({title: 'Conferir medidor de umidade', sub: 'Meça as mesmas amostras no medidor da moega e numa referência (estufa / laboratório / medidor verificado). O app calcula o erro e o efeito no desconto.',
    values: {medidor: nome || medidores()[0] || '', date: today(), ref: 'estufa', tolerancia: tol},
    fields: [{k: 'medidor', label: 'Medidor', required: true, placeholder: 'Ex.: Gehaka da moega'}, {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'ref', label: 'Referência', type: 'select', options: [{value: 'estufa', label: 'Estufa (método oficial)'}, {value: 'laboratorio', label: 'Laboratório / classificadora'}, {value: 'medidor', label: 'Outro medidor verificado pelo Inmetro'}]},
      {k: 'produto', label: 'Produto', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l}))},
      ...[1, 2, 3, 4, 5].flatMap(i => [{k: 'm' + i, label: `Amostra ${i} — medidor (%)`, type: 'number', min: 0}, {k: 'r' + i, label: `Amostra ${i} — referência (%)`, type: 'number', min: 0}]),
      {k: 'tolerancia', label: 'Tolerância aceita (± pontos)', type: 'number', min: 0, hint: 'Do fabricante ou do Inmetro, se você tiver. Sem tolerância, o app só mostra o erro.'}],
    submit: 'Calcular e salvar',
    onSubmit: v => {
      const pares = [1, 2, 3, 4, 5].map(i => [numOuU(v['m' + i]), numOuU(v['r' + i])]).filter(([m, r]) => m != null && r != null);
      if (pares.length < 2) return 'Informe pelo menos 2 amostras (medidor e referência)';
      const erros = pares.map(([m, r]) => m - r), medio = erros.reduce((a, b) => a + b, 0) / erros.length, maior = erros.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
      const t = numOuU(v.tolerancia); if (t != null) db.settings.toleranciaMedidor = t;
      upsert('checklistsGraos', {id: uid(), tipo: 'conf_umidade', medidor: v.medidor, date: v.date, ref: v.ref, produto: v.produto, pares, erroMedio: medio, maiorErro: maior, tolerancia: t ?? null, ok: t == null ? null : erros.every(e => Math.abs(e) <= t)});
      showToast(`Erro médio ${medio >= 0 ? '+' : ''}${num(medio, 2)} ponto${t != null ? (erros.every(e => Math.abs(e) <= t) ? ' — dentro da tolerância' : ' — FORA da tolerância') : ''}`, t != null && !erros.every(e => Math.abs(e) <= t));
    }});
}
function inmetroForm(nome = '') {
  openForm({title: 'Verificação do Inmetro', sub: 'Obrigatória uma vez por ano (Portaria Inmetro nº 47/2022).', values: {medidor: nome || medidores()[0] || '', date: today()},
    fields: [{k: 'medidor', label: 'Medidor', required: true}, {k: 'date', label: 'Data da verificação', type: 'date', required: true}, {k: 'selo', label: 'Selo / certificado'}, {k: 'resultado', label: 'Resultado', type: 'select', options: ['Aprovado', 'Reprovado']}],
    onSubmit: v => { upsert('checklistsGraos', {id: uid(), tipo: 'inmetro_umidade', ...v}); showToast('Verificação registrada'); }});
}
function blocoMedidores() {
  const ms = medidores(), rec = db.romaneios.filter(r => r.date >= daysAgo(365)).reduce((s, r) => s + (r.calc?.liquido || 0), 0);
  return `<section class="card panel"><div class="section-title" style="margin:0 0 6px"><h3>Medidor de umidade</h3><div class="btn-row" style="margin:0">${btn('Conferir medidor', 'gr-medidor', '', 'secondary')}${btn('Verificação Inmetro', 'gr-inmetro', '', 'secondary')}</div></div>
    ${ms.length ? ms.map(n => { const c = ultimoDoMedidor(n, 'conf_umidade'), i = ultimoDoMedidor(n, 'inmetro_umidade'), venc = i ? addDias(i.date, 365) : null;
      return `<div class="hoje-item"><span class="alert-icon ${c?.ok === false || (venc && venc < today()) || !i ? 'orange' : 'green'}">◎</span><div><strong>${esc(n)}</strong><small>${c ? `Conferido em ${fmtDate(c.date)}: erro médio ${c.erroMedio >= 0 ? '+' : ''}${num(c.erroMedio, 2)} ponto${c.ok === false ? ' — <b class="txt-red">fora da tolerância</b>' : c.ok ? ' — dentro da tolerância' : ''}${Math.abs(c.erroMedio) >= 0.1 && rec ? ` • em 12 meses de recebimento (${kgT(rec)}) isso muda o desconto em cerca de ${kgT(Math.abs(c.erroMedio) / 100 * rec)} ${c.erroMedio > 0 ? 'a mais' : 'a menos'}` : ''}` : 'Sem conferência registrada'} • ${i ? `Inmetro ${fmtDate(i.date)} (${esc(i.resultado || '')}) — vence ${fmtDate(venc)}` : 'Sem verificação do Inmetro registrada'}</small></div>${mini('Conferir', 'gr-medidor', n)}</div>`; }).join('')
      : `<p class="nota" style="margin:0">O medidor de umidade decide o desconto de cada carga: meio ponto de erro numa safra vira muitas sacas. Confira com amostras de referência e registre a verificação anual obrigatória do Inmetro.</p>`}</section>`;
}

// ---------- Relatório da safra de grãos ----------
function relatorioSafraGraos(safraArg) {
  const safras = [...new Set(db.romaneios.map(r => r.season).filter(Boolean))].sort().reverse(), sf = safraArg || safras[0] || '';
  const rs = db.romaneios.filter(r => !sf || r.season === sf), proprio = rs.filter(r => r.dono !== 'terceiro');
  const porTalhao = {}; proprio.forEach(r => { const k = fieldName(r.fieldId) || 'Sem talhão', p = porTalhao[k] ||= {cargas: 0, liq: 0, desc: 0, fin: 0, um: 0}; p.cargas++; p.liq += r.calc?.liquido || 0; p.desc += r.calc?.descontoKg || 0; p.fin += r.calc?.pesoFinal || 0; p.um += (Number(r.umidade) || 0) * (r.calc?.liquido || 0); });
  const ids = new Set(rs.map(r => r.id)), lotes = db.lotesSecagem.filter(l => l.status === 'Concluída' && ((l.romaneioIds || []).some(i => ids.has(i)) || (!l.romaneioIds?.length && (!sf || true))));
  const sec = lotes.reduce((a, l) => { const c = calcSecagem(l); a.mi += c.mi; a.mf += c.mf || 0; a.agua += c.agua || 0; a.h += c.horas; a.custo += c.custo || 0; return a; }, {mi: 0, mf: 0, agua: 0, h: 0, custo: 0});
  const tot = Object.values(porTalhao).reduce((a, p) => ({cargas: a.cargas + p.cargas, liq: a.liq + p.liq, desc: a.desc + p.desc, fin: a.fin + p.fin}), {cargas: 0, liq: 0, desc: 0, fin: 0});
  const silos = equipDoTipo('Silo/Armazém'), deps = depositantes(), kgSc = typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60;
  const saidas = db.movSilo.filter(m => m.tipo === 'saida' && m.dono !== 'terceiro' && (!sf || db.vendas.find(v => v.id === m.vendaId)?.season === sf || !m.vendaId));
  return `<div class="no-print">${head('Relatório da safra de grãos', sf ? `Safra ${sf}` : 'Todas as cargas', btn('← Grãos', 'nav', 'graos', 'secondary') + btn('Imprimir / PDF', 'af-imprimir'))}${safras.length > 1 ? `<div class="filters">${safras.map(x => `<button class="${x === sf ? 'active' : ''}" data-act="nav" data-id="graos/relatorio/${encodeURIComponent(x)}">${esc(x)}</button>`).join('')}</div>` : ''}</div>
  <article class="card panel relatorio"><header class="rel-head"><div><strong>Recebimento, secagem e armazenagem${sf ? ' — safra ' + esc(sf) : ''}</strong><br><small>${esc(db.settings.farm || '')}</small></div><small>até ${fmtDate(today())}</small></header>
    <h3>1. Recebido por talhão (grão próprio)</h3><table class="tbl"><thead><tr><th>Talhão</th><th class="num">Cargas</th><th class="num">Líquido</th><th class="num">Umidade média</th><th class="num">Descontos</th><th class="num">Final</th><th class="num">Sacas</th></tr></thead><tbody>
      ${Object.entries(porTalhao).sort((a, b) => b[1].fin - a[1].fin).map(([k, p]) => `<tr><td>${esc(k)}</td><td class="num">${p.cargas}</td><td class="num">${kgT(p.liq)}</td><td class="num">${p.liq ? n1(p.um / p.liq) + '%' : '—'}</td><td class="num">${kgT(p.desc)}</td><td class="num">${kgT(p.fin)}</td><td class="num">${sacas(p.fin)}</td></tr>`).join('') || '<tr><td colspan="7">Nenhuma carga própria.</td></tr>'}
      <tr><td><b>Total</b></td><td class="num"><b>${tot.cargas}</b></td><td class="num"><b>${kgT(tot.liq)}</b></td><td></td><td class="num"><b>${kgT(tot.desc)}</b> (${tot.liq ? num(tot.desc / tot.liq * 100, 2) : 0}%)</td><td class="num"><b>${kgT(tot.fin)}</b></td><td class="num"><b>${sacas(tot.fin)}</b></td></tr></tbody></table>
    <h3>2. Secagem</h3><table class="tbl"><tbody>${linhaC('Secagens concluídas', String(lotes.length))}${linhaC('Entrada no secador', kgT(sec.mi))}${linhaC('Grão seco', `${kgT(sec.mf)} = ${sacas(sec.mf)}`)}${linhaC('Água retirada', kgT(sec.agua))}${linhaC('Horas de secador', um1(sec.h) + ' h' + (sec.h ? ` • ${n1(sec.mi / 1000 / sec.h)} t/h` : ''))}${linhaC('Custo de combustível e energia', sec.custo ? `R$ ${num(sec.custo, 2)} • R$ ${num(sec.custo / (sec.mf / kgSc), 2)} por saca seca` : 'não informado')}</tbody></table>
    <h3>3. Silos hoje</h3><table class="tbl"><thead><tr><th>Silo</th><th class="num">Saldo</th><th class="num">Ocupação</th><th class="num">Umidade média</th><th>Último inventário</th></tr></thead><tbody>${silos.map(s => { const d = saldoSilo(s), iv = ultimoInventario(s.id); return `<tr><td>${esc(s.name)}</td><td class="num">${kgT(d.saldo)} (${sacas(d.saldo)})</td><td class="num">${d.ocupacao != null ? n0(d.ocupacao) + '%' : '—'}</td><td class="num">${d.uMedia != null ? n1(d.uMedia) + '%' : '—'}</td><td>${iv ? `${fmtDate(iv.date)}: ${num(iv.difPct, 2)}%` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="5">Nenhum silo cadastrado.</td></tr>'}</tbody></table>
    <h3>4. Expedições de grão próprio</h3><table class="tbl"><tbody>${linhaC('Saídas', `${saidas.length} • ${kgT(saidas.reduce((a, m) => a + (Number(m.kg) || 0), 0))} = ${sacas(saidas.reduce((a, m) => a + (Number(m.kg) || 0), 0))}`)}${linhaC('Vendas lançadas pela expedição', (() => { const vs = saidas.map(m => find('vendas', m.vendaId)).filter(Boolean); return vs.length ? `${vs.length} • R$ ${num(vs.reduce((a, v) => a + (Number(v.valor) || 0), 0), 2)}` : 'nenhuma'; })())}</tbody></table>
    ${deps.length ? `<h3>5. Terceiros</h3><table class="tbl"><thead><tr><th>Produtor</th><th class="num">Recebido</th><th class="num">Retirado</th><th class="num">Saldo</th><th class="num">A cobrar</th></tr></thead><tbody>${deps.map(d => { const e = extratoTerceiro(d); return `<tr><td>${esc(d)}</td><td class="num">${kgT(e.entrou)}</td><td class="num">${kgT(e.saiu)}</td><td class="num">${kgT(e.saldo)}</td><td class="num">R$ ${num(e.total, 2)}</td></tr>`; }).join('')}</tbody></table>` : ''}
  </article>`;
}

// ---------- Avisos: secagem na meta e Inmetro vencido ----------
const alertasSemGraos3 = alerts;
alerts = function () {
  const lista = alertasSemGraos3();
  if (typeof nvPodeRota === 'function' && !nvPodeRota('graos')) return lista;
  db.lotesSecagem.filter(l => l.status === 'Em andamento').forEach(l => { const c = calcSecagem(l); if (c.previsao?.chegou) lista.unshift({color: 'green', icon: '✓', title: `Secagem chegou a ${n1(c.previsao.meta)}%: ${nomeEquip(l.secadorId)}`, text: 'Confira a amostra e finalize para mandar ao silo.', route: 'graos/lote/' + l.id}); });
  medidores().forEach(n => {
    const i = ultimoDoMedidor(n, 'inmetro_umidade'), c = ultimoDoMedidor(n, 'conf_umidade');
    if (i && addDias(i.date, 365) < today()) lista.push({color: 'orange', icon: '◎', title: `Medidor de umidade com verificação vencida: ${n}`, text: `Última do Inmetro em ${fmtDate(i.date)}. A verificação é anual (Portaria Inmetro nº 47/2022).`, route: 'graos/moega'});
    if (c?.ok === false) lista.push({color: 'red', icon: '◎', title: `Medidor de umidade fora da tolerância: ${n}`, text: `Erro médio ${num(c.erroMedio, 2)} ponto em ${fmtDate(c.date)}. Ajuste ou leve para verificação antes de descontar cargas.`, route: 'graos/moega'});
  });
  return lista;
};

// Leituras avulsas (secagem.js) com a mesma lista de culturas
if (typeof PRODUTOS_SEC !== 'undefined') PRODUTOS_SEC.splice(0, PRODUTOS_SEC.length, ...PRODUTOS_GRAO.filter(([k]) => k !== 'outro'), ['outro', 'Outro']);
