'use strict';
/* MercaPlant — Visão do grupo: as fazendas de que a pessoa participa (ou todas, para o ADM do sistema) lado a lado.
   Lê da nuvem só o necessário de cada fazenda (somente leitura; nada é gravado no aparelho) e mostra
   talhões, operações, área trabalhada, pendências, chuva, produção e — onde a pessoa vê o financeiro — custos e vendas.
   O servidor só entrega os dados que a pessoa pode ver em cada fazenda (mesmas regras da sincronização). */
const GRUPO_STORES = ['fields', 'operations', 'machines', 'maintenances', 'stock', 'chuvas', 'colheitas', 'expenses', 'vendas'];
const GRUPO_N = 'agro-grupo-n';
let grupoDias = 30, grupoEstado = {carregando: false, erro: '', fazendas: null, em: 0};

// Resumo de uma fazenda no período (função pura: recebe os registros já lidos)
function grupoResumo(d, de, ate) {
  const no = x => (x || '') >= de && (x || '') <= ate;
  const ops = (d.operations || []).filter(o => no(o.date) && o.status !== 'Cancelada');
  const concl = ops.filter(o => o.status === 'Concluída');
  const areaTrab = concl.filter(o => opTemArea(o)).reduce((s, o) => s + (Number(o.area) || 0), 0);
  const atrasadas = (d.operations || []).filter(o => o.status === 'Programada' && o.date && o.date < ate).length;
  const abertas = new Set((d.maintenances || []).filter(m => !['Concluída', 'Recusada'].includes(m.status) && (m.status !== 'Aguardando autorização' || m.parada === 'Sim')).map(m => m.machineId));
  const maquinas = (d.machines || []).filter(m => m.state !== 'Inativa');
  const revisoes = maquinas.filter(m => Number(m.nextService) > 0 && Number(m.nextService) - (Number(m.hours) || 0) <= (typeof avisoRevisao === 'function' ? avisoRevisao(m) : SERVICE_WARN_HOURS)).length;
  const estoqueBaixo = (d.stock || []).filter(s => Number(s.min) > 0 && Number(s.qty) <= Number(s.min)).length;
  const porLocal = {}; (d.chuvas || []).filter(c => no(c.date)).forEach(c => { const k = c.fieldId || ''; porLocal[k] = (porLocal[k] || 0) + (Number(c.mm) || 0); });
  const locais = Object.values(porLocal), chuva = locais.length ? locais.reduce((s, x) => s + x, 0) / locais.length : null;
  const sacas = (d.colheitas || []).filter(c => no(c.date)).reduce((s, c) => s + (Number(c.kg) || 0) / KG_SACA_GRAO, 0);
  const custos = (d.expenses || []).filter(g => no(g.date)).reduce((s, g) => s + (Number(g.value) || 0), 0)
    + (d.maintenances || []).filter(m => m.status === 'Concluída' && no(m.doneDate || m.date)).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const vendas = (d.vendas || []).filter(v => no(v.date)).reduce((s, v) => s + (Number(v.valor) || 0), 0);
  return {talhoes: (d.fields || []).length, area: (d.fields || []).reduce((s, f) => s + (Number(f.area) || 0), 0), ops: ops.length, concl: concl.length,
    areaTrab, atrasadas, maquinas: maquinas.length, emManut: maquinas.filter(m => abertas.has(m.id)).length, revisoes, estoqueBaixo, chuva, sacas, custos, vendas};
}

