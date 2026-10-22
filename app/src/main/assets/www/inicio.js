'use strict';
/* MercaPlant — tela inicial para começar o dia: clima do dia (com “Detalhar no MercaClima”) e as operações
   em andamento e programadas, pendências urgentes e (fazenda começando) os passos de cadastro. Os demais avisos e pendências (estoque, contas, revisões…) ficam no sino → tela “Avisos”. */

const INI_PROXIMOS_DIAS = 7, INI_MAX_PROXIMAS = 6;
const iniPode = r => typeof nvPodeRota !== 'function' || nvPodeRota(r);
const iniHora = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };
const iniDuracao = iso => {
  const min = iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : NaN; if (!(min >= 0)) return '';
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
};
const iniDia = data => {
  const t = today(); if (data === t) return 'hoje';
  const am = new Date(t + 'T12:00:00'); am.setDate(am.getDate() + 1);
  if (data === isoLocal(am)) return 'amanhã';
  return new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit'}).replace('.', '');
};
// Chuva prevista no dia da operação (pela previsão guardada): “🌧 chuva das 15h até 19h”
function iniChuvaNoDia(data) {
  if (typeof lerClima !== 'function' || typeof horariosChuva !== 'function') return '';
  const f = horariosChuva(lerClima()?.dados, data); if (!f.length) return '';
  return `<span class="chip orange ini-chuva">🌧 chuva ${esc(txtFaixa(f[0]).replace(/,.*$/, ''))}</span>`;
}

function iniLinhaOp(o, tipo) {
  const t = today(), detalhes = [];
  if (tipo === 'andamento') detalhes.push(`desde ${iniHora(o.startedAt) || o.time || '—'}${o.startedAt ? ` (${iniDuracao(o.startedAt)})` : ''}`);
  else if (tipo === 'atrasada') detalhes.push(`era para ${fmtDate(o.date)}${o.time ? ' ' + o.time : ''}`);
  else detalhes.push(`${iniDia(o.date)}${o.time ? ' ' + o.time : ''}`);
  if (o.machineId) detalhes.push(machineName(o.machineId));
  if (o.operator) detalhes.push(o.operator);
  if (Number(o.area) > 0) detalhes.push(`${num(o.area)} ha`);
  const cor = tipo === 'andamento' ? 'green' : tipo === 'atrasada' ? 'red' : 'blue';
  const acao = tipo === 'andamento' ? mini('✓ Concluir', 'op-done', o.id, 'ok') : o.date <= t ? mini('▶ Iniciar', 'op-start', o.id) : '';
  const chuva = tipo !== 'andamento' ? iniChuvaNoDia(o.date < t ? t : o.date) : iniChuvaNoDia(t);
  return `<div class="ini-op"><span class="ini-barra ${cor}" aria-hidden="true"></span>
    <div><strong>${esc(o.type)} — ${esc(opPlace(o))}</strong><small>${esc(detalhes.filter(Boolean).join(' • '))}</small>${chuva}</div>
    <div class="row-actions">${acao}</div></div>`;
}

