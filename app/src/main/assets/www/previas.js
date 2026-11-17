'use strict';
/* MercaPlant — telas no padrão das prévias aprovadas (out/2026), etapa 2: Início e Operações.
   Muda só a organização e a aparência; as ações continuam as mesmas (Iniciar, Concluir, Editar, Excluir, Conferência).
   Logo (globo) e ícones em hexágono mantidos, como decidido. */

// ---------- Peças comuns ----------
const PV_GLIFOS = {
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/>',
  seta: '<path d="M9 5.5 15.5 12 9 18.5"/>',
  broto: '<path d="M12 21v-8.5"/><path d="M12 12.5C12 8.4 9.2 5.8 5 5.8c0 4.1 2.8 6.7 7 6.7zM12 14.5c0-3.7 2.6-6.2 6.8-6.2 0 3.7-2.6 6.2-6.8 6.2z"/><path d="M8 21h8"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'
};
const pvGlifo = nome => PV_GLIFOS[nome] || (typeof ICONES_EXTRA !== 'undefined' && ICONES_EXTRA[nome]) || (window.ICONES_MENU?.[nome] || [])[1] || '';
// Ícone no hexágono, o mesmo desenho do menu e da abertura
function pvHex(nome, cor = 'verde', tam = 44) {
  const d = pvGlifo(nome); if (!d) return '';
  return `<svg class="hex-icone pv-hex ${cor}" width="${tam}" height="${tam}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><polygon class="hex" points="9,3 23,3 30,16 23,29 9,29 2,16"/><g class="glifo" transform="translate(6.4 6.4) scale(.8)">${d}</g></svg>`;
}
const pvSeta = () => `<svg class="pv-seta" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PV_GLIFOS.seta}</svg>`;
// Ícone conforme o tipo da operação
function pvIconeOp(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (/tratamento de semente/.test(t)) return 'frasco';
  if (/aplica|pulveriz|desseca|fungic|herbic|inseti/.test(t)) return 'aplicacoes';
  if (/colheit/.test(t)) return 'espiga';
  if (/plantio|semeadura|replantio/.test(t)) return 'broto';
  if (/transporte|frete|carga/.test(t)) return 'catalogo';
  if (/preparo|grade|subsol|escarif|aduba|calc|gesso|ro[çc]ada/.test(t)) return 'talhoes';
  return 'operacoes';
}
// Situação da operação: selo e cor
function pvSituacao(o) {
  if (o.status === 'Em andamento') return ['andamento', 'Em andamento'];
  if (o.status === 'Concluída') return ['concluida', 'Concluída'];
  if (o.status === 'Cancelada') return ['cancelada', 'Cancelada'];
  if (o.status === 'Programada' && o.date && o.date < today()) return ['atrasada', 'Atrasada'];
  return ['programada', o.status || 'Programada'];
}
const pvSelo = o => { const [c, t] = pvSituacao(o); return `<span class="pv-selo ${c}">${esc(t)}</span>`; };
const pvResp = o => o.operator || (typeof quemLancou === 'function' ? quemLancou(o) : '') || '';
const pvVeConferencia = () => typeof confGestor === 'function' && confGestor();
// Quando: “hoje 07:10”, “amanhã, 07:00”, “qui 20/11”
function pvQuando(o) {
  if (o.status === 'Em andamento') { const h = typeof iniHora === 'function' ? iniHora(o.startedAt) : ''; return `desde ${h || o.time || '—'}`; }
  const dia = typeof iniDia === 'function' ? iniDia(o.date) : fmtDate(o.date);
  return `${dia ? dia.charAt(0).toUpperCase() + dia.slice(1) : '—'}${o.time ? ', ' + o.time : ''}`;
}
// Ação principal: um só botão grande, como nas prévias
function pvAcao(o, rotulos = {}) {
  if (o.status === 'Programada') return `<button type="button" class="primary pv-acao" data-act="op-start" data-id="${esc(o.id)}">${esc(rotulos.iniciar || 'Iniciar')}${pvSeta()}</button>`;
  if (o.status === 'Em andamento') return `<button type="button" class="primary pv-acao" data-act="op-done" data-id="${esc(o.id)}">${esc(rotulos.concluir || 'Concluir')}${pvSeta()}</button>`;
  if (o.status === 'Concluída') return `<button type="button" class="secondary pv-acao pv-acao-ver" data-act="${pvVeConferencia() ? 'conf-ver' : 'op-edit'}" data-id="${esc(o.id)}">${esc(rotulos.ver || 'Ver resultado')}${pvSeta()}</button>`;
  return '';
}

