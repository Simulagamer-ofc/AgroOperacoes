'use strict';
/* Nexus Agro — Grãos: moega (romaneio de recebimento), secador (secagem por lote, planilha de hora em hora) e silos
   (saldo, saídas, termometria e horas boas para aerar). Tudo ligado: a carga recebida entra sozinha na colheita do talhão
   e no silo (direto ou depois do secador); o app calcula descontos, água retirada, rendimento do secador, lenha por
   tonelada e custo por saca. Referências técnicas vêm do banco de regras (avaliador), não ficam fixas aqui. */

const PRODUTOS_GRAO = [['soja', 'Soja'], ['milho', 'Milho'], ['trigo', 'Trigo'], ['feijao', 'Feijão'], ['sorgo', 'Sorgo'], ['arroz', 'Arroz'], ['outro', 'Outro']];
const DESTINOS_GRAO = [['comercializacao', 'Grão — venda'], ['armazenamento_graos', 'Grão — armazenagem'], ['racao_animal', 'Grão — ração animal'], ['moagem_alimentacao_humana', 'Grão — moagem / alimentação humana'], ['agroindustria', 'Grão — agroindústria'], ['semente', 'Semente para plantio']];
const COMBUSTIVEIS = [['lenha', 'Lenha', 'm³ st'], ['cavaco', 'Cavaco', 't'], ['glp', 'GLP', 'kg'], ['gas', 'Gás natural', 'm³'], ['diesel', 'Diesel', 'L'], ['outro', 'Outro', 'un']];
const n0 = v => Math.round(Number(v) || 0).toLocaleString('pt-BR'), n1 = v => (Number(v) || 0).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const nomeProd = p => (PRODUTOS_GRAO.find(x => x[0] === p) || [, p || '—'])[1];
const unComb = t => (COMBUSTIVEIS.find(x => x[0] === t) || [, , 'un'])[2];
const equipDoTipo = tipo => db.machines.filter(m => m.type === tipo && m.status !== 'Inativa');
const nomeEquip = id => find('machines', id)?.name || '—';
const kgT = kg => n1((Number(kg) || 0) / 1000) + ' t';
const sacas = kg => n0((Number(kg) || 0) / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)) + ' sc';
const agoraISO = () => `${today()}T${nowTime()}`;
const horasEntre = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 36e5);
const fmtDH = iso => iso ? `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—';
// Padrões de desconto: os do último romaneio do mesmo produto (o contrato raramente muda na safra)
const PADRAO_INICIAL = {umidade: 14, impureza: 1};
const padroesGrao = p => ({...PADRAO_INICIAL, ...(db.settings.padroesGrao?.[p] || {})});

// ---------- Cálculos ----------
// Romaneio: peso líquido, descontos (balanço de massa ou tabela do comprador) e peso final seco e limpo
function calcRomaneio(r) {
  const liquido = (Number(r.pesoBruto) || 0) - (Number(r.tara) || 0);
  const d = liquido > 0 && typeof AV === 'function' && AV() ? AV().descontosCarga({pesoLiquido: liquido, umidade: numOuU(r.umidade), umidadePadrao: numOuU(r.umidadePadrao),
    impureza: numOuU(r.impureza), impurezaPadrao: numOuU(r.impurezaPadrao), descUmidadePct: numOuU(r.descUmidTabela), descImpurezaPct: numOuU(r.descImpTabela)}) : null;
  return {liquido, pesoFinal: d?.pesoFinalKg ?? liquido, descontoKg: d?.descontoTotalKg ?? 0, descontoPct: d?.descontoTotalPct ?? 0, linhas: d?.linhas || []};
}
const numOuU = v => v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v);
// Secagem: massa final (água sai, matéria seca fica), água retirada, rendimento, combustível e custo
function calcSecagem(l) {
  const mi = Number(l.massaEntradaKg) || 0, ui = numOuU(l.umidadeEntrada), uf = numOuU(l.umidadeSaida) ?? numOuU(l.leituras?.at(-1)?.umidade);
  const mf = mi > 0 && ui != null && uf != null && uf < 100 ? mi * (100 - ui) / (100 - uf) : null;
  const h = horasEntre(l.inicio, l.fim || agoraISO()), agua = mf != null ? mi - mf : null;
  const q = Number(l.combustivel?.qtd) || 0, preco = Number(l.combustivel?.preco) || 0, custo = q * preco;
  return {mi, mf, agua, ui, uf, horas: h, pontos: ui != null && uf != null ? ui - uf : null, tph: h > 0 ? mi / 1000 / h : null, ppH: h > 0 && ui != null && uf != null ? (ui - uf) / h : null,
    combPorT: q && mi ? q / (mi / 1000) : null, combPorTAgua: q && agua > 0 ? q / (agua / 1000) : null, custo: custo || null,
    custoT: custo && mf ? custo / (mf / 1000) : null, custoSc: custo && mf ? custo / (mf / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)) : null};
}
// Leitura do secador avaliada pelo banco de referências (mesma lógica das leituras avulsas)
function avaliarLeituraSecador(l, leit) {
  if (typeof AV !== 'function' || !AV() || !regrasGraos) return null;
  const tipo = find('machines', l.secadorId)?.tipoSecador, leituras = [];
  if (numOuU(leit.tMassa) != null) leituras.push({ponto: 'massa_graos', variavel: 'temperatura', valor: Number(leit.tMassa)});
  if (numOuU(leit.tAr) != null) leituras.push({ponto: 'ar_entrada', variavel: 'temperatura', valor: Number(leit.tAr)});
  if (!leituras.length) return null;
  const r = AV().avaliarSecagem({equipamentoFamilia: 'secador', produto: l.produto, destino: l.destino, etapa: 'secagem', condicoes: {tipoSecador: tipo || undefined}, leituras}, regrasGraos);
  return r.leituras.map(x => ({ponto: x.ponto, status: x.avaliacao.status, limite: x.avaliacao.limiteMax, regra: x.avaliacao.regraId, acao: x.avaliacao.acaoRecomendada}));
}
function avaliarUmidadeSaida(l, u) {
  if (typeof AV !== 'function' || !AV() || !regrasGraos || numOuU(u) == null) return null;
  const r = AV().avaliarSecagem({equipamentoFamilia: 'secador', produto: l.produto, destino: l.destino, etapa: 'pos_secagem', condicoes: {}, leituras: [{ponto: 'amostra', variavel: 'umidade_graos', valor: Number(u)}], umidadeFinal: Number(u)}, regrasGraos);
  const a = r.leituras[0]?.avaliacao; return a ? {status: a.status, acao: a.acaoRecomendada, regra: a.regraId, max: a.limiteMax} : null;
}
let regrasGraos = null;
const carregarRegrasGraos = () => { if (!regrasGraos && typeof dados === 'function') dados('regras').then(b => { regrasGraos = b; if (['graos'].includes(parseRoute().name)) render(); }).catch(() => {}); };

// ---------- Silos: saldo calculado de todas as entradas e saídas ----------
function movimentosSilo(siloId) {
  const ent = [
    ...db.romaneios.filter(r => r.destinoTipo === 'silo' && r.destinoId === siloId).map(r => ({date: r.date, kg: r.calc?.pesoFinal || 0, umidade: numOuU(r.umidade), tipo: 'Recebido direto', ref: `Romaneio nº ${r.numero}`})),
    ...db.lotesSecagem.filter(l => l.status === 'Concluída' && l.siloId === siloId).map(l => { const c = calcSecagem(l); return {date: (l.fim || '').slice(0, 10), kg: c.mf || 0, umidade: c.uf, tipo: 'Do secador', ref: `Secagem ${nomeProd(l.produto)} — ${nomeEquip(l.secadorId)}`}; }),
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
    values: {date: today(), time: nowTime(), produto: prod0, season: f0?.season || safrasConhecidas?.()[0] || '', umidadePadrao: pad.umidade, impurezaPadrao: pad.impureza,
      destino: r.destinoTipo ? r.destinoTipo + '|' + r.destinoId : destinos[0]?.value || '', ...r},
    fields: [
      {k: 'fieldId', label: 'Talhão de origem', type: 'select', options: fieldOptions, hint: 'A carga vira colheita deste talhão em Produção. Deixe em branco para grão de terceiros.', full: true},
      {k: 'produto', label: 'Produto', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true},
      {k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'},
      {k: 'date', label: 'Data', type: 'date', required: true}, {k: 'time', label: 'Hora', type: 'time'},
      {k: 'placa', label: 'Placa', placeholder: 'ABC1D23'}, {k: 'motorista', label: 'Motorista'},
      {k: 'pesoBruto', label: 'Peso bruto (kg)', type: 'number', min: 0, required: true}, {k: 'tara', label: 'Tara (kg)', type: 'number', min: 0, required: true, hint: 'Peso do caminhão vazio.'},
      {k: 'umidade', label: 'Umidade da amostra (%)', type: 'number', min: 0, required: true}, {k: 'impureza', label: 'Impureza e matérias estranhas (%)', type: 'number', min: 0},
      {k: 'umidadePadrao', label: 'Umidade padrão do contrato (%)', type: 'number', min: 0, hint: 'Acima dela há desconto. Lembra o último usado.'},
      {k: 'impurezaPadrao', label: 'Impureza padrão do contrato (%)', type: 'number', min: 0},
      {k: 'destino', label: 'Para onde vai a carga', type: 'select', options: destinos, required: true, full: true, hint: destinos.length ? 'Úmida acima do padrão: secador. Já seca: silo direto.' : 'Cadastre o secador e os silos em Máquinas (tipo Secador e Silo/Armazém).'},
      {k: 'notes', label: 'Observações', type: 'textarea'}],
    submit: r.id ? 'Salvar romaneio' : 'Registrar carga',
    onSubmit: v => {
      if (!(v.pesoBruto > 0) || !(v.tara >= 0) || v.pesoBruto <= v.tara) return 'O peso bruto precisa ser maior que a tara';
      if (!v.destino) return 'Escolha o secador ou o silo de destino';
      const [destinoTipo, destinoId] = v.destino.split('|'), padNovo = padroesGrao(v.produto);
      if (destinoTipo === 'silo' && numOuU(v.umidade) > (numOuU(v.umidadePadrao) ?? padNovo.umidade) && romaneioForm.avisoSilo !== v.pesoBruto + '|' + v.umidade) {
        romaneioForm.avisoSilo = v.pesoBruto + '|' + v.umidade;
        return `Umidade ${n1(v.umidade)}% acima do padrão: o normal é mandar para o secador. Toque em registrar de novo para mandar direto ao silo mesmo assim.`;
      }
      romaneioForm.avisoSilo = '';
      const reg = {...r, ...v, id: r.id || uid(), numero: r.numero || proximoRomaneio(), destinoTipo, destinoId};
      delete reg.destino; reg.calc = calcRomaneio(reg);
      db.settings.padroesGrao = {...(db.settings.padroesGrao || {}), [v.produto]: {umidade: numOuU(v.umidadePadrao) ?? padNovo.umidade, impureza: numOuU(v.impurezaPadrao) ?? padNovo.impureza}};
      // Colheita do talhão em Produção (peso final, seco e limpo)
      if (reg.fieldId) {
        const f = find('fields', reg.fieldId), col = reg.colheitaId ? find('colheitas', reg.colheitaId) : null;
        reg.colheitaId = col?.id || uid();
        upsert('colheitas', {...(col || {}), id: reg.colheitaId, fieldId: reg.fieldId, cultura: f?.crop || nomeProd(reg.produto), season: reg.season || f?.season || '', date: reg.date, kg: Math.round(reg.calc.pesoFinal),
          umidade: reg.umidade, destino: nomeEquip(destinoId), notes: `Romaneio nº ${reg.numero}${reg.placa ? ' • ' + reg.placa : ''} (peso já descontado)`, romaneioId: reg.id});
      } else if (reg.colheitaId) { remove('colheitas', reg.colheitaId); delete reg.colheitaId; }
      upsert('romaneios', reg);
      showToast(`Romaneio nº ${reg.numero}: ${kgT(reg.calc.pesoFinal)} (${sacas(reg.calc.pesoFinal)}) líquidos e limpos → ${nomeEquip(destinoId)}`);
    }});
}
function excluirRomaneio(id) {
  const r = find('romaneios', id); if (!r) return;
  if (db.lotesSecagem.some(l => (l.romaneioIds || []).includes(id))) return showToast('Esta carga já entrou numa secagem. Exclua ou edite a secagem primeiro.', true);
  confirmDialog(`Excluir o romaneio nº ${r.numero}? A colheita gerada por ele também sai de Produção.`, () => { if (r.colheitaId) remove('colheitas', r.colheitaId); remove('romaneios', id); showToast('Romaneio excluído'); });
}

// ---------- Secador: secagem por lote ----------
const cargasEsperando = secadorId => db.romaneios.filter(r => r.destinoTipo === 'secador' && (!secadorId || r.destinoId === secadorId) && !db.lotesSecagem.some(l => (l.romaneioIds || []).includes(r.id)));
function iniciarSecagemForm(secadorId) {
  const sec = equipDoTipo('Secador'); if (!sec.length) return showToast('Cadastre o secador em Máquinas (tipo Secador).', true);
  const sid = secadorId || sec[0].id, espera = cargasEsperando(sid), aberta = db.lotesSecagem.find(l => l.secadorId === sid && l.status === 'Em andamento');
  if (aberta) return go('graos/lote/' + aberta.id);
  const massa = espera.reduce((t, r) => t + (r.calc?.liquido || 0) * (1 - (r.calc?.linhas?.find(x => x.id === 'impureza')?.percentual || 0) / 100), 0);
  const uMed = espera.length ? espera.reduce((t, r) => t + (Number(r.umidade) || 0) * (r.calc?.liquido || 0), 0) / espera.reduce((t, r) => t + (r.calc?.liquido || 0), 0) : '';
  const prod = espera[0]?.produto || 'soja', ultimo = db.lotesSecagem.filter(l => l.secadorId === sid).sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''))[0];
  openForm({title: 'Iniciar secagem', sub: espera.length ? `${espera.length} ${espera.length === 1 ? 'carga esperando' : 'cargas esperando'} este secador: carga e umidade já calculadas (sem a impureza, que sai na pré-limpeza).` : 'Nenhuma carga da moega esperando: informe a carga e a umidade.',
    values: {secadorId: sid, produto: prod, destino: ultimo?.destino || 'armazenamento_graos', massaT: massa ? Math.round(massa / 100) / 10 : '', umidadeEntrada: uMed !== '' ? Math.round(uMed * 10) / 10 : '', combTipo: ultimo?.combustivel?.tipo || 'lenha', combPreco: ultimo?.combustivel?.preco || ''},
    fields: [
      {k: 'secadorId', label: 'Secador', type: 'select', options: sec.map(m => ({value: m.id, label: m.name})), required: true},
      {k: 'produto', label: 'Produto', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true},
      {k: 'destino', label: 'Destino do produto', type: 'select', options: DESTINOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true, hint: 'Define a temperatura máxima e a umidade final de referência.', full: true},
      {k: 'massaT', label: 'Carga de entrada (t)', type: 'number', min: 0, required: true}, {k: 'umidadeEntrada', label: 'Umidade de entrada (%)', type: 'number', min: 0, required: true},
      {k: 'combTipo', label: 'Combustível', type: 'select', options: COMBUSTIVEIS.map(([v, l, u]) => ({value: v, label: `${l} (${u})`}))}, {k: 'combPreco', label: 'Preço do combustível (R$ por unidade)', type: 'number', min: 0, hint: 'Para o custo por saca. Lembra o último.'}],
    submit: 'Iniciar secagem',
    onSubmit: v => {
      if (!(v.massaT > 0)) return 'Informe a carga de entrada';
      const l = {id: uid(), secadorId: v.secadorId, produto: v.produto, destino: v.destino, inicio: agoraISO(), status: 'Em andamento', massaEntradaKg: v.massaT * 1000, umidadeEntrada: v.umidadeEntrada,
        romaneioIds: v.secadorId === sid ? espera.map(r => r.id) : [], leituras: [], combustivel: {tipo: v.combTipo, preco: v.combPreco === '' ? null : v.combPreco}};
      db.lotesSecagem.push(l); save(); showToast('Secagem iniciada: registre a leitura de hora em hora'); go('graos/lote/' + l.id);
    }});
}
function leituraForm(id) {
  const l = find('lotesSecagem', id); if (!l) return;
  openForm({title: 'Leitura do secador', sub: `${nomeEquip(l.secadorId)} • ${nomeProd(l.produto)} • ${fmtDH(agoraISO())}`, values: {hora: nowTime()},
    fields: [{k: 'hora', label: 'Hora', type: 'time', required: true}, {k: 'tAr', label: 'Temperatura do ar de entrada (°C)', type: 'number'},
      {k: 'tMassa', label: 'Temperatura da massa de grãos (°C)', type: 'number', hint: 'O limite de referência vale para a massa.'}, {k: 'umidade', label: 'Umidade na saída (%)', type: 'number', min: 0}],
    submit: 'Salvar leitura',
    onSubmit: v => {
      if ([v.tAr, v.tMassa, v.umidade].every(x => x === '')) return 'Informe pelo menos uma medida';
      const leit = {em: `${today()}T${v.hora || nowTime()}`, tAr: v.tAr, tMassa: v.tMassa, umidade: v.umidade};
      leit.aval = avaliarLeituraSecador(l, leit); l.leituras = [...(l.leituras || []), leit]; save();
      const fora = leit.aval?.find(a => a.status === 'FORA_DO_PADRAO');
      showToast(fora ? `Atenção: ${fora.ponto === 'massa_graos' ? 'massa' : 'ar'} acima de ${n0(fora.limite)} °C — ${fora.acao}` : 'Leitura registrada', !!fora);
    }});
}
function finalizarSecagemForm(id) {
  const l = find('lotesSecagem', id); if (!l) return;
  const silos = equipDoTipo('Silo/Armazém'), ult = (l.leituras || []).at(-1);
  openForm({title: 'Finalizar secagem', sub: `${nomeEquip(l.secadorId)} • ${kgT(l.massaEntradaKg)} a ${n1(l.umidadeEntrada)}% • início ${fmtDH(l.inicio)}`,
    values: {umidadeSaida: ult?.umidade ?? '', siloId: silos[0]?.id || '', combPreco: l.combustivel?.preco ?? ''},
    fields: [{k: 'umidadeSaida', label: 'Umidade final (%)', type: 'number', min: 0, required: true}, {k: 'siloId', label: 'Silo de destino', type: 'select', options: silos.map(m => ({value: m.id, label: m.name})), hint: silos.length ? '' : 'Cadastre os silos em Máquinas (tipo Silo/Armazém).'},
      {k: 'combQtd', label: `${(COMBUSTIVEIS.find(c => c[0] === l.combustivel?.tipo) || COMBUSTIVEIS[0])[1]} gasto (${unComb(l.combustivel?.tipo)})`, type: 'number', min: 0}, {k: 'combPreco', label: 'Preço (R$ por unidade)', type: 'number', min: 0}],
    submit: 'Finalizar',
    onSubmit: v => {
      const av = avaliarUmidadeSaida(l, v.umidadeSaida);
      if (av?.status === 'FORA_DO_PADRAO' && finalizarSecagemForm.aviso !== id + v.umidadeSaida) { finalizarSecagemForm.aviso = id + v.umidadeSaida; return `${av.acao} Toque em finalizar de novo para encerrar mesmo assim.`; }
      Object.assign(l, {umidadeSaida: v.umidadeSaida, siloId: v.siloId, fim: agoraISO(), status: 'Concluída', avalSaida: av, combustivel: {...(l.combustivel || {}), qtd: v.combQtd === '' ? null : v.combQtd, preco: v.combPreco === '' ? null : v.combPreco}});
      const c = calcSecagem(l); l.calc = {mf: c.mf, agua: c.agua, horas: c.horas}; save();
      showToast(`Secagem concluída: ${kgT(c.mf)} a ${n1(c.uf)}%${v.siloId ? ' → ' + nomeEquip(v.siloId) : ''}`); go('graos/secador');
    }});
}

// ---------- Silos: saída, transferência, termometria, capacidade ----------
function saidaSiloForm(siloId) {
  const silos = equipDoTipo('Silo/Armazém'); if (!silos.length) return showToast('Cadastre os silos em Máquinas (tipo Silo/Armazém).', true);
  openForm({title: 'Saída do silo', values: {date: today(), siloId: siloId || silos[0].id, tipo: 'saida'},
    fields: [{k: 'siloId', label: 'Silo', type: 'select', options: silos.map(m => ({value: m.id, label: `${m.name} (${kgT(saldoSilo(m).saldo)})`})), required: true},
      {k: 'tipo', label: 'Tipo', type: 'select', options: [{value: 'saida', label: 'Expedição / venda'}, {value: 'transferencia', label: 'Transferência para outro silo'}, {value: 'ajuste', label: 'Ajuste de estoque (quebra, conferência)'}], required: true},
      {k: 'date', label: 'Data', type: 'date', required: true}, {k: 'kg', label: 'Quantidade (kg)', type: 'number', required: true, hint: 'No ajuste, use negativo para baixar e positivo para somar.'},
      {k: 'destinoSiloId', label: 'Silo de destino (transferência)', type: 'select', options: silos.map(m => ({value: m.id, label: m.name}))},
      {k: 'comprador', label: 'Comprador / destino'}, {k: 'placa', label: 'Placa'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => {
      if (!v.kg) return 'Informe a quantidade';
      if (v.tipo !== 'ajuste' && v.kg < 0) return 'Use quantidade positiva';
      if (v.tipo === 'transferencia' && (!v.destinoSiloId || v.destinoSiloId === v.siloId)) return 'Escolha outro silo de destino';
      const s = find('machines', v.siloId), saldo = saldoSilo(s).saldo;
      if (v.tipo !== 'ajuste' && v.kg > saldo + 1) return `O silo tem ${kgT(saldo)}: a saída não pode passar do saldo`;
      upsert('movSilo', {id: uid(), ...v}); showToast(v.tipo === 'saida' ? `Saída de ${kgT(v.kg)} (${sacas(v.kg)}) registrada` : 'Registrado');
    }});
}
function termometriaForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  const n = Number(s.cabosTermometria) || termometriaSilo(siloId)?.cabos.length || 4;
  openForm({title: `Termometria — ${s.name}`, sub: 'Maior temperatura de cada cabo. O app compara com a leitura anterior.', values: {date: today(), time: nowTime(), nCabos: n},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true}, {k: 'time', label: 'Hora', type: 'time'},
      ...Array.from({length: n}, (_, i) => ({k: 'c' + i, label: `Cabo ${i + 1} (°C)`, type: 'number'})),
      {k: 'nCabos', label: 'Cabos neste silo', type: 'number', min: 1, hint: 'Mude e salve para ajustar a quantidade de campos.'}],
    onSubmit: v => {
      const cabos = Array.from({length: n}, (_, i) => v['c' + i]);
      if (Number(v.nCabos) > 0 && Number(v.nCabos) !== n) { s.cabosTermometria = Number(v.nCabos); save(); setTimeout(() => termometriaForm(siloId), 0); return; }
      if (cabos.every(c => c === '')) return 'Informe a temperatura de pelo menos um cabo';
      s.cabosTermometria = n; upsert('termometrias', {id: uid(), siloId, date: v.date, time: v.time, cabos, criadoEm: Date.now()});
      const t = termometriaSilo(siloId); showToast(t.subindo.length ? `Atenção: ${t.subindo.map(c => 'cabo ' + c.cabo).join(', ')} subiu ${SUBIDA_CABO} °C ou mais — verifique e considere aerar` : 'Termometria registrada', t.subindo.length > 0);
    }});
}
function capacidadeForm(siloId) {
  const s = find('machines', siloId); if (!s) return;
  openForm({title: `Capacidade — ${s.name}`, values: {capacidadeT: s.capacidadeT ?? ''}, fields: [{k: 'capacidadeT', label: 'Capacidade (t)', type: 'number', min: 0, required: true}],
    onSubmit: v => { s.capacidadeT = v.capacidadeT; save(); showToast('Capacidade salva'); }});
}

// ---------- Telas ----------
const ABAS_GRAOS = [['', 'Painel'], ['moega', 'Moega'], ['secador', 'Secador'], ['silos', 'Silos']];
const abasGraos = atual => `<div class="filters graos-abas">${ABAS_GRAOS.map(([a, n]) => `<button class="${atual === a ? 'active' : ''}" data-act="nav" data-id="graos${a ? '/' + a : ''}">${n}</button>`).join('')}<button data-act="nav" data-id="secagem">Leituras avulsas</button></div>`;
const semEquip = tipo => `<section class="card">${empty(`Nenhum ${tipo === 'Secador' ? 'secador' : tipo === 'Moega' ? 'moega' : 'silo'} cadastrado`, `Cadastre em Máquinas e manutenção com o tipo “${tipo}”.`, {act: 'mc-new', label: '+ Cadastrar'})}</section>`;
VIEWS.graos = arg => {
  carregarRegrasGraos();
  if (arg?.startsWith('lote/')) return telaLote(arg.slice(5));
  const aba = ['moega', 'secador', 'silos'].includes(arg) ? arg : '';
  const topo = head('Moega, secador e silos', 'Recebimento, secagem e armazenagem ligados: a carga vira colheita do talhão e estoque no silo.', btn('+ Carga na moega', 'gr-romaneio') + btn('Iniciar secagem', 'gr-secar', '', 'secondary') + btn('Saída do silo', 'gr-saida', '', 'secondary')) + abasGraos(aba);
  return topo + (aba === 'moega' ? telaMoega() : aba === 'secador' ? telaSecador() : aba === 'silos' ? telaSilos() : telaPainelGraos());
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
  return `<section class="card panel lote-card clickable" data-act="nav" data-id="graos/lote/${esc(l.id)}"><div class="lote-topo"><strong>${esc(nomeEquip(l.secadorId))} — ${esc(nomeProd(l.produto))}</strong><span class="chip ${fora ? 'sit-red' : semLeitura > 2 ? 'sit-orange' : 'sit-green'}">${fora ? 'Temperatura acima da referência' : semLeitura > 2 ? `Sem leitura há ${um1(semLeitura)} h` : 'Em andamento'}</span></div>
    <div class="lote-nums"><span><small>Carga</small><b>${kgT(c.mi)}</b></span><span><small>Umidade</small><b>${n1(c.ui)}% → ${c.uf != null ? n1(c.uf) + '%' : '—'}</b></span><span><small>Tempo</small><b>${um1(c.horas)} h</b></span><span><small>Última massa</small><b>${ult?.tMassa !== '' && ult?.tMassa != null ? n0(ult.tMassa) + ' °C' : '—'}</b></span></div></section>`;
}
function cartaoSilo(s) {
  const sd = saldoSilo(s), tm = termometriaSilo(s.id), aer = tm?.media != null ? horasAerar(tm.media) : null;
  return `<article class="card panel silo-card"><div class="lote-topo"><strong>${esc(s.name)}</strong>${tm?.subindo.length ? `<span class="chip sit-orange">Cabo subindo</span>` : ''}</div>
    <div class="silo-barra"><span style="width:${Math.min(100, sd.ocupacao ?? 0)}%" class="${(sd.ocupacao ?? 0) >= 95 ? 'cheio' : ''}"></span></div>
    <div class="lote-nums"><span><small>Saldo</small><b>${kgT(sd.saldo)}</b></span><span><small>Ocupação</small><b>${sd.ocupacao != null ? n0(sd.ocupacao) + '%' : `<button class="link" data-act="gr-cap" data-id="${esc(s.id)}">informar capacidade</button>`}</b></span><span><small>Umidade média</small><b>${sd.uMedia != null ? n1(sd.uMedia) + '%' : '—'}</b></span><span><small>Grãos</small><b>${tm?.media != null ? `${n1(tm.media)} °C (máx. ${n0(tm.max)})` : '—'}</b></span></div>
    ${tm ? `<p class="nota" style="margin:6px 0 0">Termometria ${fmtDate(tm.ult.date)} ${esc(tm.ult.time || '')}${tm.subindo.length ? ` • <b class="txt-red">${tm.subindo.map(c => `cabo ${c.cabo} +${n1(c.dif)} °C`).join(', ')}</b>` : ''}${aer ? (aer.length ? ` • Boas horas para aerar: ${aer.slice(0, 3).map(fmtFaixa).join(', ')}` : ' • Sem horas boas para aerar nas próximas 36 h') : ''}</p>` : ''}
    <div class="row-actions" style="justify-content:flex-start;margin-top:8px">${mini('Termometria', 'gr-termo', s.id)}${mini('Saída', 'gr-saida', s.id)}${mini('Movimentos', 'gr-movs', s.id)}</div></article>`;
}
function telaMoega() {
  const lista = db.romaneios.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  return lista.length ? `<section class="card panel"><div class="tbl-wrap"><table class="tbl tbl-moega"><thead><tr><th>Carga</th><th>Origem e destino</th><th class="num">Líquido</th><th class="num">Amostra e desconto</th><th class="num">Final</th><th></th></tr></thead><tbody>
    ${lista.map(r => `<tr><td><b>Nº ${r.numero}</b><br><small class="nota">${fmtDate(r.date).slice(0, 5)} ${esc(r.time || '')}</small></td><td>${esc(fieldName(r.fieldId) || 'Terceiros')} • ${esc(nomeProd(r.produto))}<br><small class="nota">${esc([r.placa, '→ ' + nomeEquip(r.destinoId)].filter(Boolean).join(' '))}</small></td>
      <td class="num">${n0(r.calc?.liquido)} kg</td><td class="num">${n1(r.umidade)}%${r.impureza !== '' && r.impureza != null ? ' • ' + n1(r.impureza) + '%' : ''}<br><small class="nota">− ${n0(r.calc?.descontoKg)} kg (${num(r.calc?.descontoPct, 2)}%)</small></td>
      <td class="num"><b>${n0(r.calc?.pesoFinal)} kg</b><br><small class="nota">${sacas(r.calc?.pesoFinal)}</small></td>
      <td><div class="row-actions">${mini('Editar', 'gr-rom-edit', r.id)}${mini('Excluir', 'gr-rom-del', r.id, 'del')}</div></td></tr>`).join('')}
    </tbody></table></div><p class="nota">Desconto por balanço de massa sobre o padrão do contrato: o grão seco e limpo se conserva, desconta-se só o excesso de água e impureza. Cada romaneio com talhão vira colheita em Produção.</p></section>`
    : `<section class="card">${empty('Nenhuma carga recebida', 'Registre a pesagem, a amostra e o destino de cada caminhão.', {act: 'gr-romaneio', label: '+ Carga na moega'})}</section>`;
}
function telaSecador() {
  const sec = equipDoTipo('Secador'); if (!sec.length) return semEquip('Secador');
  const abertas = db.lotesSecagem.filter(l => l.status === 'Em andamento'), feitas = db.lotesSecagem.filter(l => l.status === 'Concluída').sort((a, b) => (b.fim || '').localeCompare(a.fim || ''));
  const espera = cargasEsperando();
  const tot = feitas.reduce((a, l) => { const c = calcSecagem(l); a.mf += c.mf || 0; a.agua += c.agua || 0; a.h += c.horas; a.custo += c.custo || 0; return a; }, {mf: 0, agua: 0, h: 0, custo: 0});
  return `${espera.length ? `<section class="card panel"><strong>${espera.length} ${espera.length === 1 ? 'carga esperando' : 'cargas esperando'} secagem</strong><small class="nota"> — ${kgT(espera.reduce((s, r) => s + (r.calc?.liquido || 0), 0))}</small><div class="btn-row" style="margin-top:8px">${btn('Iniciar secagem', 'gr-secar')}</div></section>` : ''}
    ${abertas.map(cartaoLote).join('')}
    ${feitas.length ? `<div class="section-title"><h3>Secagens concluídas</h3></div><section class="kpis"><article class="card kpi"><div class="label">Grão seco</div><div class="value">${kgT(tot.mf)}</div><div class="hint">${sacas(tot.mf)}</div></article><article class="card kpi"><div class="label">Água retirada</div><div class="value">${kgT(tot.agua)}</div></article><article class="card kpi"><div class="label">Rendimento médio</div><div class="value">${tot.h ? n1(feitas.reduce((s, l) => s + (Number(l.massaEntradaKg) || 0), 0) / 1000 / tot.h) + ' t/h' : '—'}</div></article><article class="card kpi"><div class="label">Custo de combustível</div><div class="value">${tot.custo ? 'R$ ' + num(tot.custo / (tot.mf / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60)), 2) + '/sc' : '—'}</div><div class="hint">${tot.custo ? 'R$ ' + n0(tot.custo) + ' no total' : 'informe o preço ao finalizar'}</div></article></section>
    <section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fim</th><th>Secador / produto</th><th class="num">Entrada</th><th class="num">Umidade</th><th class="num">Saída</th><th class="num">Horas</th><th class="num">t/h</th><th class="num">Combustível</th><th class="num">R$/sc</th></tr></thead><tbody>
      ${feitas.map(l => { const c = calcSecagem(l); return `<tr class="clickable" data-act="nav" data-id="graos/lote/${esc(l.id)}"><td>${fmtDH(l.fim)}</td><td>${esc(nomeEquip(l.secadorId))}<br><small class="nota">${esc(nomeProd(l.produto))}</small></td><td class="num">${kgT(c.mi)}</td><td class="num">${n1(c.ui)} → ${n1(c.uf)}%</td><td class="num">${c.mf ? kgT(c.mf) : '—'}</td><td class="num">${um1(c.horas)}</td><td class="num">${c.tph ? n1(c.tph) : '—'}</td><td class="num">${c.combPorT ? num(c.combPorT, 2) + ' ' + unComb(l.combustivel?.tipo) + '/t' : '—'}</td><td class="num">${c.custoSc ? num(c.custoSc, 2) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div></section>` : !abertas.length && !espera.length ? `<section class="card">${empty('Nenhuma secagem registrada', 'Inicie a secagem com as cargas da moega e registre a leitura de hora em hora.', {act: 'gr-secar', label: 'Iniciar secagem'})}</section>` : ''}`;
}
function telaLote(id) {
  const l = find('lotesSecagem', id); if (!l) return empty('Secagem não encontrada', '', {act: 'nav', id: 'graos/secador', label: 'Voltar'});
  const c = calcSecagem(l), aberta = l.status === 'Em andamento', roms = (l.romaneioIds || []).map(r => find('romaneios', r)).filter(Boolean);
  const pontosMassa = (l.leituras || []).filter(x => x.tMassa !== '' && x.tMassa != null);
  const lim = (l.leituras || []).flatMap(x => x.aval || []).find(a => a.ponto === 'massa_graos' && a.limite != null)?.limite;
  return head(`Secagem — ${nomeEquip(l.secadorId)}`, `${nomeProd(l.produto)} • ${(DESTINOS_GRAO.find(d => d[0] === l.destino) || [, l.destino])[1]} • início ${fmtDH(l.inicio)}${l.fim ? ' • fim ' + fmtDH(l.fim) : ''}`,
    btn('← Secador', 'nav', 'graos/secador', 'secondary') + (aberta ? btn('+ Leitura', 'gr-leitura', l.id) + btn('Finalizar', 'gr-finalizar', l.id, 'secondary') : '') + `<button class="danger" data-act="gr-lote-del" data-id="${esc(l.id)}">Excluir</button>`) +
    `<section class="kpis"><article class="card kpi"><div class="label">Carga</div><div class="value">${kgT(c.mi)}</div><div class="hint">${roms.length ? roms.length + ' ' + (roms.length === 1 ? 'carga da moega' : 'cargas da moega') : 'informada'}</div></article>
      <article class="card kpi"><div class="label">Umidade</div><div class="value">${n1(c.ui)}% → ${c.uf != null ? n1(c.uf) + '%' : '—'}</div><div class="hint">${c.pontos != null ? n1(c.pontos) + ' pontos' + (c.ppH ? ` • ${num(c.ppH, 2)} pontos/h` : '') : 'sem umidade de saída ainda'}</div></article>
      <article class="card kpi"><div class="label">Grão seco ${aberta ? '(previsão)' : ''}</div><div class="value">${c.mf ? kgT(c.mf) : '—'}</div><div class="hint">${c.agua ? `água retirada ${kgT(c.agua)} • ${sacas(c.mf)}` : ''}</div></article>
      <article class="card kpi"><div class="label">Rendimento${aberta ? ' até agora' : ''}</div><div class="value">${c.tph ? n1(c.tph) + ' t/h' : '—'}</div><div class="hint">${um1(c.horas)} h${c.custoSc ? ` • R$ ${num(c.custoSc, 2)}/sc` : ''}${c.combPorT ? ` • ${num(c.combPorT, 2)} ${unComb(l.combustivel?.tipo)}/t` : ''}</div></article></section>
    ${l.avalSaida ? `<section class="card panel"><span class="chip ${l.avalSaida.status === 'OK' ? 'sit-green' : l.avalSaida.status === 'ATENCAO' ? 'sit-orange' : l.avalSaida.status === 'FORA_DO_PADRAO' ? 'sit-red' : 'sit-gray'}">Umidade final: ${esc(STATUS_INFO?.[l.avalSaida.status]?.rotulo || l.avalSaida.status)}</span> <span class="nota">${esc(l.avalSaida.acao || '')}${l.avalSaida.regra ? ` (${esc(l.avalSaida.regra)})` : ''}</span></section>` : ''}
    ${pontosMassa.length > 1 ? `<section class="card panel"><h3>Temperatura da massa</h3>${graficoMassa(pontosMassa, lim)}</section>` : ''}
    <div class="section-title"><h3>Planilha de secagem (${(l.leituras || []).length})</h3>${aberta ? `<button data-act="gr-leitura" data-id="${esc(l.id)}">+ Leitura</button>` : ''}</div>
    <section class="card panel">${(l.leituras || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hora</th><th class="num">Ar de entrada</th><th class="num">Massa</th><th class="num">Umidade saída</th><th>Referência</th></tr></thead><tbody>
      ${l.leituras.map(x => { const f = x.aval?.find(a => a.status === 'FORA_DO_PADRAO'), ok = x.aval?.some(a => a.status === 'OK'); return `<tr><td>${esc(x.em.slice(11, 16))}<br><small class="nota">${fmtDate(x.em.slice(0, 10))}</small></td><td class="num">${x.tAr !== '' && x.tAr != null ? n0(x.tAr) + ' °C' : '—'}</td><td class="num ${f?.ponto === 'massa_graos' ? 'txt-red' : ''}">${x.tMassa !== '' && x.tMassa != null ? n0(x.tMassa) + ' °C' : '—'}</td><td class="num">${x.umidade !== '' && x.umidade != null ? n1(x.umidade) + '%' : '—'}</td><td>${f ? `<span class="chip sit-red">acima de ${n0(f.limite)} °C</span>` : ok ? '<span class="chip sit-green">ok</span>' : '<small class="nota">sem referência</small>'}</td></tr>`; }).join('')}
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
  dialog.innerHTML = `<h3>Movimentos — ${esc(s.name)}</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Movimento</th><th class="num">kg</th><th></th></tr></thead><tbody>${linhas.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.tipo)}<br><small class="nota">${esc(x.ref || '')}</small></td><td class="num ${x.sinal < 0 ? 'txt-red' : ''}">${x.sinal < 0 ? '−' : '+'} ${n0(x.kg)}</td><td>${x.id ? mini('Excluir', 'gr-mov-del', x.id, 'del') : ''}</td></tr>`).join('') || '<tr><td colspan="4">Sem movimentos.</td></tr>'}</tbody></table></div><div class="actions"><button class="secondary" data-close>Fechar</button></div>`;
  $('[data-close]', dialog).onclick = closeModal; modal.classList.add('open');
}

Object.assign(ACTIONS, {
  'gr-romaneio': () => romaneioForm(), 'gr-rom-edit': id => romaneioForm(find('romaneios', id)), 'gr-rom-del': excluirRomaneio,
  'gr-secar': id => iniciarSecagemForm(id), 'gr-leitura': leituraForm, 'gr-finalizar': finalizarSecagemForm,
  'gr-lote-del': id => confirmDialog('Excluir esta secagem? As cargas voltam para “esperando secagem” e o grão seco sai do silo.', () => { remove('lotesSecagem', id); go('graos/secador'); }),
  'gr-saida': id => saidaSiloForm(id), 'gr-termo': termometriaForm, 'gr-cap': capacidadeForm, 'gr-movs': movimentosDialog,
  'gr-mov-del': id => confirmDialog('Excluir este movimento do silo?', () => { remove('movSilo', id); closeModal(); render(); })
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