function painelOperacoesDia() {
  const t = today(), fimJanela = (() => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() + INI_PROXIMOS_DIAS); return isoLocal(d); })();
  const ops = db.operations, porData = (a, b) => String(a.date || '').localeCompare(b.date || '') || String(a.time || '').localeCompare(b.time || '');
  const andamento = ops.filter(o => o.status === 'Em andamento').sort((a, b) => String(a.startedAt || '').localeCompare(b.startedAt || ''));
  const atrasadas = ops.filter(o => o.status === 'Programada' && o.date && o.date < t).sort(porData);
  const hoje = ops.filter(o => o.status === 'Programada' && o.date === t).sort(porData);
  const proximas = ops.filter(o => o.status === 'Programada' && o.date > t && o.date <= fimJanela).sort(porData);
  const concluidasHoje = ops.filter(o => o.status === 'Concluída' && (String(o.finishedAt || '').slice(0, 10) === t || (!o.finishedAt && o.date === t))).length;
  const grupo = (titulo, lista, tipo, extra = '') => lista.length ? `<h4 class="ini-grupo ${tipo}">${titulo} <span>${lista.length}</span></h4>${lista.map(o => iniLinhaOp(o, tipo)).join('')}${extra}` : '';
  const prox = proximas.slice(0, INI_MAX_PROXIMAS), sobra = proximas.length - prox.length;
  const nada = !andamento.length && !atrasadas.length && !hoje.length && !proximas.length;
  const resumo = [andamento.length ? `${andamento.length} em andamento` : '', hoje.length ? `${hoje.length} para hoje` : '', atrasadas.length ? `${atrasadas.length} ${atrasadas.length === 1 ? 'atrasada' : 'atrasadas'}` : '', concluidasHoje ? `${concluidasHoje} ${concluidasHoje === 1 ? 'concluída' : 'concluídas'} hoje` : ''].filter(Boolean).join(' • ');
  const semCadastro = !db.fields.length && !db.machines.length;
  return `<section class="card panel ini-card ini-ops" id="iniOps">
    <div class="ini-ops-topo"><div><h3>Operações</h3><small>${esc(resumo || 'Nada em andamento')}</small></div>
      <div class="btn-row">${btn('Ver todas', 'nav', 'operacoes', 'secondary')}${nada ? '' : btn('+ Programar', 'op-new')}</div></div>
    ${nada ? iniVazio('🚜', 'Nenhuma operação para hoje', semCadastro ? 'Depois de cadastrar talhões e máquinas, programe aqui o trabalho do dia.' : `Nada em andamento nem programado para os próximos ${INI_PROXIMOS_DIAS} dias.`, {act: 'op-new', label: '+ Programar operação'}) : ''}
    ${grupo('Em andamento', andamento, 'andamento')}
    ${grupo('Atrasadas', atrasadas, 'atrasada')}
    ${grupo('Programadas para hoje', hoje, 'hoje')}
    ${grupo(`Próximos ${INI_PROXIMOS_DIAS} dias`, prox, 'proxima', sobra > 0 ? `<button class="link ini-mais" data-act="nav" data-id="operacoes">+ ${sobra} ${sobra === 1 ? 'programada' : 'programadas'} — ver todas</button>` : '')}
  </section>`;
}

// Vazio agradável: ícone, frase curta e uma ação
const iniVazio = (icone, titulo, texto, acao) => `<div class="ini-vazio"><span class="ini-vazio-ic" aria-hidden="true">${icone}</span><strong>${esc(titulo)}</strong><small>${esc(texto)}</small>${acao ? `<button type="button" class="${acao.cls || 'primary'}" data-act="${acao.act}"${acao.id ? ` data-id="${esc(acao.id)}"` : ''}>${esc(acao.label)}</button>` : ''}</div>`;

// Saudação: “Bom dia, Edson” + fazenda e data
function iniSaudacao() {
  const h = new Date().getHours(), oi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const usu = typeof nv !== 'undefined' ? nv?.sessao?.usuario : '', nomeNuvem = usu && nv?.nomes?.[usu];
  const nome = String(nomeNuvem || db.settings.owner || '').trim().split(/\s+/)[0];
  const fazenda = (typeof nv !== 'undefined' && nv?.fazenda?.name) || db.settings.farm || '';
  const data = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'});
  return `<header class="ini-saud"><h2>${esc(oi)}${nome && !nome.includes('@') ? ', ' + esc(nome) : ''}</h2><p>${esc([fazenda, data].filter(Boolean).join(' • '))}</p></header>`;
}