async function grupoLerFazenda(id) {
  const dados = Object.fromEntries(GRUPO_STORES.map(s => [s, []]));
  for (let desde = 0; ; desde += 1000) {
    const rows = await nvHttp(`/rest/v1/records?select=store,data&farm_id=eq.${encodeURIComponent(id)}&deleted=eq.false&store=in.(${GRUPO_STORES.join(',')})&order=seq.asc&limit=1000&offset=${desde}`);
    (rows || []).forEach(r => { if (dados[r.store] && r.data && typeof r.data === 'object') dados[r.store].push(r.data); });
    if (!rows || rows.length < 1000) break;
  }
  return dados;
}
async function grupoCarregar() {
  if (grupoEstado.carregando) return;
  if (!nv.sessao) { grupoEstado = {...grupoEstado, erro: 'Entre na sua conta da nuvem para ver as fazendas do grupo.'}; return render(); }
  grupoEstado = {...grupoEstado, carregando: true, erro: ''}; render();
  try {
    const [fazendas, minhas] = await Promise.all([
      nvHttp('/rest/v1/farms?select=id,name&order=name.asc'),
      nvHttp(`/rest/v1/farm_members?select=farm_id,role,modulos,status&user_id=eq.${encodeURIComponent(nv.sessao.usuario)}`).catch(() => [])
    ]);
    const papel = Object.fromEntries((minhas || []).filter(m => !m.status || m.status === 'ativo').map(m => [m.farm_id, m]));
    // Mostra só as fazendas em que a pessoa está ativa (o ADM do sistema vê todas)
    const lista = (fazendas || []).filter(f => nv.sysadm || papel[f.id]);
    const veFin = f => nv.sysadm || ['admin', 'supervisor'].includes(papel[f.id]?.role) || (Array.isArray(papel[f.id]?.modulos) && papel[f.id].modulos.some(x => x === 'financeiro' || x === 'producao'));
    const out = [];
    for (let i = 0; i < lista.length; i += 3) {
      const lote = await Promise.all(lista.slice(i, i + 3).map(async f => ({id: f.id, nome: f.name || 'Fazenda', fin: veFin(f), atual: f.id === nv.fazenda?.id, dados: await grupoLerFazenda(f.id)})));
      out.push(...lote);
    }
    safeStorage.set(GRUPO_N, String(lista.length));
    grupoEstado = {carregando: false, erro: '', fazendas: out, em: Date.now()};
  } catch (err) {
    grupoEstado = {...grupoEstado, carregando: false, erro: err?.rede ? 'Sem internet: a visão do grupo precisa da nuvem. Tente de novo com sinal.' : (err?.message || 'Não foi possível carregar as fazendas.')};
  }
  if (parseRoute().name === 'grupo') render();
  grupoMenu();
}

