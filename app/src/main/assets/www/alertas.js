'use strict';
/* MercaPlant — alertas no celular.
   O app calcula os avisos com os dados da fazenda e a última previsão do tempo guardada:
   • chuva forte e geada (véspera) • janela de pulverização de amanhã (18h) • revisão, checklist e aferição de máquina
   • estoque baixo/acabando e lote vencendo • operações atrasadas • silo esquentando e boa hora para aerar
   • carência cumprida (colheita liberada) • contas a vencer (ADM e supervisor) • pedido de compra para aprovar
   No app Android, o próprio Android agenda as notificações: elas chegam mesmo com o app fechado, no cartão escuro
   do MercaPlant (hexágono colorido por área, número em destaque, gráfico da chuva e botões de ação).
   No navegador, aparecem como notificação do sistema quando o MercaPlant é aberto (se o navegador permitir). */
const ALERTA_TIPOS = [
  ['chuva', 'Chuva forte prevista', `${20} mm ou mais — aviso na véspera, às 7h`],
  ['geada', 'Risco de geada', 'mínima de 3 °C ou menos — aviso às 18h da véspera'],
  ['pulverizar', 'Pulverização de amanhã', 'boas horas (ou falta delas) — aviso às 18h da véspera'],
  ['revisao', 'Revisão de máquina', 'chegando ou vencida'],
  ['maqpend', 'Checklist e aferição', 'vencidos ou atrasados'],
  ['estoque', 'Estoque', 'abaixo do mínimo ou acabando em até 7 dias'],
  ['validade', 'Validade de lotes', 'lote do estoque ou teste de germinação da semente vencendo em até 30 dias ou vencido'],
  ['silos', 'Silos', 'temperatura subindo e boa hora para aerar'],
  ['carencia', 'Carência cumprida', 'colheita do talhão liberada'],
  ['atrasadas', 'Operações atrasadas', 'programadas para dias que já passaram'],
  ['contas', 'Contas a vencer', 'vencidas ou vencendo em até 3 dias', () => podeFinanceiro()],
  ['compras', 'Pedidos de compra', 'aguardando sua aprovação', () => typeof cprDecide !== 'function' || cprDecide()]
];
const ALERTA_CFG = 'agro-alertas', ALERTA_ENV = 'agro-alertas-enviados', CHUVA_FORTE_MM = 20, CHUVA_SEVERA_MM = 50, GEADA_C = 3, LOTE_AVISO_DIAS = 30;
// Cor do hexágono por área (a mesma paleta do sistema) e canal do Android (o agricultor silencia cada área separada)
const ALERTA_CAT = {
  clima: {rotulo: 'Clima', cor: '#3D9BE9'}, pulverizacao: {rotulo: 'Pulverização', cor: '#24A672'}, maquinas: {rotulo: 'Máquinas', cor: '#F5B843'},
  estoque: {rotulo: 'Estoque', cor: '#8F7CF0'}, operacoes: {rotulo: 'Operações', cor: '#E05A5A'}, silos: {rotulo: 'Silos', cor: '#1D9E75'},
  aplicacoes: {rotulo: 'Aplicações', cor: '#24A672'}, financeiro: {rotulo: 'Financeiro', cor: '#D4537E'}, compras: {rotulo: 'Compras', cor: '#A0C4D0'}
};
const COR_LARANJA = '#F59E0B', COR_VERMELHO = '#E05A5A', COR_GELO = '#B5D4F4';
const podeFinanceiro = () => !(typeof nvComum === 'function' && nvComum()) && (typeof nvPodeRota !== 'function' || nvPodeRota('financeiro'));
function alertaCfg() {
  let c = null; try { c = JSON.parse(safeStorage.get(ALERTA_CFG) || 'null'); } catch { c = null; }
  return {ativo: false, chuva: true, geada: true, pulverizar: true, revisao: true, maqpend: true, estoque: true, validade: true, silos: true, carencia: true, atrasadas: false, contas: true, compras: true, ...(c || {})};
}
const salvarAlertaCfg = c => safeStorage.set(ALERTA_CFG, JSON.stringify(c));
const horaDe = (dataIso, h) => new Date(`${dataIso}T${String(h).padStart(2, '0')}:00:00`).getTime();
// Aviso "agora" que cairia de madrugada vai para as 7h
function horaBoa(ms) {
  const dt = new Date(ms), h = dt.getHours();
  if (h >= 7 && h < 21) return ms;
  const dia = new Date(dt); if (h >= 21) dia.setDate(dia.getDate() + 1);
  return horaDe(isoLocal(dia), 7);
}
// Assinatura curta de uma lista (o aviso só volta quando a lista muda)
const assinatura = lista => { let h = 0; for (const ch of lista.join('|')) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const valorCurto = v => { const n = Number(v) || 0; return n >= 1e6 ? `R$ ${num(n / 1e6, 1)} mi` : n >= 1e3 ? `R$ ${num(Math.round(n / 1e3))} mil` : `R$ ${num(Math.round(n))}`; };
const nomeFazenda = () => db.settings?.farm || '';

// Chuva hora a hora do dia (só a faixa em volta da chuva, até 12 barras) e o resumo do tempo
function climaDoDia(dados, dia) {
  const h = dados?.hourly; if (!h?.time) return {};
  const idx = h.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(dia)).map(([, i]) => i);
  const mm = idx.map(i => Number(h.precipitation?.[i]) || 0), com = mm.map((v, k) => v >= 0.1 ? k : -1).filter(k => k >= 0);
  let barras = [];
  if (com.length) {
    let ini = Math.max(0, com[0] - 2), fim = Math.min(idx.length - 1, com.at(-1) + 1);
    if (fim - ini + 1 > 12) { const pico = mm.indexOf(Math.max(...mm)); ini = Math.max(0, Math.min(pico - 5, idx.length - 12)); fim = ini + 11; }
    barras = idx.slice(ini, fim + 1).map(i => ({h: `${Number(h.time[i].slice(11, 13))}h`, v: Math.round((Number(h.precipitation?.[i]) || 0) * 10) / 10}));
  }
  const max = (campo) => { const v = idx.map(i => h[campo]?.[i]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  return {barras, rajada: max('wind_gusts_10m'), trovoada: max('trovoada')};
}
const txtTrovoada = p => p == null ? '—' : p >= 0.5 ? 'Provável' : p >= 0.2 ? 'Possível' : 'Baixa';
const opsAfetadas = dia => typeof opsDoDia === 'function' && typeof OPS_CAMPO !== 'undefined' ? opsDoDia(dia).filter(o => OPS_CAMPO.includes(o.type)) : db.operations.filter(o => o.date === dia && o.status === 'Programada');
const txtOps = ops => typeof listaOps === 'function' ? listaOps(ops) : ops.slice(0, 3).map(o => o.type).join('; ');

function calcularAlertas(cfg = alertaCfg(), agora = Date.now()) {
  const lista = [], t = today(), amanha = addDias(t, 1), c = typeof lerClima === 'function' ? lerClima() : null, d = c?.dados?.daily, faz = nomeFazenda();
  const add = (cat, a, quando) => lista.push({cat, rotulo: ALERTA_CAT[cat].rotulo, cor: ALERTA_CAT[cat].cor, fazenda: faz, ...a, quando: Math.max(agora, quando)});
  const tiposOk = Object.fromEntries(ALERTA_TIPOS.map(([k, , , pode]) => [k, !!cfg[k] && (!pode || pode())]));

  // ---------- Clima: chuva forte ----------
  if (d && tiposOk.chuva) d.time.forEach((dia, i) => {
    const mm = d.precipitation_sum[i];
    if (dia < t || dia > addDias(t, 4) || !(mm >= CHUVA_FORTE_MM)) return;
    const quando = dia === t ? horaBoa(agora) : horaDe(addDias(dia, -1), 7);
    const quandoTxt = dia === t ? 'hoje' : `amanhã (${fmtDate(dia).slice(0, 5)})`; // chega na véspera
    const fx = typeof horariosChuva === 'function' ? horariosChuva(c.dados, dia, new Date(agora)) : [], horaTxt = fx.length ? (fx[0].agora ? ', já chovendo' : `, a partir das ${String(fx[0].ini).padStart(2, '0')}h`) : '';
    const severa = mm >= CHUVA_SEVERA_MM, prob = Math.round(d.precipitation_probability_max?.[i] ?? 0), incerta = d.confianca?.[i] && !d.confianca[i].firme;
    const cd = climaDoDia(c.dados, dia), ops = opsAfetadas(dia), quandoCurto = dia === t ? 'hoje' : 'amanhã';
    const tmin = d.temperature_2m_min?.[i], tmax = d.temperature_2m_max?.[i];
    add('clima', {id: `chuva-${dia}`, tipo: 'chuva', rota: 'clima', icone: 'chuva', cor: severa ? COR_VERMELHO : COR_LARANJA,
      titulo: `Chuva de ${num(mm, 0)} mm ${quandoTxt}${horaTxt}`,
      texto: `${fx.length ? 'Horários: ' + txtHorariosChuva(fx) + '. ' : ''}Chance de ${prob}%. ${ops.length ? 'Atrapalha: ' + txtOps(ops) + '.' : 'Programe aplicações, plantio e colheita.'}${incerta ? ' Previsão incerta: confira de novo.' : ''}`,
      curto: `${severa ? 'Chuva severa' : 'Chuva forte'} ${quandoCurto}${fx.length && !fx[0].agora ? ` às ${fx[0].ini}h` : fx[0]?.agora ? ', já chovendo' : ''}`,
      sub: `${prob}% de chance${ops.length ? ` · ${plural(ops.length, 'operação afetada', 'operações afetadas')}` : ''}`,
      valor: num(mm, 0), unid: 'mm', selo: severa ? 'ALERTA · CHUVA SEVERA' : 'ALERTA · CHUVA FORTE', dia: fmtDate(dia).slice(0, 5),
      detalhe: `${fx.length ? 'das ' + txtHorariosChuva(fx) : 'ao longo do dia'} · ${prob}% de chance${incerta ? ' · previsão incerta' : ''}`,
      barras: cd.barras || [],
      quadros: [['Rajadas', cd.rajada != null ? `${Math.round(cd.rajada)} km/h` : '—', cd.rajada >= 50], ['Trovoada', txtTrovoada(cd.trovoada), cd.trovoada >= 0.2], ['Temp.', tmin != null && tmax != null ? `${Math.round(tmin)}°/${Math.round(tmax)}°` : '—', false]],
      aviso: ops.length ? `Programado para ${quandoCurto}: ${txtOps(ops)}.` : '',
      acoes: [{t: 'Ver previsão', rota: 'clima'}, ...(ops.length ? [{t: 'Reprogramar', rota: 'operacoes'}] : [])]}, quando);
  });

  // ---------- Clima: geada ----------
  if (d && tiposOk.geada) [t, amanha, addDias(t, 2)].forEach(dia => {
    const i = d.time.indexOf(dia), min = d.temperature_2m_min?.[i]; if (i < 0 || !(min <= GEADA_C)) return;
    const h = c.dados.hourly, horas = h?.time ? h.time.map((x, k) => [x, h.temperature_2m?.[k]]).filter(([x, v]) => x.startsWith(dia) && v != null) : [];
    const frio = horas.length ? horas.reduce((a, b) => (b[1] < a[1] ? b : a)) : null, horaMin = frio ? Number(frio[0].slice(11, 13)) : null;
    const forte = min <= 0, quandoTxt = dia === t ? 'hoje' : 'amanhã cedo'; // chega às 18h da véspera
    const quando = dia === t ? horaBoa(agora) : horaDe(addDias(dia, -1), 18);
    const vento = frio && h.wind_speed_10m ? h.wind_speed_10m[h.time.indexOf(frio[0])] : null;
    add('clima', {id: `geada-${dia}`, tipo: 'geada', rota: 'clima', icone: 'geada', cor: forte ? COR_VERMELHO : COR_GELO,
      titulo: `Risco de geada ${quandoTxt} (mínima de ${Math.round(min)} °C)`,
      texto: `${horaMin != null ? `Mais frio por volta das ${horaMin}h. ` : ''}Lavouras em emergência ou floração são as mais sensíveis. Evite aplicações na madrugada fria.`,
      curto: `${forte ? 'Geada forte' : 'Risco de geada'} ${quandoTxt}`, sub: `${horaMin != null ? `Mínima por volta das ${horaMin}h · ` : ''}lavouras em floração são as mais sensíveis`,
      valor: `${Math.round(min)}°`, unid: 'mínima', selo: forte ? 'ALERTA · GEADA FORTE' : 'ALERTA · GEADA', dia: fmtDate(dia).slice(0, 5),
      quadros: [['Mínima', `${Math.round(min)} °C`, forte], ['Hora', horaMin != null ? `${horaMin}h` : '—', false], ['Vento', vento != null ? `${Math.round(vento)} km/h` : '—', vento != null && vento < 5]],
      aviso: vento != null && vento < 5 ? 'Vento calmo na madrugada aumenta o risco de geada.' : '',
      acoes: [{t: 'Ver previsão', rota: 'clima'}]}, quando);
  });

  // ---------- Pulverização ----------
  if (d && tiposOk.pulverizar && typeof janelasDoDia === 'function') [amanha, addDias(t, 2), addDias(t, 3)].forEach(dia => {
    if (!d.time.includes(dia)) return;
    const vespera18 = horaDe(addDias(dia, -1), 18);
    if (vespera18 < agora && horaDe(dia, 6) < agora) return;
    const j = janelasDoDia(c.dados, dia), temAplicacao = db.operations.some(o => o.type === 'Aplicação' && o.status === 'Programada' && o.date === dia);
    if (!j.janelas.length && !temAplicacao) return;
    const horas = j.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', '), total = j.janelas.reduce((s, [a, b]) => s + (b - a), 0);
    const quandoCurto = 'amanhã'; // chega às 18h da véspera
    add('pulverizacao', {id: `pulverizar-${dia}`, tipo: 'pulverizar', rota: 'clima', icone: 'gota', ...(j.janelas.length ? {} : {cor: COR_LARANJA}),
      titulo: j.janelas.length ? `Amanhã: boas horas para pulverizar ${horas}` : 'Amanhã sem boa janela para pulverizar',
      texto: j.janelas.length ? `Vento, Delta T, temperatura e umidade dentro do critério.${temAplicacao ? ' Há aplicação programada.' : ''}` : `Principalmente ${j.principal || 'condições fora do critério'}. Há aplicação programada para amanhã: reveja o horário.`,
      curto: j.janelas.length ? `Boa janela ${quandoCurto}` : `Sem janela para pulverizar ${quandoCurto}`,
      sub: j.janelas.length ? `${horas} · Delta T ideal${temAplicacao ? ' · aplicação programada' : ''}` : `Principalmente ${j.principal || 'condições fora do critério'}`,
      valor: String(total), unid: total === 1 ? 'hora' : 'horas',
      acoes: [{t: 'Ver janelas', rota: 'clima'}, ...(!j.janelas.length && temAplicacao ? [{t: 'Reprogramar', rota: 'operacoes'}] : [])]}, vespera18);
  });

  // ---------- Máquinas: revisão ----------
  if (tiposOk.revisao) db.machines.filter(m => !isInactive(m) && Number(m.nextService) > 0).forEach(m => {
    const falta = hoursToService(m), pr = typeof previsaoRevisao === 'function' ? previsaoRevisao(m) : null;
    // (funções de app.js; os testes carregam este arquivo sozinho)
    if (!(falta <= (typeof avisoRevisao === 'function' ? avisoRevisao(m) : SERVICE_WARN_HOURS) || pr?.dias <= 7)) return;
    const u = typeof unidMed === 'function' ? unidMed(m) : 'h';
    add('maquinas', {id: `revisao-${m.id}-${m.nextService}`, tipo: 'revisao', rota: 'maquinas', icone: 'trator', ...(falta <= 0 ? {cor: COR_VERMELHO} : {}),
      titulo: falta <= 0 ? `Revisão vencida: ${m.name}` : `Revisão em ${num(falta)} ${u}: ${m.name}`,
      texto: `${u === 'km' ? 'Odômetro' : 'Horímetro'} em ${num(m.hours)} ${u}; revisão programada para ${num(m.nextService)} ${u}.${pr?.data && falta > 0 ? ` Pelo ritmo de uso, por volta de ${fmtDate(pr.data)}.` : ''}`,
      curto: falta <= 0 ? `Revisão vencida — ${m.name}` : `Revisão do ${m.name}`,
      sub: `${u === 'km' ? 'Odômetro' : 'Horímetro'} ${num(m.hours)} ${u} · revisão em ${num(m.nextService)} ${u}${pr?.data && falta > 0 ? ` · por volta de ${fmtDate(pr.data).slice(0, 5)}` : ''}`,
      valor: num(Math.abs(falta)), unid: falta <= 0 ? `${u} vencida` : `${u} restantes`,
      acoes: [{t: 'Abrir máquina', rota: 'maquinas'}, {t: 'Lembrar amanhã', tipo: 'adiar'}]}, horaBoa(agora));
  });

  // ---------- Máquinas: checklist vencido e aferição atrasada (um aviso só, volta quando a lista muda) ----------
  if (tiposOk.maqpend) {
    const ck = typeof mcpVencidas === 'function' ? mcpVencidas() : [], af = typeof agaLista === 'function' ? agaLista().filter(o => o.status === 'atrasada') : [];
    const n = ck.length + af.length;
    if (n) {
      const nomes = [...new Set([...ck.map(m => m.name), ...af.map(o => o.m.name)])];
      const partes = [ck.length ? plural(ck.length, 'checklist vencido', 'checklists vencidos') : '', af.length ? plural(af.length, 'aferição atrasada', 'aferições atrasadas') : ''].filter(Boolean);
      add('maquinas', {id: `maqpend-${assinatura([...ck.map(m => 'c' + m.id), ...af.map(o => 'a' + o.m.id + (o.venc || ''))].sort())}`, tipo: 'maqpend', rota: ck.length ? 'checklists' : 'afericao', icone: 'checklist',
        titulo: `${ck.length && af.length ? 'Checklist e aferição' : ck.length ? 'Checklist' : 'Aferição'} pendente: ${nomes.slice(0, 2).join(', ')}${nomes.length > 2 ? ` e mais ${nomes.length - 2}` : ''}`,
        texto: `${partes.join(' e ')}: ${nomes.slice(0, 5).join(', ')}${nomes.length > 5 ? '…' : ''}.`,
        curto: ck.length && af.length ? 'Checklist e aferição vencidos' : ck.length ? 'Checklist vencido' : 'Aferição atrasada',
        sub: `${nomes.slice(0, 3).join(', ')}${nomes.length > 3 ? '…' : ''}`, valor: String(nomes.length), unid: nomes.length === 1 ? 'máquina' : 'máquinas',
        acoes: [...(ck.length ? [{t: 'Ver checklists', rota: 'checklists'}] : []), ...(af.length ? [{t: 'Ver aferições', rota: 'afericao'}] : [])]}, horaBoa(agora));
    }
  }

  // ---------- Estoque ----------
  if (tiposOk.estoque) db.stock.forEach(s => {
    const p = typeof previsaoEstoque === 'function' ? previsaoEstoque(s) : null, acoes = [...(typeof cprDecide === 'function' ? [{t: 'Ver compras', rota: 'compras'}] : []), {t: 'Ver estoque', rota: 'estoque'}];
    if (stockLow(s)) add('estoque', {id: `estoque-${s.id}-baixo-${Number(s.qty)}`, tipo: 'estoque', rota: 'estoque', icone: 'pacote', cor: COR_VERMELHO, titulo: `Estoque baixo: ${s.name}`,
      texto: `Saldo ${num(s.qty)} ${s.unit} (mínimo ${num(s.min)} ${s.unit}).`, curto: `Estoque baixo — ${s.name}`, sub: `Mínimo ${num(s.min)} ${s.unit}`,
      valor: num(s.qty), unid: s.unit, acoes}, horaBoa(agora));
    else if (p && p.dias <= 7) add('estoque', {id: `estoque-${s.id}-acaba-${Number(s.qty)}`, tipo: 'estoque', rota: 'estoque', icone: 'pacote', titulo: `${s.name} acaba em ~${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`,
      texto: `Pelo consumo das últimas semanas (${num(p.porDia, 1)} ${s.unit}/dia). Compre até ${fmtDate(p.compraAte)}.`, curto: `${s.name} acaba em breve`,
      sub: `Saldo ${num(s.qty)} ${s.unit} · ${num(p.porDia, 1)} ${s.unit}/dia · compre até ${fmtDate(p.compraAte).slice(0, 5)}`, valor: String(p.dias), unid: p.dias === 1 ? 'dia' : 'dias', acoes}, horaBoa(agora));
  });
  // Lote vencendo (até 30 dias) ou vencido — avisa uma vez em cada situação
  if (tiposOk.validade && typeof lotesVencendo === 'function') lotesVencendo().filter(x => x.dias <= LOTE_AVISO_DIAS).forEach(x => {
    const venceu = x.dias < 0;
    add('estoque', {id: `lote-${x.s.id}-${x.lote}-${venceu ? 'vencido' : 'vence'}`, tipo: 'validade', rota: 'estoque', icone: 'calendario', ...(venceu ? {cor: COR_VERMELHO} : {}),
      titulo: `${venceu ? 'Lote vencido' : 'Lote vencendo'}: ${x.s.name}`, texto: `Lote ${x.lote} — ${num(x.saldo)} ${x.s.unit}, validade ${fmtDate(x.validade)}.`,
      curto: `${venceu ? 'Lote vencido' : 'Lote vencendo'} — ${x.s.name}`, sub: `Lote ${x.lote} · ${num(x.saldo)} ${x.s.unit} em estoque`,
      valor: String(Math.abs(x.dias)), unid: venceu ? (Math.abs(x.dias) === 1 ? 'dia vencido' : 'dias vencido') : x.dias === 1 ? 'dia' : 'dias',
      acoes: [{t: 'Ver estoque', rota: 'estoque'}]}, horaBoa(agora));
  });

  // Teste de germinação dos lotes de semente: vencendo (até 30 dias) ou vencido — não vender sem reanálise
  if (tiposOk.validade && typeof labValidadeLote === 'function') db.lots.filter(labLoteAtivo).forEach(l => {
    const v = labValidadeLote(l); if (!v || v.estado === 'ok') return;
    const venceu = v.estado === 'vencido', nome = [l.species, l.cultivar].filter(Boolean).join(' '), d = Math.abs(v.dias);
    add('estoque', {id: `germ-${l.id}-${v.validade}-${venceu ? 'vencido' : 'vence'}`, tipo: 'validade', rota: 'lotes/' + l.id, icone: 'calendario', ...(venceu ? {cor: COR_VERMELHO} : {}),
      titulo: venceu ? `Teste de germinação vencido: lote ${l.code}` : `Teste de germinação vencendo: lote ${l.code}`,
      texto: `${nome ? nome + ' — ' : ''}${venceu ? 'não pode vender até a reanálise' : 'faça a reanálise antes de vencer'} (validade ${fmtDate(v.validade)}).`,
      curto: `${venceu ? 'Teste vencido' : 'Teste vencendo'} — lote ${l.code}`, sub: `${nome || 'Semente'} · validade ${fmtDate(v.validade)}`,
      valor: String(d), unid: venceu ? (d === 1 ? 'dia vencido' : 'dias vencido') : d === 1 ? 'dia' : 'dias',
      acoes: [{t: 'Ver lote', rota: 'lotes/' + l.id}]}, horaBoa(agora));
  });

  // ---------- Silos: temperatura subindo e boa hora para aerar ----------
  if (tiposOk.silos && typeof equipDoTipo === 'function' && typeof termometriaSilo === 'function' && (typeof nvPodeRota !== 'function' || nvPodeRota('graos'))) {
    const aerar = {};
    equipDoTipo('Silo/Armazém').forEach(s => {
      const tm = termometriaSilo(s.id); if (!tm) return;
      if (tm.subindo.length) {
        const pior = tm.subindo.reduce((a, b) => (b.dif > a.dif ? b : a));
        add('silos', {id: `silo-${s.id}-${tm.ult.id || tm.ult.date + (tm.ult.time || '')}`, tipo: 'silos', rota: 'graos/silos', icone: 'termometro', cor: COR_VERMELHO,
          titulo: `Temperatura subindo no ${s.name}`, texto: `${tm.subindo.map(x => `cabo ${x.cabo}: +${num(x.dif, 1)} °C`).join(', ')} desde a leitura anterior. Verifique e considere aerar.`,
          curto: `${s.name} esquentando`, sub: `Cabo ${pior.cabo} subiu ${num(pior.dif, 1)} °C desde a última leitura`,
          valor: tm.max != null ? `${num(tm.max, 0)}°` : `+${num(pior.dif, 1)}°`, unid: tm.max != null ? 'máxima' : 'subida',
          acoes: [{t: 'Ver termometria', rota: 'graos/silos'}]}, horaBoa(agora));
      }
      const fx = tm.media != null && typeof horasAerar === 'function' ? horasAerar(tm.media) : null, f = fx?.[0];
      if (f && f.ini.getTime() - agora < 24 * 36e5) { const k = f.ini.getTime(); (aerar[k] ||= {f, silos: []}).silos.push(s.name); }
    });
    Object.values(aerar).forEach(({f, silos}) => {
      const ini = f.ini.getTime(), hIni = f.ini.getHours(), horas = Math.round((f.fim - f.ini) / 36e5) + 1;
      // Aeração costuma ser à noite: avisa às 18h da tarde anterior em vez de acordar o agricultor
      const tarde = new Date(f.ini); if (hIni < 7) tarde.setDate(tarde.getDate() - 1);
      const quando = hIni >= 7 && hIni < 21 ? ini : Math.min(ini, horaDe(isoLocal(tarde), 18));
      const fim = (f.fim.getHours() + 1) % 24;
      add('silos', {id: `aerar-${assinatura(silos)}-${isoLocal(f.ini)}-${hIni}`, tipo: 'silos', rota: 'graos/silos', icone: 'vento',
        titulo: `Boa hora para aerar: ${silos.join(', ')}`, texto: `Ar pelo menos 5 °C abaixo da temperatura dos grãos das ${hIni}h às ${fim}h.`,
        curto: 'Boa hora para aerar', sub: `Ar frio das ${hIni}h às ${fim}h · ${silos.slice(0, 3).join(', ')}`, valor: String(horas), unid: horas === 1 ? 'hora' : 'horas',
        acoes: [{t: 'Ver silos', rota: 'graos/silos'}]}, quando);
    });
  }

  // ---------- Aplicações: carência cumprida (colheita liberada) ----------
  if (tiposOk.carencia && typeof liberacaoColheita === 'function') db.fields.forEach(f => {
    const l = liberacaoColheita(f.id); if (!l || !(Number(l.a.carencia) > 0) || l.libera < t || l.libera > addDias(t, 7)) return;
    add('aplicacoes', {id: `carencia-${f.id}-${l.libera}`, tipo: 'carencia', rota: 'aplicacoes', icone: 'escudo',
      titulo: `Carência cumprida: ${f.name}`, texto: `${l.a.produto || 'Aplicação'} de ${fmtDate(l.a.date)} (${l.a.carencia} dias). Colheita liberada a partir de ${fmtDate(l.libera)}.`,
      curto: `Colheita liberada — ${f.name}`, sub: `${l.a.produto || 'Aplicação'} de ${fmtDate(l.a.date).slice(0, 5)} · ${l.a.carencia} dias de carência`,
      valor: 'Livre', unid: '', acoes: [{t: 'Ver aplicações', rota: 'aplicacoes'}]}, l.libera === t ? horaBoa(agora) : horaDe(l.libera, 7));
  });

  // ---------- Operações atrasadas ----------
  if (tiposOk.atrasadas) db.operations.filter(o => o.status === 'Programada' && o.date && o.date < t).forEach(o => {
    const dias = Math.round((new Date(t + 'T12:00:00') - new Date(o.date + 'T12:00:00')) / 864e5);
    add('operacoes', {id: `atrasada-${o.id}-${o.date}`, tipo: 'atrasadas', rota: 'operacoes', icone: 'relogio',
      titulo: `Operação atrasada: ${o.type}`, texto: `${opPlace(o)} — programada para ${fmtDate(o.date)}.`,
      curto: `${o.type} atrasada`, sub: `${opPlace(o)} · programada para ${fmtDate(o.date).slice(0, 5)}`, valor: String(dias), unid: dias === 1 ? 'dia' : 'dias',
      acoes: [{t: 'Ver operações', rota: 'operacoes'}, {t: 'Lembrar amanhã', tipo: 'adiar'}]}, horaBoa(agora));
  });

  // ---------- Financeiro: contas vencidas e vencendo (só ADM e supervisor) ----------
  if (tiposOk.contas && Array.isArray(db.contas)) {
    const em3 = addDias(t, 3), abertas = db.contas.filter(x => x.status !== 'paga' && x.vencimento && x.tipo === 'pagar' && x.vencimento <= em3).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
    if (abertas.length) {
      const venc = abertas.filter(x => x.vencimento < t), total = abertas.reduce((s, x) => s + (Number(x.valor) || 0), 0), prim = abertas.find(x => x.vencimento >= t);
      add('financeiro', {id: `contas-${assinatura(abertas.map(x => x.id + x.vencimento))}`, tipo: 'contas', rota: 'financeiro', icone: 'recibo', ...(venc.length ? {cor: COR_VERMELHO} : {}),
        titulo: venc.length ? `${plural(venc.length, 'conta vencida', 'contas vencidas')}${abertas.length > venc.length ? ` e ${abertas.length - venc.length} a vencer` : ''}` : `${plural(abertas.length, 'conta vence', 'contas vencem')} em até 3 dias`,
        texto: abertas.slice(0, 3).map(x => `${x.descricao} — R$ ${num(x.valor, 2)} (${fmtDate(x.vencimento)})`).join('; ') + (abertas.length > 3 ? '…' : '.'),
        curto: venc.length ? plural(venc.length, 'conta vencida', 'contas vencidas') : `${plural(abertas.length, 'conta vence', 'contas vencem')} em breve`,
        sub: prim ? `A próxima vence ${prim.vencimento === t ? 'hoje' : prim.vencimento === amanha ? 'amanhã' : 'em ' + fmtDate(prim.vencimento).slice(0, 5)}` : 'Regularize os pagamentos',
        valor: valorCurto(total), unid: 'a pagar', acoes: [{t: 'Ver contas', rota: 'financeiro'}]}, horaBoa(agora));
    }
  }

  // ---------- Compras: pedido aguardando aprovação (quem decide) ----------
  if (tiposOk.compras && Array.isArray(db.pedidosCompra)) db.pedidosCompra.filter(x => x.status === 'solicitado').forEach(x => {
    const desc = typeof cprDesc === 'function' ? cprDesc(x) : x.descricao || 'Item', maq = typeof cprMaqNome === 'function' ? cprMaqNome(x) : '', parada = x.urgencia === 'parada';
    add('compras', {id: `compra-${x.id}`, tipo: 'compras', rota: 'compras/aprovar', icone: 'carrinho', ...(parada ? {cor: COR_VERMELHO} : {}),
      titulo: `Pedido de compra aguardando aprovação${parada ? ' — máquina parada' : ''}`, texto: `${x.por || 'Alguém'} pediu ${desc}${maq ? ' para ' + maq : ''}.`,
      curto: parada ? 'Máquina parada: aprovar compra' : 'Pedido aguardando sua aprovação', sub: `${x.por || 'Alguém'} pediu ${desc}${maq ? ' — ' + maq : ''}`,
      valor: x.numero ? `#${x.numero}` : '', unid: '', acoes: [{t: 'Ver pedido', rota: 'compras/aprovar'}]}, horaBoa(agora));
  });
  return lista;
}

function lerEnviados() { try { return JSON.parse(safeStorage.get(ALERTA_ENV) || '{}') || {}; } catch { return {}; } }
const podeNotificarWeb = () => typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator;
// O que vai para o Android montar o cartão (o tipo interno fica de fora)
const paraAndroid = ({tipo, ...a}) => ({...a, canal: a.cat || 'clima'});
// Navegador: notificação do sistema, com até 2 botões (o toque leva à tela do botão)
function mostrarWeb(reg, a) {
  const acoes = (a.acoes || []).filter(x => x.rota).slice(0, 2);
  return reg.showNotification(`${a.rotulo ? a.rotulo + ' · ' : ''}${a.titulo}`, {body: a.texto, tag: a.id, icon: 'icon-192.png', badge: 'icon-192.png',
    actions: acoes.map((x, i) => ({action: 'r' + i, title: x.t})), data: {rota: a.rota, rotas: acoes.map(x => x.rota)}});
}
// Entrega: no APK agenda tudo no Android (substitui o agendamento anterior); no navegador mostra o que já venceu
function entregarAlertas() {
  const cfg = alertaCfg(), ponte = window.AndroidBridge;
  if (!cfg.ativo) { if (ponte?.agendarAlertas) ponte.agendarAlertas('[]'); return []; }
  const agora = Date.now(), env = lerEnviados();
  Object.keys(env).forEach(k => { if (agora - env[k] > 40 * 864e5) delete env[k]; });
  // Já entregue (horário passou) não repete; agendado para o futuro é reagendado com o texto atualizado
  const lista = calcularAlertas(cfg, agora).filter(a => !(env[a.id] && env[a.id] <= agora));
  if (ponte?.agendarAlertas) {
    ponte.agendarAlertas(JSON.stringify(lista.map(paraAndroid)));
    lista.forEach(a => { env[a.id] = a.quando; });
  } else if (podeNotificarWeb()) {
    const agoraLista = lista.filter(a => a.quando <= agora);
    navigator.serviceWorker.ready.then(reg => agoraLista.forEach(a => mostrarWeb(reg, a))).catch(() => {});
    agoraLista.forEach(a => { env[a.id] = agora; });
  }
  safeStorage.set(ALERTA_ENV, JSON.stringify(env));
  return lista;
}

// ---------- Ligar/desligar (Ajustes → Alertas e atalho no "Hoje") ----------
function suporteAlertas() {
  if (window.AndroidBridge?.agendarAlertas) return 'apk';
  if (typeof Notification !== 'undefined' && 'serviceWorker' in navigator) return 'web';
  return '';
}
function cartaoAlertas() {
  const cfg = alertaCfg(), sup = suporteAlertas();
  const nota = sup === 'apk' ? 'No app Android os alertas chegam mesmo com o MercaPlant fechado.'
    : sup === 'web' ? 'No navegador, os alertas aparecem quando você abre o MercaPlant. Para receber com o app fechado, use o app Android.'
    : 'Este navegador não mostra notificações. No iPhone, adicione o MercaPlant à Tela de Início; no Android, use o app.';
  return `<article class="card panel" id="cartaoAlertas"><h3>Alertas no celular</h3><p>Avisos automáticos com base nos seus registros e na previsão do tempo.</p>
    <div class="btn-row">${cfg.ativo ? `${btn('Desligar alertas', 'alertas-desligar', '', 'secondary')}${btn('Enviar um teste', 'alertas-teste', '', 'secondary')}` : sup ? btn('🔔 Ligar alertas', 'alertas-ligar') : ''}</div>
    ${cfg.ativo ? `<div class="alertas-tipos">${ALERTA_TIPOS.filter(([, , , pode]) => !pode || pode()).map(([k, nome, dica]) => `<label class="alerta-tipo"><input type="checkbox" data-alerta-tipo="${k}" ${cfg[k] ? 'checked' : ''}><span><strong>${esc(nome)}</strong><small>${esc(dica)}</small></span></label>`).join('')}</div>` : ''}
    <small class="nota">${esc(nota)}</small></article>`;
}
const redesenharAlertas = () => { const el = document.getElementById('cartaoAlertas'); if (el) el.outerHTML = cartaoAlertas(); };
function ligarAlertas() {
  const ok = permitido => {
    if (!permitido) { showToast('Notificações bloqueadas. Libere nas configurações do celular (Apps → MercaPlant → Notificações) ou do navegador.', true); return; }
    const cfg = alertaCfg(); cfg.ativo = true; salvarAlertaCfg(cfg);
    const n = entregarAlertas().length; redesenharAlertas(); if (typeof nvAtualizarOuRender === 'function' && parseRoute().name === 'inicio') nvAtualizarOuRender();
    showToast(n ? `Alertas ligados: ${n} ${n === 1 ? 'aviso agendado' : 'avisos agendados'}.` : 'Alertas ligados. Você será avisado quando houver algo.');
  };
  const ponte = window.AndroidBridge;
  if (ponte?.agendarAlertas) {
    if (ponte.notificacoesPermitidas?.()) return ok(true);
    window.onNotificacoesPermitidas = ok; ponte.pedirNotificacoes(); return;
  }
  if (typeof Notification === 'undefined') return showToast('Este navegador não mostra notificações.', true);
  if (Notification.permission === 'granted') return ok(true);
  Promise.resolve(Notification.requestPermission()).then(p => ok(p === 'granted')).catch(() => ok(false));
}
// Exemplo do teste: um aviso de chuva forte completo (mostra o cartão escuro, o gráfico e os botões)
const alertaExemplo = () => ({id: `teste-${Date.now()}`, quando: Date.now(), cat: 'clima', rotulo: 'Clima', cor: COR_LARANJA, fazenda: nomeFazenda(), tipo: 'chuva', rota: 'clima', icone: 'chuva',
  titulo: 'Exemplo: chuva de 38 mm amanhã, a partir das 14h', texto: 'É assim que os alertas do MercaPlant vão chegar: chuva, geada, pulverização, máquinas, estoque, silos e mais.',
  curto: 'Exemplo: chuva forte amanhã às 14h', sub: '85% de chance · 2 operações afetadas', valor: '38', unid: 'mm', selo: 'EXEMPLO · CHUVA FORTE', dia: 'amanhã',
  detalhe: 'das 14h às 19h · 85% de chance', barras: [['12h', 0], ['13h', 0.2], ['14h', 4], ['15h', 12], ['16h', 9], ['17h', 5], ['18h', 2], ['19h', 0.4]].map(([h, v]) => ({h, v})),
  quadros: [['Rajadas', '52 km/h', true], ['Trovoada', 'Possível', true], ['Temp.', '17°/26°', false]], aviso: 'Programado para amanhã: Aplicação — Talhão 3; Plantio — Talhão 7.',
  acoes: [{t: 'Ver previsão', rota: 'clima'}, {t: 'Reprogramar', rota: 'operacoes'}]});
Object.assign(ACTIONS, {
  'alertas-ligar': ligarAlertas,
  'alertas-desligar': () => { const cfg = alertaCfg(); cfg.ativo = false; salvarAlertaCfg(cfg); entregarAlertas(); redesenharAlertas(); showToast('Alertas desligados neste aparelho.'); },
  'alertas-teste': () => {
    const a = alertaExemplo();
    if (window.AndroidBridge?.agendarAlertas) { window.AndroidBridge.testarAlerta?.(JSON.stringify(paraAndroid(a))); }
    else if (podeNotificarWeb()) navigator.serviceWorker.ready.then(reg => mostrarWeb(reg, a));
    showToast('Teste enviado: veja a notificação do celular.');
  }
});
document.addEventListener('change', e => {
  const k = e.target?.dataset?.alertaTipo; if (!k) return;
  const cfg = alertaCfg(); cfg[k] = e.target.checked; salvarAlertaCfg(cfg); entregarAlertas();
});

// Recalcula ao abrir, ao voltar para o app, a cada 15 min e depois de cada previsão nova
if (typeof buscarClima === 'function') {
  const buscarClimaOriginal = buscarClima;
  buscarClima = async (...args) => { await buscarClimaOriginal(...args); try { entregarAlertas(); } catch { /* não atrapalha a previsão */ } };
}
addEventListener('load', () => setTimeout(() => { try { entregarAlertas(); } catch (e) { console.error(e); } }, 4000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { entregarAlertas(); } catch { /* segue */ } });
setInterval(() => { if (document.visibilityState === 'visible') try { entregarAlertas(); } catch { /* segue */ } }, 15 * 60000);