// Clima em destaque: temperatura de agora, condição, chuva/umidade/vento, horário para pulverizar e próxima chuva
function iniClima() {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, c = typeof lerClima === 'function' ? lerClima() : null;
  const h = c?.dados?.hourly, d = c?.dados?.daily;
  if (!loc || !h?.time || !d?.time) return `<div class="ini-clima">${typeof cartaoClima === 'function' ? cartaoClima() : ''}</div>`;
  const t = today(), hora = new Date().getHours(), i = Math.max(0, h.time.indexOf(`${t}T${String(hora).padStart(2, '0')}:00`)), i0 = Math.max(0, d.time.indexOf(t));
  const temp = h.temperature_2m?.[i], ur = h.relative_humidity_2m?.[i], vento = h.wind_speed_10m?.[i], nuvem = h.cloud_cover?.[i] ?? 0, mm = h.precipitation?.[i] || 0;
  const noite = hora < 6 || hora >= 19, trov = (h.trovoada?.[i] || 0) >= 0.5;
  const [ic, cond] = trov ? ['⛈️', 'Trovoada'] : mm >= 0.3 ? ['🌧️', 'Chuva'] : nuvem >= 80 ? ['☁️', 'Nublado'] : nuvem >= 35 ? [noite ? '☁️' : '⛅', 'Parcialmente nublado'] : [noite ? '🌙' : '☀️', noite ? 'Céu limpo' : 'Ensolarado'];
  const chuvaProb = Math.round(d.precipitation_probability_max?.[i0] ?? 0);
  const jan = typeof janelasDoDia === 'function' ? janelasDoDia(c.dados, d.time[i0]) : {janelas: []};
  const ch = typeof horariosChuva === 'function' ? horariosChuva(c.dados, t) : [];
  const prox = ch.length ? (ch[0].agora ? 'chovendo agora' : `chuva às ${hh2(ch[0].ini)}`) : (() => { const k = d.precipitation_sum.findIndex((x, j) => j > i0 && x >= 1); return k > 0 ? `chuva ${typeof nomeDiaCurto === 'function' ? nomeDiaCurto(d.time[k]) : fmtDate(d.time[k])}` : 'sem chuva prevista'; })();
  const pulv = jan.janelas.length ? 'Pulverizar ' + jan.janelas.map(([x, y]) => `${hh(x)}–${hh(y)}`).join(', ') : 'Sem janela para pulverizar';
  const fazenda = (typeof nv !== 'undefined' && nv?.fazenda?.name) || db.settings.farm || 'Fazenda';
  return `<section class="card ini-clima ini-clima-hero" id="hojeClima">
    <div class="ini-clima-local">📍 ${esc(fazenda)} <span>Hoje ${Math.round(d.temperature_2m_max[i0])}° / ${Math.round(d.temperature_2m_min[i0])}°</span></div>
    <div class="ini-clima-agora"><span class="ini-clima-ic" aria-hidden="true">${ic}</span><div><b>${temp != null ? Math.round(temp) + '°' : '—'}</b><span>${esc(cond)}</span></div></div>
    <div class="ini-clima-met"><div><small>Chuva</small><b>${chuvaProb}%</b></div><div><small>Umidade</small><b>${ur != null ? Math.round(ur) + '%' : '—'}</b></div><div><small>Vento</small><b>${vento != null ? Math.round(vento) + ' km/h' : '—'}</b></div></div>
    <div class="ini-clima-rodape"><small class="${jan.janelas.length ? 'ok' : 'nao'}">${esc(pulv)} • ${esc(prox)}</small>
      <button type="button" class="secondary" data-act="nav" data-id="clima">Detalhar no MercaClima ›</button></div></section>`;
}