function grupoLinhas() {
  const de = daysAgo(grupoDias - 1), ate = today();
  return (grupoEstado.fazendas || []).map(f => ({...f, r: grupoResumo(f.dados, de, ate)}));
}
const grupoBrl = v => `R$ ${num(v, 2)}`;
VIEWS.grupo = () => {
  const linhas = grupoLinhas(), de = daysAgo(grupoDias - 1);
  const filtros = `<div class="filters">${[7, 30, 90, 365].map(d => `<button class="${d === grupoDias ? 'active' : ''}" data-act="grupo-dias" data-id="${d}">${d === 365 ? '12 meses' : d + ' dias'}</button>`).join('')}</div>`;
  const botoes = btn('Atualizar', 'grupo-atualizar', '', 'secondary') + (linhas.length ? btn('Enviar PDF (WhatsApp)', 'grupo-pdf-enviar', '', 'secondary') + btn('Baixar PDF', 'grupo-pdf') : '');
  const topo = head('Visão do grupo', `Todas as suas fazendas lado a lado • desde ${fmtDate(de)}`, botoes) + filtros;
  if (grupoEstado.fazendas === null && !grupoEstado.carregando && !grupoEstado.erro) { setTimeout(grupoCarregar, 0); }
  if (grupoEstado.carregando && !linhas.length) return topo + `<section class="card"><p class="nota">Lendo as fazendas na nuvem…</p></section>`;
  if (grupoEstado.erro && !linhas.length) return topo + `<section class="card">${empty('Não foi possível abrir a visão do grupo', grupoEstado.erro, {act: 'grupo-atualizar', label: 'Tentar de novo'})}</section>`;
  if (linhas.length < 2) return topo + `<section class="card">${empty('Só uma fazenda na sua conta', 'A visão do grupo compara duas ou mais fazendas. Quando você participar de outra fazenda (ou criar uma), ela aparece aqui.')}</section>`;
  const algumFin = linhas.some(l => l.fin);
  const T = linhas.reduce((t, l) => { Object.keys(l.r).forEach(k => { if (typeof l.r[k] === 'number' && (l.fin || !['custos', 'vendas'].includes(k))) t[k] = (t[k] || 0) + l.r[k]; }); return t; }, {});
  const barra = (v, max, cor = '') => `<div class="bar"><span style="width:${max > 0 ? Math.max(2, v / max * 100) : 0}%${cor ? ';background:' + cor : ''}"></span></div>`;
  const maxArea = Math.max(0, ...linhas.map(l => l.r.areaTrab)), maxCusto = Math.max(0, ...linhas.filter(l => l.fin).map(l => l.r.custos));
  const atencao = linhas.filter(l => l.r.atrasadas || l.r.estoqueBaixo || l.r.revisoes || l.r.emManut);
  return topo + `${grupoEstado.carregando ? '<p class="nota">Atualizando…</p>' : ''}
    <section class="kpis">
      <article class="card kpi"><div class="label">Fazendas</div><div class="value">${linhas.length}</div><div class="hint">${num(T.talhoes)} talhões • ${num(T.area)} ha</div></article>
      <article class="card kpi"><div class="label">Operações</div><div class="value">${num(T.ops)}</div><div class="hint">${num(T.concl)} concluídas • ${num(T.areaTrab)} ha trabalhados</div></article>
      <article class="card kpi"><div class="label">Produção</div><div class="value">${T.sacas ? num(Math.round(T.sacas)) + ' sc' : '—'}</div><div class="hint">colhido no período</div></article>
      ${algumFin ? `<article class="card kpi"><div class="label">Custos</div><div class="value">${grupoBrl(T.custos || 0)}</div><div class="hint">vendas ${grupoBrl(T.vendas || 0)}${linhas.some(l => !l.fin) ? ' • só fazendas com acesso ao financeiro' : ''}</div></article>` : ''}
    </section>
    ${atencao.length ? `<div class="section-title"><h3>Atenção</h3></div><section class="card panel">${atencao.map(l => `<div class="hoje-item"><span class="alert-icon ${l.r.atrasadas || l.r.estoqueBaixo ? 'red' : 'orange'}">!</span><div><strong>${esc(l.nome)}</strong><small>${[
      l.r.atrasadas ? `${l.r.atrasadas} ${l.r.atrasadas === 1 ? 'operação atrasada' : 'operações atrasadas'}` : '', l.r.estoqueBaixo ? `${l.r.estoqueBaixo} ${l.r.estoqueBaixo === 1 ? 'item com estoque baixo' : 'itens com estoque baixo'}` : '',
      l.r.revisoes ? `${l.r.revisoes} ${l.r.revisoes === 1 ? 'revisão próxima ou vencida' : 'revisões próximas ou vencidas'}` : '', l.r.emManut ? `${l.r.emManut} ${l.r.emManut === 1 ? 'máquina em manutenção' : 'máquinas em manutenção'}` : ''].filter(Boolean).join(' • ')}</small></div></div>`).join('')}</section>` : ''}
    <div class="section-title"><h3>Fazendas</h3></div>
    <section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fazenda</th><th class="num">Talhões</th><th class="num">Operações</th><th>Área trabalhada</th><th class="num">Chuva</th><th class="num">Produção</th>${algumFin ? '<th>Custos</th><th class="num">Vendas</th>' : ''}<th class="num">Pendências</th></tr></thead><tbody>
      ${linhas.map(l => `<tr><td><strong>${esc(l.nome)}</strong>${l.atual ? '<br><small style="color:var(--green)">aberta neste aparelho</small>' : ''}</td>
        <td class="num">${num(l.r.talhoes)}<br><small style="color:var(--muted)">${num(l.r.area)} ha</small></td><td class="num">${num(l.r.ops)}<br><small style="color:var(--muted)">${num(l.r.concl)} concl.</small></td>
        <td style="min-width:150px">${barra(l.r.areaTrab, maxArea)}<small>${num(l.r.areaTrab)} ha</small></td>
        <td class="num">${l.r.chuva != null ? num(Math.round(l.r.chuva)) + ' mm' : '—'}</td><td class="num">${l.r.sacas ? num(Math.round(l.r.sacas)) + ' sc' : '—'}</td>
        ${algumFin ? (l.fin ? `<td style="min-width:150px">${barra(l.r.custos, maxCusto, 'var(--orange)')}<small>${grupoBrl(l.r.custos)}</small></td><td class="num">${grupoBrl(l.r.vendas)}</td>` : '<td><small class="nota">sem acesso</small></td><td class="num">—</td>') : ''}
        <td class="num">${l.r.atrasadas + l.r.estoqueBaixo + l.r.revisoes || '—'}</td></tr>`).join('')}
      <tr class="total"><td><strong>Grupo</strong></td><td class="num"><strong>${num(T.talhoes)}</strong><br><small>${num(T.area)} ha</small></td><td class="num"><strong>${num(T.ops)}</strong></td><td><strong>${num(T.areaTrab)} ha</strong></td><td></td><td class="num"><strong>${T.sacas ? num(Math.round(T.sacas)) + ' sc' : '—'}</strong></td>${algumFin ? `<td><strong>${grupoBrl(T.custos || 0)}</strong></td><td class="num"><strong>${grupoBrl(T.vendas || 0)}</strong></td>` : ''}<td></td></tr>
    </tbody></table></div>
    <p class="nota">Dados lidos da nuvem ${grupoEstado.em ? `às ${new Date(grupoEstado.em).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}` : ''}: o que ainda não foi sincronizado em cada aparelho não aparece. Custos = gastos lançados + manutenções concluídas no período.</p></section>`;
};
TITLES.grupo = 'Visão do grupo';