// ---------- Operações ----------
let pvOpSel = '';
const PV_FILTROS = () => {
  const t = today();
  return {hoje: ['Hoje', o => o.date === t || o.status === 'Em andamento'], abertas: ['Em aberto', o => o.status === 'Programada' || o.status === 'Em andamento'], concluidas: ['Concluídas', o => o.status === 'Concluída'], proximas: ['Próximas', o => o.date > t && o.status === 'Programada'], todas: ['Todas', () => true]};
};
// Hoje e Em aberto: em andamento primeiro, depois atrasadas e programadas pelo horário; Concluídas e Todas: mais recentes primeiro
function pvOrdenar(lista, filtro) {
  if (filtro === 'concluidas' || filtro === 'todas') return lista.sort(byDateDesc);
  const peso = o => o.status === 'Em andamento' ? 0 : o.status === 'Programada' && o.date < today() ? 1 : o.status === 'Programada' ? 2 : 3;
  return lista.sort((a, b) => peso(a) - peso(b) || String((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));
}
function pvMenuOp(o) {
  return `<details class="menu-mais pv-op-mais"><summary aria-label="Mais ações" title="Mais ações">⋮</summary><div class="menu-lista">
    ${mini('Editar', 'op-edit', o.id)}${o.fieldId ? mini('Histórico do talhão', 'fd-hist', o.fieldId) : ''}${o.status === 'Concluída' && pvVeConferencia() ? mini('Conferência', 'conf-ver', o.id) : ''}${mini('Excluir', 'op-del', o.id, 'del')}</div></details>`;
}
function pvLinhaOp(o, sel) {
  const area = Number(o.area) > 0 && (typeof opTemArea !== 'function' || opTemArea(o)) ? `${num(o.area)} ha` : '';
  const maq = [machineName(o.machineId), machineName(o.implementoId)].filter(Boolean).join(' + ');
  const sub = [opPlace(o), pvResp(o) || maq].filter(Boolean).join(' • ');
  const quando = [pvQuando(o), pvResp(o) ? maq : '', area].filter(Boolean).join(' • ');
  const selos = typeof confSelos === 'function' ? confSelos(o) : '';
  const busca = [o.type, opPlace(o), pvResp(o), maq, o.notes].filter(Boolean).join(' ').toLowerCase();
  return `<article class="pv-op ${sel ? 'sel' : ''}" data-busca="${esc(busca)}" data-talhao="${esc(o.fieldId || '')}">
    <button type="button" class="pv-op-info" data-act="pv-op-sel" data-id="${esc(o.id)}" aria-label="${esc(o.type + ' — ' + opPlace(o))}">
      <span class="pv-op-ic">${pvHex(pvIconeOp(o.type), 'verde', 46)}</span>
      <span class="pv-op-txt"><strong>${esc(o.type)}</strong><small>${esc(sub)}</small><small class="pv-op-quando">${esc(quando)}</small></span>
      <span class="pv-col pv-c-talhao">${esc(opPlace(o))}</span><span class="pv-col pv-c-resp">${esc(pvResp(o) || '—')}</span>
      <span class="pv-col pv-c-data">${esc(fmtDate(o.date).slice(0, 5))}${o.time ? ' ' + esc(o.time) : ''}</span>
      <span class="pv-op-sit">${pvSelo(o)}</span><span class="pv-col pv-c-area">${esc(area || '—')}</span>
    </button>
    ${pvMenuOp(o)}
    ${selos ? `<div class="pv-op-selos">${selos}</div>` : ''}
    <div class="pv-op-acao">${pvAcao(o)}</div></article>`;
}
// Detalhe da operação escolhida (tablet e computador), à direita da lista
function pvDetalheOp(o) {
  if (!o) return `<aside class="card pv-det pv-det-vazio"><p>Escolha uma operação na lista para ver os detalhes.</p></aside>`;
  const f = o.fieldId ? find('fields', o.fieldId) : null, area = Number(o.area) > 0 ? `${num(o.area)} ha` : '';
  const horas = Number(o.km) > 0 ? `${num(o.km)} km` : Number(o.horas) > 0 ? `${um1(o.horas)} h` : '';
  const prev = typeof duracaoPrevista === 'function' ? duracaoPrevista(o) : null;
  const campos = [['Talhão / local', opPlace(o)], ['Área', area], ['Responsável', pvResp(o)], ['Máquina', machineName(o.machineId)], ['Implemento', machineName(o.implementoId)], ['Safra', f?.season || o.season || ''],
    ['Data', `${fmtDate(o.date)}${o.time ? ' ' + o.time : ''}`], ['Início', o.startedAt && typeof iniHora === 'function' ? iniHora(o.startedAt) : ''], ['Fim', o.finishedAt && typeof iniHora === 'function' ? iniHora(o.finishedAt) : ''],
    ['Trabalho', horas], ['Previsto', prev ? `~${um1(prev.horas)} h` : ''], ['Produção', Number(o.kg) > 0 ? `${num(o.kg)} kg` : ''], ['Produtos', o.produtos?.length && typeof prodResumo === 'function' ? prodResumo(o) : ''], ['Observações', o.notes]].filter(([, v]) => v);
  const selos = typeof confSelos === 'function' ? confSelos(o) : '';
  return `<aside class="card pv-det"><header><div><h3>${esc(o.type)}</h3><small>${esc(opPlace(o))}</small></div>${pvSelo(o)}</header>
    <dl class="pv-campos">${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${selos}
    <div class="pv-det-acoes">${pvAcao(o, {iniciar: 'Iniciar operação', concluir: 'Concluir operação'})}
      <div class="btn-row">${mini('Editar', 'op-edit', o.id)}${o.fieldId ? mini('Histórico do talhão', 'fd-hist', o.fieldId) : ''}${mini('Excluir', 'op-del', o.id, 'del')}</div></div></aside>`;
}
VIEWS.operacoes = () => {
  const filtros = PV_FILTROS();
  if (!filtros[opFilter]) opFilter = 'hoje';
  const lista = pvOrdenar(db.operations.filter(filtros[opFilter][1]), opFilter);
  if (!lista.some(o => o.id === pvOpSel)) pvOpSel = lista[0]?.id || '';
  const sel = lista.find(o => o.id === pvOpSel);
  const nConf = pvVeConferencia() && typeof confPendentes === 'function' ? confPendentes().length : 0;
  const botoes = (pvVeConferencia() ? btn(`✓ Conferência${nConf ? ` (${nConf})` : ''}`, 'nav', 'conferencia', 'secondary') : '') + btn('+ Nova operação', 'op-new');
  const talhoes = [...new Set(lista.map(o => o.fieldId).filter(Boolean))].map(id => find('fields', id)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}));
  return head('Operações', 'Planeje, inicie e conclua as atividades de campo.', botoes) +
    `<nav class="pv-abas" aria-label="Filtro das operações">${Object.entries(filtros).map(([k, [rot, fn]]) => { const n = db.operations.filter(fn).length; return `<button type="button" class="${k === opFilter ? 'active' : ''}" aria-pressed="${k === opFilter}" data-act="op-filter" data-id="${k}">${rot}${n ? ` <span>${n}</span>` : ''}</button>`; }).join('')}</nav>` +
    (lista.length ? `<div class="pv-ops-busca"><label class="pv-busca"><svg class="ic-linha" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">${PV_GLIFOS.busca}</svg><input id="pvBusca" type="search" placeholder="Buscar operação" aria-label="Buscar operação" autocomplete="off"></label>
      ${talhoes.length > 1 ? `<select id="pvTalhao" aria-label="Talhão"><option value="">Todos os talhões</option>${talhoes.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select>` : ''}</div>
    <div class="pv-ops"><section class="card pv-lista"><div class="pv-cab" aria-hidden="true"><span>Operação</span><span>Talhão / local</span><span>Responsável</span><span>Data</span><span>Situação</span><span>Área</span></div>
      ${lista.map(o => pvLinhaOp(o, o.id === pvOpSel)).join('')}<p class="pv-nada" hidden>Nenhuma operação encontrada.</p><small class="pv-total">${lista.length} ${lista.length === 1 ? 'operação' : 'operações'}</small></section>
      ${pvDetalheOp(sel)}</div>`
      : `<section class="card">${empty('Nenhuma operação neste filtro', '', {act: 'op-new', label: '+ Nova operação'})}</section>`);
};
const pvTelaGrande = () => matchMedia('(min-width: 900px)').matches;
ACTIONS['pv-op-sel'] = id => { if (!pvTelaGrande()) return; pvOpSel = id; render(); };
// Abrir uma operação a partir do Início: escolhe o filtro em que ela aparece e a deixa selecionada
ACTIONS['pv-op-abrir'] = id => {
  const o = find('operations', id); if (!o) return go('operacoes');
  const f = PV_FILTROS(); opFilter = f.hoje[1](o) ? 'hoje' : f.abertas[1](o) ? 'abertas' : 'todas'; pvOpSel = id; go('operacoes');
};
// Busca e talhão filtram a lista na hora, sem redesenhar a tela
function pvFiltrarOps() {
  const q = (document.getElementById('pvBusca')?.value || '').trim().toLowerCase(), t = document.getElementById('pvTalhao')?.value || '';
  let n = 0;
  document.querySelectorAll('.pv-lista .pv-op').forEach(el => { const ok = (!q || el.dataset.busca.includes(q)) && (!t || el.dataset.talhao === t); el.hidden = !ok; if (ok) n++; });
  const nada = document.querySelector('.pv-lista .pv-nada'); if (nada) nada.hidden = n > 0;
}
document.addEventListener('input', e => { if (e.target.id === 'pvBusca') pvFiltrarOps(); });
document.addEventListener('change', e => { if (e.target.id === 'pvTalhao') pvFiltrarOps(); });