// Atenção no campo: alertas do clima que atrapalham operações + pendências urgentes (vermelho e revisão vencida)
function iniAtencao() {
  const todos = typeof alerts === 'function' ? alerts() : [];
  const lista = todos.filter(a => !/^Operação atrasada/.test(a.title) && (a.color === 'red' || /^Revisão vencida/.test(a.title)));
  const riscos = typeof riscosClima === 'function' && typeof htmlRiscos === 'function' ? riscosClima() : [];
  const linha = a => `<button type="button" class="ini-urg ${a.color === 'red' ? 'red' : 'orange'}" data-act="nav" data-id="${esc(a.route || 'avisos')}"><span class="ini-urg-ic" aria-hidden="true">${esc(a.icon || '!')}</span><span><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small></span><span class="hoje-ir" aria-hidden="true">›</span></button>`;
  const nada = !lista.length && !riscos.length;
  return `<section class="ini-bloco ini-atencao"><h3 class="ini-tit">Atenção no campo</h3>
    <div id="climaRiscos">${riscos.length ? htmlRiscos(riscos) : ''}</div>
    ${lista.slice(0, Math.max(1, 3 - riscos.length)).map(linha).join('')}
    <div class="card ini-ok" ${nada ? '' : 'hidden'}><span class="ini-urg-ic" aria-hidden="true">✓</span><span><strong>Tudo em dia</strong><small>Nenhum alerta do clima nem pendência urgente.</small></span></div>
    ${todos.length ? `<button type="button" class="link ini-mais" data-act="nav" data-id="avisos">Ver todos os avisos (${todos.length}) ›</button>` : ''}</section>`;
}

// Resumo de hoje (celular): dois números grandes
function iniResumo() {
  const t = today(), ops = db.operations;
  const and = ops.filter(o => o.status === 'Em andamento'), hoje = ops.filter(o => o.status === 'Programada' && o.date === t), atr = ops.filter(o => o.status === 'Programada' && o.date && o.date < t);
  const tile = (ic, rot, n, sub, cls = '') => `<button type="button" class="card ini-tile" data-act="nav" data-id="operacoes"><span class="ini-tile-ic" aria-hidden="true">${iconeLinha(ic, 24)}</span><span><small>${rot}</small><b>${String(n).padStart(2, '0')}</b><em class="${cls}">${esc(sub)}</em></span><span class="hoje-ir" aria-hidden="true">›</span></button>`;
  return `<section class="ini-bloco ini-resumo so-celular"><h3 class="ini-tit">Resumo de hoje</h3><div class="ini-tiles">
    ${tile('operacoes', 'Em andamento', and.length, and.length ? 'rodando agora' : 'nada rodando')}
    ${tile('lista', 'Para hoje', hoje.length + atr.length, atr.length ? `${atr.length} ${atr.length === 1 ? 'atrasada' : 'atrasadas'}` : 'nenhuma atrasada', atr.length ? 'nao' : '')}</div></section>`;
}

// Operações do dia (celular): só as 3 mais importantes — em andamento, atrasadas e de hoje
function iniOpsCurtas() {
  const t = today(), ops = db.operations, porData = (a, b) => String(a.date || '').localeCompare(b.date || '') || String(a.time || '').localeCompare(b.time || '');
  const lista = [...ops.filter(o => o.status === 'Em andamento').map(o => [o, 'andamento']), ...ops.filter(o => o.status === 'Programada' && o.date && o.date < t).sort(porData).map(o => [o, 'atrasada']), ...ops.filter(o => o.status === 'Programada' && o.date === t).sort(porData).map(o => [o, 'hoje'])];
  const corpo = lista.length ? `<div class="card ini-card">${lista.slice(0, 3).map(([o, tipo]) => iniLinhaOp(o, tipo)).join('')}${lista.length > 3 ? `<button type="button" class="link ini-mais" data-act="nav" data-id="operacoes">Ver todas (${lista.length}) ›</button>` : ''}</div>`
    : `<div class="card ini-card">${iniVazio('🚜', 'Nenhuma operação para hoje', 'Programe aqui o trabalho do dia.', {act: 'op-new', label: '+ Programar operação'})}</div>`;
  return `<section class="ini-bloco ini-opscurtas so-celular"><div class="ini-tit-linha"><h3 class="ini-tit">Operações do dia</h3>${lista.length ? '<button type="button" class="link" data-act="op-new">+ Programar</button>' : ''}</div>${corpo}</section>`;
}

