'use strict';
/* Agenda de aferição (0.87).
   O gestor programa: máquina, o que aferir, data, responsável e se repete (não repete, a cada N dias/semanas/meses,
   a cada N horas de uso ou antes de cada operação programada da máquina). A aferição feita fecha a vez sozinha
   e, se repete, a próxima já aparece. O sistema não programa nada sozinho: ele só SUGERE (máquina sem programação,
   operação programada sem aferição, troca de cultura, resultado fora, desgaste das pontas, inspeção vencendo)
   e o gestor decide com um toque (Programar ou Dispensar).
   As programações ficam na própria máquina (m.afAgenda), sincronizadas com a nuvem como o resto do cadastro.
   O antigo "Reaferir a cada (dias)" vira uma programação "a cada N dias" (sem gravar nada até o gestor editar). */

// Quem programa, adia e cancela: ADM e supervisor (ou o uso sem nuvem). O usuário comum vê a agenda e afere.
const agaGestor = () => !(typeof nvComum === 'function' && nvComum());

const AGA_REP = [['nao', 'Não repetir (só uma vez)'], ['dias', 'A cada … dias'], ['semanas', 'A cada … semanas'], ['meses', 'A cada … meses'], ['horas', 'A cada … horas de uso (horímetro)'], ['antes', 'Antes de cada operação programada da máquina']];
const AGA_ORDEM = {atrasada: 0, hoje: 1, semana: 2, em_dia: 3, aguardando: 4, concluida: 5};
const AGA_COR = {atrasada: 'red', hoje: 'orange', semana: 'orange', em_dia: 'green', aguardando: 'gray', concluida: 'gray'};
const AGA_ROT = {atrasada: 'Atrasada', hoje: 'Hoje', semana: 'Esta semana', em_dia: 'Em dia', aguardando: 'Aguardando operação', concluida: 'Feita'};