// ---------- Início ----------
// Clima numa linha: temperatura, condição, horário para pulverizar e próxima chuva (toque abre o MercaClima)
function pvClima(classe = '') {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, c = typeof lerClima === 'function' ? lerClima() : null;
  const linha = (ic, tit, sub, subCls = '') => `<button type="button" class="pv-clima ${classe}" data-act="nav" data-id="clima"><span class="pv-clima-ic" aria-hidden="true">${ic}</span><span class="pv-clima-txt"><strong>${tit}</strong>${sub ? `<small class="${subCls}">${esc(sub)}</small>` : ''}</span>${pvSeta()}</button>`;
  if (!loc) return linha('📍', 'Previsão do tempo', 'Marque onde fica a fazenda para ver o clima e a hora de pulverizar').replace('data-id="clima"', 'data-id="sede"');
  const h = c?.dados?.hourly, d = c?.dados?.daily;
  if (!h?.time || !d?.time) return linha('⛅', 'Previsão do tempo', navigator.onLine === false ? 'Sem internet: aparece quando o sinal voltar' : 'Buscando a previsão…');
  const t = today(), hora = new Date().getHours(), i = Math.max(0, h.time.indexOf(`${t}T${String(hora).padStart(2, '0')}:00`)), i0 = Math.max(0, d.time.indexOf(t));
  const temp = h.temperature_2m?.[i], nuvem = h.cloud_cover?.[i] ?? 0, mm = h.precipitation?.[i] || 0, noite = hora < 6 || hora >= 19, trov = (h.trovoada?.[i] || 0) >= 0.5;
  const ch = typeof horariosChuva === 'function' ? horariosChuva(c.dados, t) : [];
  const [ic, cond] = trov ? ['⛈️', 'Trovoada'] : mm >= 0.3 ? ['🌧️', 'Chuva'] : nuvem >= 80 ? ['☁️', 'Nublado'] : nuvem >= 35 ? [noite ? '☁️' : '⛅', 'Parcialmente nublado'] : [noite ? '🌙' : '☀️', ch.length ? 'Céu limpo agora' : 'Sem chuva'];
  const jan = typeof janelasDoDia === 'function' ? janelasDoDia(c.dados, d.time[i0]) : {janelas: []};
  const prox = ch.length ? (ch[0].agora ? 'chovendo agora' : `chuva às ${hh2(ch[0].ini)}`) : (() => { const k = d.precipitation_sum.findIndex((x, j) => j > i0 && x >= 1); return k > 0 ? `chuva ${typeof nomeDiaCurto === 'function' ? nomeDiaCurto(d.time[k]) : fmtDate(d.time[k])}` : 'sem chuva prevista'; })();
  const pulv = jan.janelas.length ? 'Pulverizar ' + jan.janelas.map(([x, y]) => `${hh(x)}–${hh(y)}`).join(', ') : 'Sem janela para pulverizar';
  return linha(ic, `${temp != null ? Math.round(temp) + ' °C' : '—'} • ${esc(cond)}`, `${pulv} • ${prox}`, jan.janelas.length ? 'ok' : 'nao');
}
// A operação que pede ação agora: em andamento, senão atrasada, senão a próxima de hoje
function pvOpPrioritaria() {
  const t = today(), ops = db.operations, porHora = (a, b) => String((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || ''));
  return ops.filter(o => o.status === 'Em andamento').sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')))[0]
    || ops.filter(o => o.status === 'Programada' && o.date && o.date < t).sort(porHora)[0]
    || ops.filter(o => o.status === 'Programada' && o.date === t).sort(porHora)[0] || null;
}
function pvPrioritaria() {
  const o = pvOpPrioritaria();
  const tit = `<h3 class="ini-tit pv-tit">${pvHex('broto', 'verde', 28)} Operação prioritária</h3>`;
  if (!o) return `<section class="card ini-card pv-prior">${tit}${typeof iniVazio === 'function' ? iniVazio('🚜', 'Nada para fazer agora', 'Nenhuma operação em andamento ou programada para hoje.', {act: 'op-new', label: '+ Programar operação', cls: 'secondary'}) : ''}</section>`;
  const maq = machineName(o.machineId), area = Number(o.area) > 0 ? `${num(o.area)} ha` : '';
  return `<section class="card ini-card pv-prior">${tit}
    <button type="button" class="pv-prior-op" data-act="pv-op-abrir" data-id="${esc(o.id)}"><span class="pv-op-ic">${pvHex(pvIconeOp(o.type), 'verde', 52)}</span>
      <span class="pv-op-txt"><strong>${esc(o.type)}</strong><small>${esc([opPlace(o), pvResp(o)].filter(Boolean).join(' • '))}</small><small class="pv-prior-quando">${esc(pvQuando(o))}</small></span>${pvSelo(o)}</button>
    ${area || maq ? `<div class="pv-prior-info">${area ? `<span>${iconeLinha('talhoes', 20)}<b>${esc(area)}</b></span>` : ''}${maq ? `<span>${iconeLinha('maquinas', 20)}<b>${esc(maq)}</b></span>` : ''}</div>` : ''}
    ${pvAcao(o, {iniciar: 'Iniciar operação', concluir: 'Concluir operação'}).replace('pv-acao', 'pv-acao pv-grande')}</section>`;
}
// Próxima operação programada (depois da prioritária)
function pvProxima() {
  const pri = pvOpPrioritaria(), t = today();
  const o = db.operations.filter(x => x.status === 'Programada' && x.id !== pri?.id && x.date && x.date >= t)
    .sort((a, b) => String((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')))[0];
  return `<section class="card ini-card pv-proxima"><h3 class="ini-tit pv-tit">Próxima operação</h3>
    ${o ? `<button type="button" class="pv-prox-op" data-act="pv-op-abrir" data-id="${esc(o.id)}"><span class="pv-prox-ic" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" class="ic-linha">${PV_GLIFOS.calendario}</svg></span>
      <span class="pv-op-txt"><strong>${esc(o.type)}</strong><small>${esc(opPlace(o))}</small><small>${esc(pvQuando(o))}</small></span>${pvSeta()}</button>`
      : `<p class="pv-vazio-linha">Nenhuma outra operação programada. <button type="button" class="link" data-act="op-new">+ Programar</button></p>`}</section>`;
}
// Indicadores (tablet e computador): operações de hoje, em andamento, máquinas disponíveis e avisos
function pvKpis() {
  const t = today(), ops = db.operations, ms = db.machines.filter(m => m.type !== 'Implemento' && !isInactive(m));
  const and = ops.filter(o => o.status === 'Em andamento'), hoje = ops.filter(o => o.date === t && o.status !== 'Cancelada'), atr = ops.filter(o => o.status === 'Programada' && o.date && o.date < t);
  const usoIds = new Set(and.map(o => o.machineId).filter(Boolean)), manut = ms.filter(m => machineStatus(m) === 'Em manutenção');
  const disp = ms.filter(m => !usoIds.has(m.id) && !manut.includes(m)).length, avisos = typeof alerts === 'function' ? alerts() : [];
  const urg = avisos.filter(a => a.color === 'red').length;
  const kpi = (ic, cor, valor, rot, sub, rota, cls = '', subCls = '') => `<button type="button" class="card ini-kpi pv-kpi ${cls}" data-act="nav" data-id="${rota}"><span class="pv-kpi-ic ${cor}" aria-hidden="true">${iconeLinha(ic, 26)}</span><span><b>${valor}</b><small>${esc(rot)}</small>${sub ? `<em class="${subCls}">${esc(sub)}</em>` : ''}</span></button>`;
  return `<section class="ini-kpis pv-kpis so-grande">
    ${kpi('lista', 'verde', hoje.length + atr.length, hoje.length + atr.length === 1 ? 'Operação hoje' : 'Operações hoje', atr.length ? `${atr.length} ${atr.length === 1 ? 'atrasada' : 'atrasadas'}` : '', 'operacoes', '', 'nao')}
    ${kpi('operacoes', 'azul', and.length, 'Em andamento', '', 'operacoes')}
    ${kpi('maquinas', 'verde', disp, disp === 1 ? 'Máquina disponível' : 'Máquinas disponíveis', manut.length ? `${manut.length} em manutenção` : '', 'maquinas', 'so-pc', 'atencao')}
    ${kpi('alerta', urg ? 'vermelho' : 'laranja', avisos.length, 'Atenção', urg ? `${urg} ${urg === 1 ? 'urgente' : 'urgentes'}` : '', 'avisos', '', 'nao')}</section>`;
}

const pvInicioDepois = VIEWS.inicio.after;
// Celular: saudação, clima numa linha, resumo, operação prioritária, atenção, próxima operação, acesso rápido.
// Tablet: indicadores; prioritária à esquerda, atenção e próxima à direita; operações de hoje.
// Computador: indicadores; operações de hoje e prioritária à esquerda; atenção, próxima e gastos à direita.
VIEWS.inicio = () => {
  const ops = iniPode('operacoes'), gastos = iniGastos();
  return `<div class="ini pv-ini ${gastos ? '' : 'sem-fin'} ${ops ? '' : 'sem-ops'}">
    <header class="ini-topo">${iniSaudacao()}<div class="pv-topo-lado so-grande">${pvClima('pv-clima-pilula')}<button type="button" class="primary ini-lancar-pc so-pc" data-act="ini-lancar">${iconeLinha('mais', 20)} Novo lançamento</button></div></header>
    <div class="pv-clima-cel so-celular">${pvClima('card')}</div>
    ${ops ? pvKpis() + iniResumo() : ''}
    <div class="pv-esq">${ops ? iniTabelaOps() + pvPrioritaria() : `<div class="ini-bloco ini-suas">${iniAtalhosFuncao()}</div>`}<div class="ini-prep">${iniPreparar()}</div></div>
    <div class="pv-dir">${iniAtencao()}${ops ? pvProxima() : ''}${gastos}</div>
    ${ops ? iniAcesso() : ''}
    <button type="button" class="primary ini-lancar so-ate-tablet" data-act="ini-lancar">${iconeLinha('mais', 22)} Novo lançamento</button></div>`;
};
VIEWS.inicio.after = (...a) => pvInicioDepois?.(...a);

// =================== Etapa 3: Máquinas e Talhões ===================
const pvTemplate = html => { const t = document.createElement('template'); t.innerHTML = html; return t; };
const pvMenuVazio = (rotulo = '⋮', cls = 'pv-linha-mais') => { const d = document.createElement('details'); d.className = `menu-mais ${cls}`; d.innerHTML = `<summary aria-label="Mais ações" title="Mais ações">${rotulo}</summary><div class="menu-lista"></div>`; return d; };
// Linhas com Editar / Excluir / Histórico: essas ações vão para o menu ⋮ (a ação do dia continua à vista)
function pvAgruparAcoes(html, mover = /-(edit|del|hist)$/) {
  if (!html || !html.includes('row-actions')) return html;
  const t = pvTemplate(html);
  t.content.querySelectorAll('.row-actions').forEach(box => {
    const bs = [...box.children].filter(b => b.matches('button[data-act]') && mover.test(b.dataset.act));
    if (!bs.length || box.querySelector(':scope > .menu-mais')) return;
    const d = pvMenuVazio(); bs.forEach(b => d.lastElementChild.append(b)); box.append(d);
  });
  return t.innerHTML;
}
// Cabeçalho da tela: o botão principal e os que ficam à vista; os demais vão para “⋯ Mais”
function pvCabecalho(html, ficar = []) {
  const t = pvTemplate(html), btns = t.content.querySelector('.view-head .btns'); if (!btns) return html;
  const mover = [...btns.children].filter(b => b.matches('button') && !b.classList.contains('primary') && !ficar.some(f => b.dataset.act === f || `${b.dataset.act}:${b.dataset.id}` === f));
  if (mover.length < 2) return html;
  const d = pvMenuVazio('⋯ Mais', 'pv-head-mais'); mover.forEach(b => d.lastElementChild.append(b));
  btns.insertBefore(d, btns.querySelector('.primary') || null);
  return t.innerHTML;
}

// ---------- Linhas de operação e de manutenção (talhão, máquina, ordens) ----------
const pvLinhaOpBase = operationRow;
operationRow = function (o, actions = true) { return actions ? pvAgruparAcoes(pvLinhaOpBase(o, actions)) : pvLinhaOpBase(o, actions); };
const pvLinhaManutBase = linhaManutencao;
linhaManutencao = function (...a) { return pvAgruparAcoes(pvLinhaManutBase(...a)); };

// ---------- Máquinas ----------
function pvIconeMaq(m) {
  const g = typeof grupoDoTipoMaq === 'function' ? grupoDoTipoMaq(m.type) : '';
  if (/Pulverizador|Drone|Avião/.test(m.type || '')) return 'pontas';
  if (/Plantadeira/.test(m.type || '')) return 'broto';
  if (g === 'Colheita') return 'espiga';
  if (g === 'Veículos') return 'catalogo';
  if (g === 'Unidade de grãos') return 'graos/silos';
  if (/Implemento/.test(m.type || '')) return 'engrenagem';
  return 'maquinas';
}
// Cartão da máquina como nas prévias: ícone, situação, horas, barra até a revisão com o percentual,
// detalhes recolhidos em “Mais informações” e as ações numa linha (o mesmo cartão de antes por dentro)
const pvCartaoMaqBase = cartaoMaquina;
cartaoMaquina = function (m) {
  const html = pvCartaoMaqBase(m), t = pvTemplate(html), art = t.content.querySelector('article'); if (!art) return html;
  art.classList.add('pv-maq');
  art.querySelector('header')?.insertAdjacentHTML('afterbegin', `<span class="pv-maq-ic">${pvHex(pvIconeMaq(m), 'azul', 52)}</span>`);
  const barra = art.querySelector('.maq-rev .progress span');
  if (barra) art.querySelector('.maq-rev .progress').insertAdjacentHTML('afterend', `<b class="pv-maq-pct">${Math.round(parseFloat(barra.style.width) || 0)}%</b>`);
  // Botões da linha sem o símbolo da frente, para caberem os três numa linha
  art.querySelectorAll('.maq-acoes > button').forEach(b => { b.title = b.textContent.trim(); b.textContent = b.textContent.replace(/^[^\p{L}]+/u, ''); });
  const meta = art.querySelector(':scope > .meta');
  if (meta && meta.children.length) { const d = document.createElement('details'); d.className = 'pv-maq-det'; d.innerHTML = '<summary>Mais informações</summary>'; meta.replaceWith(d); d.append(meta); }
  return t.innerHTML;
};
const pvMaquinasBase = VIEWS.maquinas;
VIEWS.maquinas = arg => {
  const html = pvMaquinasBase(arg);
  return arg ? html : pvCabecalho(html, ['ag-ler-qr']);
};
if (pvMaquinasBase.after) VIEWS.maquinas.after = pvMaquinasBase.after;

// ---------- Talhões ----------
// Desenho do contorno do talhão (sem internet): o polígono em verde sobre fundo de campo
function pvDesenhoTalhao(f, alto = 190) {
  const ps = f?.contorno?.pontos; if (!ps || ps.length < 3) return '';
  const lat0 = ps.reduce((s, p) => s + p[0], 0) / ps.length, k = Math.cos(lat0 * Math.PI / 180);
  const xy = ps.map(([la, lo]) => [lo * k, -la]), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], w = 400, h = alto, m = 22;
  const esc_ = Math.min((w - 2 * m) / ((x1 - x0) || 1e-9), (h - 2 * m) / ((y1 - y0) || 1e-9));
  const ox = (w - (x1 - x0) * esc_) / 2, oy = (h - (y1 - y0) * esc_) / 2;
  const pts = xy.map(([x, y]) => `${(ox + (x - x0) * esc_).toFixed(1)},${(oy + (y - y0) * esc_).toFixed(1)}`).join(' ');
  return `<svg class="pv-talhao-desenho" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Contorno do talhão ${esc(f.name)}">
    <defs><pattern id="pvLinhas" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0v10" stroke="rgba(255,255,255,.07)" stroke-width="4"/></pattern></defs>
    <rect width="${w}" height="${h}" fill="#2f4a2a"/><rect width="${w}" height="${h}" fill="url(#pvLinhas)"/>
    <polygon points="${pts}" fill="rgba(76,191,104,.55)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}
const pvTalhoesBase = VIEWS.talhoes;
VIEWS.talhoes = (...a) => {
  const html = pvTalhoesBase(...a); if (!html.includes('item-card')) return html;
  const t = pvTemplate(html);
  t.content.querySelectorAll('article.item-card').forEach(art => {
    const id = art.querySelector('[data-act="fd-edit"]')?.dataset.id, f = id && find('fields', id); if (!f) return;
    art.classList.add('pv-talhao');
    const h4 = art.querySelector('header h4');
    if (h4) h4.innerHTML = `<button type="button" class="pv-talhao-nome" data-act="nav" data-id="talhao/${esc(id)}">${esc(f.name)}</button>`;
    art.querySelector('header')?.insertAdjacentHTML('afterbegin', `<span class="pv-maq-ic">${pvHex('talhoes', 'verde', 48)}</span>`);
    const acoes = art.querySelector(':scope > .row-actions');
    if (acoes) {
      const d = pvMenuVazio(); [...acoes.querySelectorAll('[data-act="fd-hist"],[data-act="fd-edit"],[data-act="fd-del"]')].forEach(b => d.lastElementChild.append(b));
      acoes.classList.add('pv-talhao-acoes'); acoes.removeAttribute('style');
      acoes.insertAdjacentHTML('afterbegin', `<button type="button" class="pv-acao pv-acao-ver" data-act="nav" data-id="talhao/${esc(id)}">Ver talhão${pvSeta()}</button>`);
      acoes.append(d);
    }
  });
  return t.innerHTML;
};
if (pvTalhoesBase.after) VIEWS.talhoes.after = pvTalhoesBase.after;

// Talhão: desenho do contorno no topo e as informações em abas (Resumo, Operações, Avaliações, Insumos e gastos)
let pvAbaTalhao = 'resumo';
const pvTalhaoBase = VIEWS.talhao;
VIEWS.talhao = id => {
  const html = pvTalhaoBase(id), f = find('fields', id); if (!f) return html;
  const t = pvTemplate(pvCabecalho(html, ['nav:talhoes'])), raiz = t.content, cab = raiz.querySelector('.view-head');
  if (!cab) return html;
  const grupos = {resumo: [], operacoes: [], avaliacoes: [], custos: []};
  let atual = null;
  [...raiz.children].filter(el => el !== cab).forEach(el => {
    const tit = (el.querySelector('h2,h3,h4')?.textContent || el.textContent || '').trim();
    if (el.matches('.section-title')) atual = /^Operaç/i.test(tit) ? 'operacoes' : /^Avalia/i.test(tit) ? 'avaliacoes' : 'custos';
    else if (!el.previousElementSibling?.matches('.section-title')) atual = /Avaliações da lavoura/i.test(tit) ? 'avaliacoes' : el.matches('.ag-resumo, .tl-card') || atual === null ? 'resumo' : atual === 'resumo' ? 'resumo' : atual;
    grupos[atual || 'resumo'].push(el);
  });
  // Resumo: últimas atividades e “Registrar atividade”, como nas prévias
  const ops = db.operations.filter(o => o.fieldId === id).sort(byDateDesc), safra = f.season ? ops.filter(o => !o.season || o.season === f.season) : ops;
  const ultChuva = db.chuvas.filter(c => c.fieldId === id || !c.fieldId).sort(byDateDesc)[0];
  const ult = `<section class="card panel pv-ult"><div class="pv-ult-kpis">
      <div><span class="pv-kpi-ic azul" aria-hidden="true">${iconeLinha('chuva', 24)}</span><span><small>Última chuva</small><b>${ultChuva ? num(ultChuva.mm) + ' mm' : '—'}</b><small>${ultChuva ? 'em ' + fmtDate(ultChuva.date) : 'nenhuma registrada'}</small></span></div>
      <div><span class="pv-kpi-ic verde" aria-hidden="true">${iconeLinha('relatorios', 24)}</span><span><small>Operações</small><b>${safra.length}</b><small>${f.season ? 'na safra ' + esc(f.season) : 'registradas'}</small></span></div></div>
    <h3 class="ini-tit">Últimas atividades</h3>
    ${ops.length ? `<ul class="pv-ativ">${ops.slice(0, 4).map(o => { const [c] = pvSituacao(o); return `<li><span class="pv-ponto ${c}" aria-hidden="true"></span><span><strong>${esc(o.type)}</strong><small>${fmtDate(o.date)}${o.status !== 'Concluída' ? ' • ' + esc(o.status.toLowerCase()) : ''}</small></span><b>${Number(o.area) > 0 ? num(o.area) + ' ha' : ''}</b></li>`; }).join('')}</ul>` : '<p class="nota">Nenhuma atividade registrada neste talhão.</p>'}
    <button type="button" class="primary pv-acao pv-grande" data-act="op-field" data-id="${esc(id)}">${iconeLinha('mais', 20)} Registrar atividade</button></section>`;
  const abas = [['resumo', 'Resumo'], ['operacoes', 'Operações'], ['avaliacoes', 'Avaliações'], ['custos', 'Insumos e gastos']].filter(([k]) => k === 'resumo' || grupos[k].length);
  if (!abas.some(([k]) => k === pvAbaTalhao)) pvAbaTalhao = 'resumo';
  const desenho = pvDesenhoTalhao(f);
  const topo = `<section class="card pv-talhao-topo ${desenho ? '' : 'sem-desenho'}">${desenho ? `<button type="button" class="pv-talhao-mapa" data-act="nav" data-id="mapatalhoes" aria-label="Ver no mapa de satélite">${desenho}<span>${num(f.area)} ha • ver no mapa ›</span></button>`
    : `<div class="pv-talhao-semdesenho">${pvHex('talhoes', 'verde', 44)}<span><strong>Contorno ainda não marcado</strong><small>Desenhe no satélite ou percorra pelo GPS para ver o talhão aqui.</small></span><button type="button" class="secondary" data-act="nav" data-id="${VIEWS.desenhar && (typeof tmGestor !== 'function' || tmGestor()) ? 'desenhar/' : 'contorno/'}${esc(id)}">${VIEWS.desenhar && (typeof tmGestor !== 'function' || tmGestor()) ? 'Desenhar' : 'Medir pelo GPS'}</button></div>`}</section>`;
  const nav = `<nav class="pv-abas" aria-label="Seções do talhão">${abas.map(([k, r]) => `<button type="button" class="${k === pvAbaTalhao ? 'active' : ''}" aria-pressed="${k === pvAbaTalhao}" data-act="pv-aba-talhao" data-id="${k}">${r}</button>`).join('')}</nav>`;
  const painel = k => `<div class="pv-aba-painel" data-aba="${k}" ${k === pvAbaTalhao ? '' : 'hidden'}>${k === 'resumo' ? ult : ''}${grupos[k].map(el => el.outerHTML).join('')}</div>`;
  return cab.outerHTML + topo + nav + abas.map(([k]) => painel(k)).join('');
};
if (pvTalhaoBase.after) VIEWS.talhao.after = pvTalhaoBase.after;
ACTIONS['pv-aba-talhao'] = k => {
  pvAbaTalhao = k;
  document.querySelectorAll('.pv-aba-painel').forEach(p => { p.hidden = p.dataset.aba !== k; });
  document.querySelectorAll('[data-act="pv-aba-talhao"]').forEach(b => { const on = b.dataset.id === k; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
};