// Acesso rápido (celular): 4 atalhos conforme a função
function iniAcesso() {
  const itens = [['operacoes', 'Operações'], ['maquinas', 'Manutenção'], ['clima', 'MercaClima'], ['relatorios', 'Relatórios'], ['graos', 'Grãos'], ['estoque', 'Estoque']].filter(([r]) => iniPode(r)).slice(0, 4);
  if (!itens.length) return '';
  return `<section class="ini-bloco ini-acesso so-ate-tablet"><h3 class="ini-tit">Acesso rápido</h3><div class="ini-tiles">${itens.map(([r, rot]) => `<button type="button" class="card ini-tile ini-atalho" data-act="nav" data-id="${r}"><span class="ini-tile-ic" aria-hidden="true">${iconeLinha(r, 24)}</span><strong>${rot}</strong><span class="hoje-ir" aria-hidden="true">›</span></button>`).join('')}</div></section>`;
}
ACTIONS['ini-lancar'] = () => { if (typeof abrirAtalhos === 'function') abrirAtalhos(); else ACTIONS['op-new']?.(); };

// Fazenda começando: passos que faltam (somem sozinhos quando cadastrados)
function iniPreparar() {
  const passos = [
    ['fields', 'Talhões', 'Nome, área e cultura — base das operações', 'fd-new', '+ Talhão', 'talhoes'],
    ['machines', 'Máquinas', 'Horímetro, revisões e combustível', 'mc-new', '+ Máquina', 'maquinas'],
    ['stock', 'Estoque de insumos', 'Sementes, adubos e defensivos com o saldo de hoje', 'st-new', '+ Insumo', 'estoque']
  ].filter(p => iniPode(p[5]));
  const feitos = passos.filter(p => db[p[0]].length).length;
  if (!passos.length || feitos === passos.length) return '';
  return `<section class="card panel ini-card ini-preparar"><div class="ini-ops-topo"><div><h3>Prepare a fazenda</h3><small>${feitos} de ${passos.length} prontos</small></div></div>
    <div class="ini-prog"><span style="width:${Math.round(feitos / passos.length * 100)}%"></span></div>
    ${passos.map(([c, tit, txt, act, rot, rota], i) => { const ok = db[c].length > 0; return `<div class="ini-passo ${ok ? 'feito' : ''}"><span class="ini-passo-n" aria-hidden="true">${ok ? '✓' : i + 1}</span><span><strong>${esc(tit)}</strong><small>${ok ? `${db[c].length} ${db[c].length === 1 ? 'cadastrado' : 'cadastrados'}` : esc(txt)}</small></span>${ok ? `<button type="button" class="secondary" data-act="nav" data-id="${rota}">Ver</button>` : `<button type="button" class="primary" data-act="${act}">${esc(rot)}</button>`}</div>`; }).join('')}</section>`;
}

// Quem não usa Operações (ex.: só grãos ou estoque): atalhos para as telas a que tem acesso
function iniAtalhosFuncao() {
  const bts = [...document.querySelectorAll('.sidebar .nav button[data-route]')].filter(b => !b.hidden && b.dataset.route !== 'inicio' && iniPode(b.dataset.route)).slice(0, 8);
  if (!bts.length) return '';
  return `<section class="card panel ini-card ini-ops"><h3>Suas telas</h3><div class="ini-atalhos">${bts.map(b => `<button type="button" class="secondary" data-act="nav" data-id="${esc(b.dataset.route)}">${esc(b.textContent.trim())}</button>`).join('')}</div></section>`;
}

// ---------- Tablet e computador ----------
const iniVeFin = () => typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
const iniHoraOp = o => o.status === 'Em andamento' ? (iniHora(o.startedAt) || o.time || '') : (o.time || '');