const agaTipoDe = m => m.type === 'Implemento' ? (m.tipoImpl || '') : m.type;
const AGA_PLANTIO = ['Plantadeira', 'Semeadora', 'Plantadora de cana', 'Plantadora de batata / mandioca', 'Transplantadora de mudas'];
const AGA_DISTRIB = ['Distribuidor autopropelido', 'Distribuidor de adubo/calcário', 'Distribuidor de esterco / chorume'];
const agaGrupo = m => { const t = agaTipoDe(m); return afPulverizacao(m) && t && t !== 'Outro' ? 'pulv' : AGA_PLANTIO.includes(t) ? 'plantio' : AGA_DISTRIB.includes(t) ? 'distrib' : /^(Colhe|Plataforma)/.test(t) ? 'colheita' : ''; };
// O que se afere em cada máquina ('' = qualquer aferição desta máquina)
const AGA_TIPOS_GRUPO = {pulv: ['bicos', 'taxa', 'sensor', 'inspecao'], plantio: ['dose', 'longitudinal'], distrib: ['dose', 'transversal'], colheita: ['perdas']};
const agaTiposDe = m => ['', ...(AGA_TIPOS_GRUPO[agaGrupo(m)] || [...Object.keys(TIPOS), 'inspecao'])];
// Operação em que a máquina trabalha (para "antes de cada …"); sem grupo = qualquer operação de lavoura
const AGA_OP = {pulv: 'Aplicação', plantio: 'Plantio', distrib: 'Adubação', colheita: 'Colheita'};
const agaOpTipo = m => AGA_OP[agaGrupo(m)] || '';
const agaTipoTxt = t => !t ? 'Qualquer aferição' : t === 'inspecao' ? 'Inspeção do pulverizador' : TIPO_UI[t]?.curto || TIPOS[t]?.titulo || t;
const agaMaquinas = () => db.machines.filter(m => !isInactive(m) && afAferivel(m)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
const agaUsa = (o, m) => o.machineId === m.id || o.implementoId === m.id;
const agaDiff = d => Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
const agaSomar = (d, rep, n) => rep === 'meses' ? addMeses(d, n) : addDias(d, rep === 'semanas' ? 7 * n : n);
const agaAfs = (m, tipo) => db.afericoes.filter(a => a.maquina?.id === m.id && (!tipo || a.tipo === tipo)).sort((a, b) => (b.data + (b.hora || '')).localeCompare(a.data + (a.hora || '')));
const agaCultura = o => String((o?.fieldId && find('fields', o.fieldId)?.crop) || '').trim();

// Programações da máquina (+ o antigo intervalo em dias, enquanto o gestor não editar)
function agaAgendas(m) {
  const l = Array.isArray(m.afAgenda) ? m.afAgenda : [];
  const dias = Number(m.reaferirDias);
  if (dias > 0 && !l.some(a => a.id === 'legado')) return [...l, {id: 'legado', tipo: '', rep: 'dias', n: dias, data: '', criadoEm: '0000-00-00', resp: '', obs: '', ativo: true, legado: true}];
  return l;
}
function agaRepTxt(ag, m) {
  const n = Number(ag.n) || 0;
  return {nao: 'Uma vez', dias: `A cada ${num(n)} ${n === 1 ? 'dia' : 'dias'}`, semanas: `A cada ${num(n)} ${n === 1 ? 'semana' : 'semanas'}`, meses: `A cada ${num(n)} ${n === 1 ? 'mês' : 'meses'}`,
    horas: `A cada ${num(n)} h de uso`, antes: `Antes de cada ${(agaOpTipo(m) || 'operação').toLowerCase()}${n ? ` (${num(n)} d antes)` : ''}`}[ag.rep] || '';
}

// A vez atual de uma programação: quando vence, situação e o que falta
function agaOcorrencia(m, ag) {
  const afs = agaAfs(m, ag.tipo), desde = ag.criadoEm || '0000-00-00', n = Number(ag.n) || 0;
  const r = {m, ag, venc: null, horas: null, op: null, feita: null, nota: ''};
  const ult = afs.find(a => a.data >= desde);
  if (ag.rep === 'nao') {
    if (ult) return {...r, feita: ult, status: 'concluida', quando: `feita em ${fmtDate(ult.data)}`};
    r.venc = ag.data || today();
  } else if (['dias', 'semanas', 'meses'].includes(ag.rep)) {
    const prox = ult ? agaSomar(ult.data, ag.rep, n) : '';
    r.venc = ult ? (ag.data && ag.data > prox ? ag.data : prox) : (ag.data || today());
    if (!ult && !ag.data) r.nota = 'nunca aferida';
  } else if (ag.rep === 'horas') {
    const numOu = v => v === '' || v == null ? NaN : Number(v), atual = Number(m.hours) || 0;
    let base = numOu(ult ? ult.maquina?.hours : ag.baseHoras); if (!Number.isFinite(base)) base = atual;
    const alvo = base + n;
    r.horas = {alvo, faltam: alvo - atual};
  } else if (ag.rep === 'antes') {
    const tOp = agaOpTipo(m), daMaq = db.operations.filter(o => agaUsa(o, m) && (tOp ? o.type === tOp : OP_LAVOURA.includes(o.type)));
    const P = daMaq.filter(o => o.status === 'Programada' && o.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!P) return {...r, status: 'aguardando', quando: `aguardando ${tOp ? (tOp === 'Aplicação' ? 'a próxima aplicação programada' : `o próximo ${tOp.toLowerCase()} programado`) : 'a próxima operação programada'}`};
    const prev = daMaq.filter(o => ['Concluída', 'Em andamento'].includes(o.status) && (o.date || '') <= P.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const feita = afs.find(a => prev ? a.data > prev.date : a.data >= desde);
    r.op = P;
    if (feita) return {...r, feita, status: 'em_dia', quando: `aferida em ${fmtDate(feita.data)} para ${P.type.toLowerCase()} de ${fmtDate(P.date)}`};
    r.venc = addDias(P.date, -n);
    const c1 = agaCultura(P), c0 = agaCultura(prev);
    if (['plantio', 'colheita'].includes(agaGrupo(m)) && c1 && c0 && semAcento(c1) !== semAcento(c0)) r.nota = `troca de cultura: ${c0} → ${c1}`;
  }
  if (r.venc && ag.adiar?.venc === r.venc && ag.adiar.para) { r.adiado = ag.adiar; r.venc = ag.adiar.para; }
  if (r.horas) {
    const f = r.horas.faltam;
    r.status = f <= 0 ? 'atrasada' : f <= Math.max(10, n * 0.1) ? 'semana' : 'em_dia';
    r.quando = f <= 0 ? `passou ${num(-f)} h (era aos ${num(r.horas.alvo)} h)` : `em ${num(f)} h (aos ${num(r.horas.alvo)} h)`;
  } else {
    const d = agaDiff(r.venc);
    r.dias = d; r.status = d < 0 ? 'atrasada' : d === 0 ? 'hoje' : d <= 7 ? 'semana' : 'em_dia';
    r.quando = fmtDate(r.venc) + (d < 0 ? ` (atrasada ${-d} d)` : d === 0 ? ' (hoje)' : d <= 7 ? ` (em ${d} d)` : '');
  }
  return r;
}
// Todas as vezes em aberto (e as feitas há pouco), da mais urgente para a menos
function agaLista() {
  const l = [];
  for (const m of db.machines.filter(x => !isInactive(x))) for (const ag of agaAgendas(m)) {
    if (ag.ativo === false) continue;
    const o = agaOcorrencia(m, ag);
    if (o.status === 'concluida' && o.feita.data < addDias(today(), -30)) continue;
    l.push(o);
  }
  return l.sort((a, b) => AGA_ORDEM[a.status] - AGA_ORDEM[b.status] || String(a.venc || '9').localeCompare(String(b.venc || '9')) || (a.horas?.faltam ?? 1e9) - (b.horas?.faltam ?? 1e9));
}
const agaPendentesDe = m => agaAgendas(m).filter(ag => ag.ativo !== false).map(ag => agaOcorrencia(m, ag)).filter(o => !['concluida', 'aguardando'].includes(o.status));

// ---------- Sugestões (o sistema só sugere; quem programa é o gestor) ----------
function agaSugestoes() {
  const s = [], hoje = today();
  for (const m of agaMaquinas().filter(afCalendario)) {
    const ags = agaAgendas(m).filter(a => a.ativo !== false), occ = ags.map(a => agaOcorrencia(m, a)), disp = m.afDispensa || {};
    const tipos = agaTiposDe(m), tipoPadrao = tipos[1] || '', tOp = agaOpTipo(m);
    const cobre = (tipo, ate) => occ.some(o => (!o.ag.tipo || !tipo || o.ag.tipo === tipo) && (o.ag.rep === 'antes' || (o.status !== 'concluida' && o.venc && (!ate || o.venc <= ate)) || o.horas));
    const add = x => { if (!disp[x.chave]) s.push({m, ...x}); };
    let houveOp = false; // sugestão de operação (mesmo dispensada) já cobre a de "sem programação"
    // Operação programada (próximos 45 dias) sem aferição desde o último uso
    const daMaq = db.operations.filter(o => agaUsa(o, m) && OP_LAVOURA.includes(o.type));
    for (const P of daMaq.filter(o => o.status === 'Programada' && o.date && o.date <= addDias(hoje, 45)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2)) {
      if (tOp && P.type !== tOp) continue;
      const prev = daMaq.filter(o => o.type === P.type && ['Concluída', 'Em andamento'].includes(o.status) && (o.date || '') <= P.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const afs = agaAfs(m, ''), feita = afs.find(a => prev ? a.data > prev.date : true);
      const c1 = agaCultura(P), c0 = agaCultura(prev) || (afs[0]?.produto ? (PRODUTOS.find(p => p[0] === afs[0].produto)?.[1] || '') : '');
      // Troca de cultura muda a regulagem de plantadeira e colheitadeira (no pulverizador, o que muda é o produto)
      const troca = ['plantio', 'colheita'].includes(agaGrupo(m)) && c1 && c0 && semAcento(c1) !== semAcento(c0);
      if ((feita && !troca) || cobre(tipoPadrao, P.date)) continue;
      houveOp = true;
      add({chave: 'op:' + P.id, titulo: `${P.type} ${P.type === 'Aplicação' ? 'programada' : 'programado'} para ${fmtDate(P.date)}${feita ? '' : ' sem aferição'}`,
        texto: `${troca ? `Troca de cultura (${c0} → ${c1}): a regulagem muda. ` : ''}${feita ? '' : prev ? `A máquina não foi aferida desde ${P.type === 'Aplicação' ? 'a última aplicação' : `o último ${P.type.toLowerCase()}`} (${fmtDate(prev.date)}).` : 'A máquina ainda não tem aferição registrada.'}`.trim(),
        pre: {tipo: tipoPadrao, rep: 'nao', data: addDias(P.date, -2) < hoje ? hoje : addDias(P.date, -2), obs: `Antes de ${P.type.toLowerCase()} de ${fmtDate(P.date)}${troca ? ` (troca de cultura: ${c0} → ${c1})` : ''}`}});
    }
    // Sem nenhuma programação (e sem sugestão de operação acima, que já cobre)
    if (!ags.length && !houveOp) add({chave: 'sem', titulo: 'Nenhuma aferição programada', texto: `Programe a aferição ${tOp ? `antes de cada ${tOp.toLowerCase()}` : ''} ou com a repetição que a fazenda usa.`.replace('  ', ' '),
      pre: {tipo: tipoPadrao, rep: tOp ? 'antes' : 'nao', n: tOp ? 2 : '', data: addDias(hoje, 7)}});
    // Último resultado de cada tipo fora da referência, sem aferição depois
    const doMaq = agaAfs(m, '');
    for (const tipo of new Set(doMaq.map(a => a.tipo))) {
      const u = doMaq.find(a => a.tipo === tipo);
      if (['FORA_DO_PADRAO', 'ATENCAO'].includes(u.resultado?.status) && !cobre(tipo)) {
        const d = addDias(u.data, 3);
        add({chave: 'fora:' + u.id, titulo: tipo === 'inspecao' ? `Inspeção reprovada em ${fmtDate(u.data)}` : `${agaTipoTxt(tipo)}: deu ${u.resultado.status === 'ATENCAO' ? 'atenção' : 'fora da referência'} em ${fmtDate(u.data)}`,
          texto: tipo === 'inspecao' ? 'Corrija os itens e programe a nova inspeção.' : 'Depois do ajuste, afira de novo para confirmar.', pre: {tipo, rep: 'nao', data: d < hoje ? hoje : d}});
      } else if (tipo === 'inspecao' && u.resultado?.validade && u.resultado.validade <= addDias(hoje, 30) && !cobre('inspecao', u.resultado.validade)) {
        add({chave: 'insp:' + u.resultado.validade, titulo: `Inspeção ${u.resultado.validade < hoje ? 'venceu' : 'vence'} em ${fmtDate(u.resultado.validade)}`, texto: 'Programe a próxima inspeção periódica.',
          pre: {tipo: 'inspecao', rep: 'nao', data: u.resultado.validade < hoje ? hoje : u.resultado.validade}});
      }
    }
    // Previsão de desgaste das pontas (tendência das aferições de bicos)
    const ub = doMaq.find(a => a.tipo === 'bicos');
    if (ub && typeof IA === 'function' && IA()) {
      const t = IA().tendenciaBicos(historicoBicos(m.id), limiteBicos(ub.resultado)[1]);
      if (t?.situacao === 'desgastando' && t.dataPrevista && !cobre('bicos', t.dataPrevista)) {
        const d = addDias(t.dataPrevista, -7);
        add({chave: 'desg:' + t.dataPrevista, titulo: `Pontas devem passar do limite por volta de ${fmtDate(t.dataPrevista)}`, texto: 'Previsão pela tendência das últimas aferições de bicos.', pre: {tipo: 'bicos', rep: 'nao', data: d < hoje ? hoje : d}});
      }
    }
  }
  return s;
}

// ---------- Aviso ao iniciar a operação ----------
// Máquina (ou implemento) da operação com aferição atrasada ou que precisava ser feita antes desta operação
function agaAvisoOperacao(o) {
  const msgs = []; let bloq = false;
  for (const id of [o.machineId, o.implementoId].filter(Boolean)) {
    const m = find('machines', id); if (!m) continue;
    for (const p of agaPendentesDe(m)) {
      const antesDesta = p.ag.rep === 'antes' && p.op?.id === o.id;
      if (p.status !== 'atrasada' && !antesDesta) continue;
      msgs.push(`${m.name}: ${agaTipoTxt(p.ag.tipo).toLowerCase()} ${antesDesta ? 'programada para antes desta operação e ainda não feita' : `atrasada (${p.quando})`}`);
      if (p.ag.bloquear) bloq = true;
    }
  }
  return msgs.length ? {texto: msgs.join('; '), bloq} : null;
}

// ---------- Tela: agenda no topo da Aferição ----------
function agaPainel() {
  const g = agaGestor(), lista = agaLista(), sug = g ? agaSugestoes() : [];
  const linha = o => {
    const m = o.m, ag = o.ag, quem = ag.resp ? ` • Resp.: ${esc(ag.resp)}` : '';
    const menu = g && !ag.legado ? `<details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">${mini('Editar', 'aga-editar', m.id + '|' + ag.id)}${o.venc && o.status !== 'concluida' ? mini('Adiar', 'aga-adiar', m.id + '|' + ag.id) : ''}${mini('Cancelar a programação', 'aga-cancelar', m.id + '|' + ag.id, 'del')}</div></details>`
      : g && ag.legado ? mini('Editar', 'aga-editar', m.id + '|legado', 'small secondary') : '';
    return `<div class="aga-item aga-${o.status}"><span class="status ${AGA_COR[o.status] === 'gray' ? 'blue' : AGA_COR[o.status]}"></span><div class="aga-txt"><strong>${esc(m.name)} — ${esc(agaTipoTxt(ag.tipo))}</strong>
      <small>${esc(agaRepTxt(ag, m))} • ${o.venc || o.horas ? 'Próxima: ' : ''}${esc(o.quando)}${quem}</small>
      ${o.nota || o.adiado || ag.obs ? `<small class="aga-nota">${[o.nota && '⚠ ' + o.nota, o.adiado && `Adiada de ${fmtDate(o.adiado.venc)}${o.adiado.motivo ? ': ' + o.adiado.motivo : ''}`, ag.obs].filter(Boolean).map(esc).join(' • ')}</small>` : ''}</div>
      <div class="aga-dir">${chip(AGA_ROT[o.status], AGA_COR[o.status])}${ag.bloquear ? '<small title="Bloqueia o início da operação enquanto estiver atrasada">🔒</small>' : ''}
      <div class="aga-bts">${['concluida', 'aguardando'].includes(o.status) || o.feita ? '' : `<button class="small ${o.status === 'atrasada' || o.status === 'hoje' ? 'primary' : 'secondary'}" data-act="aga-aferir" data-id="${esc(m.id + '|' + ag.tipo)}">Aferir agora</button>`}${menu}</div></div></div>`;
  };
  const abertas = lista.filter(o => o.status !== 'concluida'), feitas = lista.filter(o => o.status === 'concluida');
  const sugHtml = sug.length ? `<section class="card panel aga-sug"><div class="aga-sug-cab"><strong>💡 Sugestões (${sug.length})</strong><small>O sistema não programa nada sozinho: você decide se programa ou dispensa.</small></div>
    ${sug.slice(0, 6).map((x, i) => `<div class="aga-sug-item"><div><strong>${esc(x.m.name)}: ${esc(x.titulo)}</strong><small>${esc(x.texto)}</small></div><div class="aga-bts"><button class="small primary" data-act="aga-sug-prog" data-id="${i}">Programar</button><button class="small secondary" data-act="aga-sug-disp" data-id="${i}">Dispensar</button></div></div>`).join('')}
    ${sug.length > 6 ? `<small class="aga-mais">Mais ${sug.length - 6} ${sug.length - 6 === 1 ? 'sugestão' : 'sugestões'} depois destas.</small>` : ''}</section>` : '';
  agaSugAtual = sug;
  return `<div class="section-title"><h3>Agenda de aferição</h3>${g ? btn('📅 Programar aferição', 'aga-nova', '', 'primary') : ''}</div>${sugHtml}
    <section class="card panel aga-lista">${abertas.length ? abertas.map(linha).join('') : empty('Nenhuma aferição programada', g ? 'Toque em “📅 Programar aferição” e escolha a máquina, a data e se repete.' : 'Quando o gestor programar, as aferições aparecem aqui.')}
    ${feitas.length ? `<details class="aga-feitas"><summary>Feitas nos últimos 30 dias (${feitas.length})</summary>${feitas.map(linha).join('')}</details>` : ''}</section>`;
}
let agaSugAtual = [];

// ---------- Programar / editar ----------
function agaForm(machineId, agId, pre = {}) {
  if (!agaGestor()) return showToast('Só o gestor (ADM ou supervisor) programa aferições', true);
  const maqs = agaMaquinas();
  if (!maqs.length) return showToast('Cadastre um pulverizador, plantadeira, distribuidor ou colheitadeira para programar a aferição', true);
  const m0 = machineId ? find('machines', machineId) : null, ag = m0 && agId ? agaAgendas(m0).find(a => a.id === agId) : null;
  const v0 = ag ? {machineId: m0.id, tipo: ag.tipo, data: ag.data || '', rep: ag.rep, n: ag.rep === 'antes' ? '' : ag.n, nAntes: ag.rep === 'antes' ? ag.n : 2, resp: ag.resp || '', obs: ag.obs || '', bloquear: ag.bloquear ? 'Sim' : 'Não'}
    : {machineId: machineId || '', tipo: '', data: addDias(today(), 7), rep: 'nao', n: '', nAntes: 2, resp: '', obs: '', bloquear: 'Não', ...pre, ...(pre.rep === 'antes' ? {nAntes: pre.n ?? 2, n: ''} : {})};
  if (!v0.resp && v0.machineId) v0.resp = agaOperadorDe(find('machines', v0.machineId));
  const tipoOpts = id => { const m = id && find('machines', id); return (m ? agaTiposDe(m) : ['', ...Object.keys(TIPOS), 'inspecao']).map(t => ({value: t, label: agaTipoTxt(t)})); };
  openForm({form: 'aga', editando: !!ag, title: ag ? 'Editar programação de aferição' : 'Programar aferição', sub: 'Escolha a máquina, quando e se repete. A aferição feita fecha a vez; se repetir, a próxima já fica marcada.', submit: ag ? 'Salvar' : 'Programar',
    values: v0, fields: [
      {k: 'machineId', label: 'Máquina', type: 'select', required: true, options: () => [{value: '', label: 'Escolha a máquina'}, ...maqs.map(m => ({value: m.id, label: m.name + (m.type === 'Implemento' ? ` (${m.tipoImpl || 'implemento'})` : '')}))], full: true},
      {k: 'tipo', label: 'O que aferir', type: 'select', options: () => tipoOpts(v0.machineId), full: true, hint: '“Qualquer aferição” vale para bicos, dose, perdas ou inspeção desta máquina.'},
      {k: 'rep', label: 'Repetir', type: 'select', options: AGA_REP.map(([value, label]) => ({value, label})), required: true, full: true},
      {k: 'data', label: 'Data', type: 'date', mostrarSe: ['rep', ['nao', 'dias', 'semanas', 'meses']], hint: 'Na repetição, é a primeira data. Depois conta a partir da aferição feita.'},
      {k: 'n', label: 'A cada (número)', type: 'number', min: 1, mostrarSe: ['rep', ['dias', 'semanas', 'meses', 'horas']]},
      {k: 'nAntes', label: 'Quantos dias antes da operação', type: 'number', min: 0, mostrarSe: ['rep', 'antes'], hint: 'Vale para cada plantio, aplicação ou colheita programada com esta máquina.'},
      {k: 'resp', label: 'Responsável', sugestoes: typeof agPessoas === 'function' ? agPessoas : [], canon: true},
      {k: 'bloquear', label: 'Se atrasar, bloquear o início da operação?', type: 'select', options: ['Não', 'Sim'], hint: 'Sim: o operador não inicia a operação com esta máquina até aferir; o gestor pode iniciar mesmo assim.', mais: true},
      {k: 'obs', label: 'Observação', type: 'textarea', full: true, mais: true}],
    onSubmit: v => {
      const m = find('machines', v.machineId); if (!m) return 'Escolha a máquina';
      if (!agaTiposDe(m).includes(v.tipo || '')) return `“${agaTipoTxt(v.tipo)}” não se aplica a ${m.name}`;
      const rep = v.rep, nRaw = rep === 'antes' ? v.nAntes : v.n, n = nRaw === '' || nRaw == null ? (rep === 'antes' ? 0 : NaN) : Number(nRaw);
      if (['nao', 'dias', 'semanas', 'meses'].includes(rep) && !v.data) return 'Informe a data';
      if (['dias', 'semanas', 'meses', 'horas'].includes(rep) && !(n >= 1)) return 'Informe de quanto em quanto tempo repete';
      if (rep === 'antes' && !(n >= 0)) return 'Informe quantos dias antes da operação';
      if (rep === 'horas' && !(Number(m.hours) > 0)) return `${m.name} não tem horímetro registrado. Lance o horímetro ou escolha repetir por dias, semanas ou meses.`;
      const lista = (Array.isArray(m.afAgenda) ? m.afAgenda : []).filter(a => a.id !== (ag?.id));
      const novo = {...(ag && !ag.legado ? ag : {}), id: ag && !ag.legado ? ag.id : uid(), tipo: v.tipo || '', rep, n: Number.isFinite(n) ? n : '', data: ['nao', 'dias', 'semanas', 'meses'].includes(rep) ? v.data : '',
        resp: String(v.resp || '').trim(), obs: String(v.obs || '').trim(), bloquear: v.bloquear === 'Sim', ativo: true,
        criadoEm: ag ? (ag.legado ? '0000-00-00' : ag.criadoEm) : today(), criadoPor: ag?.criadoPor || agaEu(), editadoEm: ag ? today() : undefined};
      if (rep === 'horas' && (!ag || ag.rep !== 'horas')) novo.baseHoras = Number(m.hours) || 0;
      if (rep !== 'horas') delete novo.baseHoras;
      if (ag && (ag.rep !== rep || ag.data !== novo.data || ag.n !== novo.n)) delete novo.adiar;
      // Mudou de máquina: tira da anterior
      if (ag && m0 && m0.id !== m.id) upsert('machines', {...m0, afAgenda: (m0.afAgenda || []).filter(a => a.id !== ag.id), ...(ag.legado ? {reaferirDias: ''} : {})});
      upsert('machines', {...m, afAgenda: [...lista, novo], ...(ag?.legado && m0?.id === m.id ? {reaferirDias: ''} : {})});
      showToast(ag ? 'Programação salva' : 'Aferição programada'); render();
    }});
  // Trocar a máquina refaz a lista do que aferir e sugere o operador dela
  const fm = $('#f_machineId', dialog), ft = $('#f_tipo', dialog), fr = $('#f_resp', dialog);
  fm?.addEventListener('change', () => {
    const atual = ft.value;
    ft.innerHTML = tipoOpts(fm.value).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if ([...ft.options].some(o => o.value === atual)) ft.value = atual;
    if (fr && !fr.value) fr.value = agaOperadorDe(find('machines', fm.value));
  });
}
// Quem mais opera a máquina (últimas operações)
function agaOperadorDe(m) {
  if (!m) return '';
  const c = {};
  db.operations.filter(o => agaUsa(o, m) && o.operator).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20).forEach(o => { c[o.operator] = (c[o.operator] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
const agaEu = () => (typeof agEuNome === 'function' && agEuNome()) || db.settings.owner || '';
const agaAchar = arg => { const [mid, aid] = String(arg).split('|'); const m = find('machines', mid); return {m, ag: m ? agaAgendas(m).find(a => a.id === aid) : null}; };

Object.assign(ACTIONS, {
  'aga-nova': id => agaForm(id || ''),
  'aga-editar': arg => { const {m, ag} = agaAchar(arg); if (ag) agaForm(m.id, ag.id); },
  'aga-aferir': arg => {
    const [mid, tipo] = String(arg).split('|');
    if (tipo === 'inspecao' && typeof novaInspecao === 'function') return novaInspecao(mid);
    novoWizard(mid, tipo || '');
  },
  'aga-adiar': arg => {
    const {m, ag} = agaAchar(arg); if (!ag || !agaGestor()) return;
    const o = agaOcorrencia(m, ag); if (!o.venc) return;
    const base = o.adiado ? o.adiado.venc : o.venc;
    openForm({title: 'Adiar aferição', sub: `${m.name} — ${agaTipoTxt(ag.tipo)}. Estava para ${fmtDate(base)}. A repetição continua igual depois desta vez.`, submit: 'Adiar',
      values: {para: addDias(o.venc < today() ? today() : o.venc, 7), motivo: ''}, fields: [
        {k: 'para', label: 'Nova data', type: 'date', required: true}, {k: 'motivo', label: 'Motivo', required: true, full: true, placeholder: 'Ex.: máquina na oficina, chuva'}],
      onSubmit: v => {
        if (!v.para || v.para < today()) return 'Escolha uma data a partir de hoje';
        if (!String(v.motivo || '').trim()) return 'Informe o motivo';
        upsert('machines', {...m, afAgenda: (m.afAgenda || []).map(a => a.id === ag.id ? {...a, adiar: {venc: base, para: v.para, motivo: String(v.motivo).trim(), por: agaEu(), em: today()}} : a)});
        showToast('Aferição adiada'); render();
      }});
  },
  'aga-cancelar': arg => {
    const {m, ag} = agaAchar(arg); if (!ag || !agaGestor()) return;
    openForm({title: 'Cancelar a programação', sub: `${m.name} — ${agaTipoTxt(ag.tipo)} (${agaRepTxt(ag, m).toLowerCase()}). As aferições já feitas continuam no histórico.`, submit: 'Cancelar a programação',
      values: {motivo: ''}, fields: [{k: 'motivo', label: 'Motivo (opcional)', full: true}],
      onSubmit: v => {
        upsert('machines', {...m, afAgenda: (m.afAgenda || []).map(a => a.id === ag.id ? {...a, ativo: false, canceladoEm: today(), canceladoPor: agaEu(), motivoCancel: String(v.motivo || '').trim()} : a)});
        showToast('Programação cancelada'); render();
      }});
  },
  'aga-sug-prog': i => { const x = agaSugAtual[Number(i)]; if (x) agaForm(x.m.id, '', x.pre); },
  'aga-sug-disp': i => {
    const x = agaSugAtual[Number(i)]; if (!x) return;
    upsert('machines', {...x.m, afDispensa: {...(x.m.afDispensa || {}), [x.chave]: today()}});
    showToast('Sugestão dispensada'); render();
  }
});

// ---------- Alertas e Início ----------
const agaAlertasBase = alerts;
alerts = function () {
  const lista = agaAlertasBase();
  for (const o of agaLista()) {
    if (!['atrasada', 'hoje', 'semana'].includes(o.status)) continue;
    lista.push({color: o.status === 'atrasada' ? 'red' : 'orange', icon: '◎', title: `${o.status === 'atrasada' ? 'Aferição atrasada' : 'Aferição programada'}: ${o.m.name}`,
      text: `${agaTipoTxt(o.ag.tipo)} — ${o.quando}${o.ag.resp ? ` • Resp.: ${o.ag.resp}` : ''}${o.nota ? ` • ${o.nota}` : ''}`, route: 'afericao'});
  }
  if (agaGestor()) { const n = agaSugestoes().length; if (n) lista.push({color: 'blue', icon: '💡', title: `${n} ${n === 1 ? 'sugestão' : 'sugestões'} de aferição`, text: 'Máquinas sem programação, operação programada sem aferição ou resultado fora. Você decide se programa.', route: 'afericao'}); }
  return lista;
};