// PDF do grupo (usa as peças comuns dos relatórios)
function grupoPdf(enviar) {
  const linhas = grupoLinhas(); if (linhas.length < 2 || typeof pdfMercaPlant !== 'function') return;
  const de = daysAgo(grupoDias - 1), ate = today(), periodo = `${fmtDate(de)} a ${fmtDate(ate)}`, algumFin = linhas.some(l => l.fin);
  const P = pdfMercaPlant({titulo: 'Relatório do grupo de fazendas', linha2: `Período: ${periodo}`, continuacao: periodo});
  const T = k => linhas.reduce((s, l) => s + ((l.fin || !['custos', 'vendas'].includes(k)) ? l.r[k] || 0 : 0), 0);
  P.secao('Resumo do grupo');
  P.cartoes([['Fazendas', num(linhas.length), `${num(T('talhoes'))} talhões · ${num(T('area'))} ha`], ['Operações', num(T('ops')), `${num(T('concl'))} concluídas`],
    ['Área trabalhada', `${num(T('areaTrab'))} ha`, 'operações concluídas'], ['Produção', `${num(Math.round(T('sacas')))} sc`, 'colhido no período'],
    ...(algumFin ? [['Custos', grupoBrl(T('custos')), 'gastos + manutenções', P.COR.laranja], ['Vendas', grupoBrl(T('vendas')), 'no período', P.COR.verde]] : [])]);
  P.secao('Área trabalhada por fazenda'); P.grafico(linhas.map(l => [l.nome, l.r.areaTrab]).sort((a, b) => b[1] - a[1]), {formato: v => `${num(v)} ha`});
  if (algumFin) { P.secao('Custos por fazenda'); P.grafico(linhas.filter(l => l.fin).map(l => [l.nome, l.r.custos]).sort((a, b) => b[1] - a[1]), {corBarra: P.COR.laranja, formato: v => grupoBrl(v)}); }
  P.secao('Fazendas');
  P.tabela([{t: 'Fazenda', w: 2.2, negrito: true}, {t: 'Talhões (ha)', w: 1.3, dir: true}, {t: 'Operações', w: 1.1, dir: true}, {t: 'Área trab.', w: 1.1, dir: true}, {t: 'Chuva', w: .9, dir: true}, {t: 'Produção', w: 1.1, dir: true},
    ...(algumFin ? [{t: 'Custos', w: 1.5, dir: true}, {t: 'Vendas', w: 1.5, dir: true}] : []), {t: 'Pendências', w: 1.1, dir: true}],
  linhas.map(l => [l.nome, `${num(l.r.talhoes)} (${num(l.r.area)})`, `${num(l.r.ops)}`, `${num(l.r.areaTrab)} ha`, l.r.chuva != null ? `${num(Math.round(l.r.chuva))} mm` : '-', l.r.sacas ? `${num(Math.round(l.r.sacas))} sc` : '-',
    ...(algumFin ? (l.fin ? [grupoBrl(l.r.custos), grupoBrl(l.r.vendas)] : ['sem acesso', '-']) : []), String(l.r.atrasadas + l.r.estoqueBaixo + l.r.revisoes || '-')]));
  P.nota('Dados lidos da nuvem no momento da emissão; o que ainda não foi sincronizado nos aparelhos não aparece. Pendências = operações atrasadas + estoque baixo + revisões próximas.');
  const doc = P.finalizar();
  entregarPdf(doc, `mercaplant-grupo-${de}-a-${ate}.pdf`, enviar, `Relatório do grupo MercaPlant - ${periodo}`);
  return doc;
}

Object.assign(ACTIONS, {
  'grupo-dias': d => { grupoDias = Number(d) || 30; render(); },
  'grupo-atualizar': grupoCarregar,
  'grupo-pdf': () => grupoPdf(false),
  'grupo-pdf-enviar': () => grupoPdf(true)
});

// Menu: "Visão do grupo" só aparece para quem tem 2 fazendas ou mais (ou é ADM do sistema)
function grupoMenu() {
  const b = document.querySelector('.sidebar .nav button[data-route="grupo"]'); if (!b) return;
  b.hidden = !(nv.sessao && (nv.sysadm || Number(safeStorage.get(GRUPO_N) || 0) >= 2));
}
if (typeof nvAplicarMenu === 'function') {
  const nvAplicarMenuOriginal = nvAplicarMenu;
  nvAplicarMenu = (...a) => { nvAplicarMenuOriginal(...a); grupoMenu(); };
}
addEventListener('load', () => {
  grupoMenu();
  // Conta as fazendas da conta (leve: só os ids) para decidir se o menu aparece
  if (nv.sessao && navigator.onLine !== false) setTimeout(() => nvHttp('/rest/v1/farms?select=id').then(l => { safeStorage.set(GRUPO_N, String((l || []).length)); grupoMenu(); }).catch(() => {}), 5000);
});