// Indicadores: em andamento, para hoje, máquinas e gastos do mês (só para quem vê o financeiro; senão, chuva em 7 dias)
function iniKpis() {
  const t = today(), ops = db.operations, ms = db.machines.filter(m => !isInactive(m));
  const and = ops.filter(o => o.status === 'Em andamento'), hoje = ops.filter(o => o.status === 'Programada' && o.date === t), atr = ops.filter(o => o.status === 'Programada' && o.date && o.date < t);
  const usoIds = new Set(and.map(o => o.machineId).filter(Boolean)), manut = ms.filter(m => machineStatus(m) === 'Em manutenção').length;
  const revProx = ms.filter(m => Number(m.nextService) > 0 && hoursToService(m) <= SERVICE_WARN_HOURS).length;
  const kpi = (ic, rot, valor, sub, rota, cls = '', subCls = '') => `<button type="button" class="card ini-kpi ${cls}" data-act="nav" data-id="${rota}"><span class="ini-tile-ic" aria-hidden="true">${iconeLinha(ic, 22)}</span><span><small>${esc(rot)}</small><b>${valor}</b><em class="${subCls}">${esc(sub)}</em></span><span class="hoje-ir" aria-hidden="true">›</span></button>`;
  let quarto;
  if (iniVeFin() && typeof lancamentosCusto === 'function') {
    const v = somaValor(lancamentosCusto(t.slice(0, 8) + '01', t));
    quarto = kpi('financeiro', 'Gastos do mês', 'R$ ' + num(v, 0), v ? `até ${fmtDate(t).slice(0, 5)}` : 'nenhum gasto lançado', 'financeiro', 'so-pc');
  } else {
    const mm = db.chuvas.filter(c => c.date >= daysAgo(6)).reduce((x, c) => x + (Number(c.mm) || 0), 0);
    quarto = kpi('chuva', 'Chuva em 7 dias', num(mm) + ' mm', 'registrada na fazenda', 'chuva', 'so-pc');
  }
  return `<section class="ini-kpis so-grande">
    ${kpi('operacoes', 'Em andamento', String(and.length).padStart(2, '0'), and.length ? 'rodando agora' : 'nada rodando', 'operacoes')}
    ${kpi('lista', 'Para hoje', String(hoje.length + atr.length).padStart(2, '0'), atr.length ? `${atr.length} ${atr.length === 1 ? 'atrasada' : 'atrasadas'}` : 'nenhuma atrasada', 'operacoes', '', atr.length ? 'nao' : '')}
    ${kpi('maquinas', 'Máquinas', String(ms.length).padStart(2, '0'), ms.length ? [`${usoIds.size} em uso`, manut ? `${manut} em manutenção` : '', revProx ? `${revProx} com revisão próxima` : ''].filter(Boolean).join(' • ') : 'nenhuma cadastrada', 'maquinas', 'so-pc', manut || revProx ? 'atencao' : '')}
    ${quarto}</section>`;
}

// Agenda de hoje: em andamento, atrasadas e programadas para hoje, por horário
function iniAgenda() {
  const t = today(), ops = db.operations;
  const itens = [...ops.filter(o => o.status === 'Em andamento').map(o => [o, 'andamento']), ...ops.filter(o => o.status === 'Programada' && o.date && o.date < t).map(o => [o, 'atrasada']), ...ops.filter(o => o.status === 'Programada' && o.date === t).map(o => [o, 'hoje'])]
    .sort((a, b) => ['andamento', 'atrasada', 'hoje'].indexOf(a[1]) - ['andamento', 'atrasada', 'hoje'].indexOf(b[1]) || String(iniHoraOp(a[0])).localeCompare(iniHoraOp(b[0])));
  const linha = ([o, tipo]) => `<div class="ini-ag"><span class="ini-ag-ponto ${tipo}" aria-hidden="true"></span><b>${esc((iniHoraOp(o) || '—').replace(/:00$/, 'h'))}</b>
    <span><strong>${esc(o.type)} — ${esc(opPlace(o))}</strong><small>${tipo === 'andamento' ? 'em andamento' : tipo === 'atrasada' ? `atrasada (era ${fmtDate(o.date).slice(0, 5)})` : esc(o.machineId ? machineName(o.machineId) : 'programada')}</small></span>
    ${tipo === 'andamento' ? mini('✓ Concluir', 'op-done', o.id, 'ok') : mini('▶ Iniciar', 'op-start', o.id)}</div>`;
  return `<section class="card ini-card ini-agenda so-grande"><div class="ini-tit-linha"><h3 class="ini-tit">${iconeLinha('lista', 18)} Agenda de hoje</h3><button type="button" class="link" data-act="nav" data-id="operacoes">Ver todas ›</button></div>
    ${itens.length ? itens.slice(0, 5).map(linha).join('') + (itens.length > 5 ? `<button type="button" class="link ini-mais" data-act="nav" data-id="operacoes">+ ${itens.length - 5} — ver todas</button>` : '') : iniVazio('📅', 'Nada na agenda de hoje', 'As operações programadas para hoje aparecem aqui.', {act: 'op-new', label: '+ Programar operação', cls: 'secondary'})}</section>`;
}

// Gastos do mês por categoria (computador; só para quem vê o financeiro)
function iniGastos() {
  if (!iniVeFin() || typeof lancamentosCusto !== 'function') return '';
  const t = today(), lanc = lancamentosCusto(t.slice(0, 8) + '01', t), grupos = agrupar(lanc, x => x.category || 'Outros');
  const linhas = grupos.length > 4 ? [...grupos.slice(0, 3), ['Outras', grupos.slice(3).reduce((s, [, v]) => s + v, 0)]] : grupos, max = Math.max(1, ...linhas.map(([, v]) => v));
  const curto = v => v >= 1000 ? `R$ ${num(v / 1000, v >= 10000 ? 0 : 1)} mil` : `R$ ${num(v, 0)}`;
  return `<section class="card ini-card ini-gastos so-pc"><div class="ini-tit-linha"><h3 class="ini-tit">${iconeLinha('financeiro', 18)} Gastos por categoria</h3><button type="button" class="link" data-act="nav" data-id="financeiro">Financeiro ›</button></div>
    ${linhas.length ? `<div class="ini-barras" role="img" aria-label="Gastos do mês por categoria">${linhas.map(([n, v]) => `<div class="ini-barra-col" title="${esc(n)}: R$ ${num(v, 2)}"><b>${curto(v)}</b><span style="height:${Math.max(4, v / max * 100)}%"></span><small>${esc(n)}</small></div>`).join('')}</div><small class="ini-nota">Mês atual • total R$ ${num(somaValor(lanc), 0)}</small>`
      : iniVazio('📊', 'Nenhum gasto neste mês', 'Combustível, manutenção e insumos lançados aparecem aqui por categoria.')}</section>`;
}

// Operações (computador): tabela com em andamento, programadas e concluídas recentes
function iniTabelaOps() {
  const t = today(), ops = db.operations;
  const lista = [...ops.filter(o => o.status === 'Em andamento'), ...ops.filter(o => o.status === 'Programada' && o.date && o.date <= t).sort((a, b) => String(a.date).localeCompare(b.date)),
    ...ops.filter(o => o.status === 'Programada' && o.date > t).sort((a, b) => String(a.date).localeCompare(b.date)).slice(0, 3),
    ...ops.filter(o => o.status === 'Concluída').sort((a, b) => String(b.finishedAt || b.date).localeCompare(a.finishedAt || a.date)).slice(0, 3)].slice(0, 7);
  const sit = o => o.status === 'Em andamento' ? ['blue', 'Em andamento'] : o.status === 'Concluída' ? ['green', 'Concluída'] : o.date < t ? ['red', 'Atrasada'] : ['orange', o.date === t ? 'Programada hoje' : 'Programada'];
  return `<section class="card ini-card ini-tabela so-pc"><div class="ini-tit-linha"><h3 class="ini-tit">${iconeLinha('operacoes', 18)} Operações</h3><div class="btn-row"><button type="button" class="link" data-act="op-new">+ Programar</button><button type="button" class="link" data-act="nav" data-id="operacoes">Ver todas ›</button></div></div>
    ${lista.length ? `<table class="ini-tab"><thead><tr><th>Operação</th><th>Talhão / local</th><th>Data</th><th>Máquina</th><th>Situação</th></tr></thead><tbody>${lista.map(o => { const [cor, txt] = sit(o); return `<tr data-act="nav" data-id="operacoes"><td>${esc(o.type)}</td><td>${esc(opPlace(o))}</td><td>${fmtDate(o.date).slice(0, 5)}${o.time ? ' ' + esc(o.time) : ''}</td><td>${esc(o.machineId ? machineName(o.machineId) : '—')}</td><td><span class="ini-sit ${cor}"></span>${txt}</td></tr>`; }).join('')}</tbody></table>`
      : iniVazio('🚜', 'Nenhuma operação ainda', 'Programe as operações e acompanhe aqui o andamento.', {act: 'op-new', label: '+ Programar operação'})}</section>`;
}

const inicioDepois = VIEWS.inicio.after;
// Celular: saudação, clima, resumo, operações do dia, acesso rápido, atenção no campo, novo lançamento (aprovado em 21/10).
// Tablet: clima e acesso rápido à esquerda; indicadores, agenda, atenção e novo lançamento à direita.
// Computador: indicadores; clima, gastos e agenda; tabela de operações e atenção no campo.
VIEWS.inicio = () => {
  const ops = iniPode('operacoes'), gastos = iniGastos();
  return `<div class="ini ${gastos ? '' : 'sem-fin'} ${ops ? '' : 'sem-ops'}">
    <header class="ini-topo">${iniSaudacao()}<button type="button" class="primary ini-lancar-pc so-pc" data-act="ini-lancar">${iconeLinha('mais', 20)} Novo lançamento</button></header>
    ${ops ? iniKpis() : ''}${iniClima()}${gastos}${ops ? iniAgenda() : ''}
    ${ops ? iniResumo() + iniOpsCurtas() + iniTabelaOps() : `<div class="ini-bloco ini-suas">${iniAtalhosFuncao()}</div>`}
    ${ops ? iniAcesso() : ''}
    ${iniAtencao()}<div class="ini-prep">${iniPreparar()}</div>
    <button type="button" class="primary ini-lancar so-ate-tablet" data-act="ini-lancar">${iconeLinha('mais', 22)} Novo lançamento</button></div>`;
};
VIEWS.inicio.after = (...a) => {
  inicioDepois?.(...a);
  // O aviso de tempestade chega depois (REDEMET): quando aparece, some o “Tudo em dia”
  const box = document.getElementById('climaRiscos'), ok = document.querySelector('.ini-atencao .ini-ok');
  if (box && ok) new MutationObserver(() => { if (box.children.length) ok.hidden = true; }).observe(box, {childList: true});
};

// ---------- Avisos e pendências (o sino): o que antes ficava no “Hoje” da tela inicial ----------
VIEWS.avisos = () => {
  if (typeof painelHoje !== 'function') return head('Avisos', '') + `<section class="card">${empty('Tudo em dia', 'Nenhum aviso.')}</section>`;
  safeStorage.set('agro-hoje-aberto', '1');
  const clima = cartaoClima, resumo = resumoDia;
  cartaoClima = () => ''; resumoDia = () => ''; // só a lista de pendências
  try { return head('Avisos e pendências', 'Estoque, contas, revisões, aferições, chuva para registrar e o que mais precisa de atenção', btn('← Início', 'nav', 'inicio', 'secondary')) + painelHoje(); }
  finally { cartaoClima = clima; resumoDia = resumo; }
};
TITLES.avisos = 'Avisos e pendências';
$('#bellBtn').onclick = () => go('avisos');
