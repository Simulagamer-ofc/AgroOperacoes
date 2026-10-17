'use strict';
/* Nexus Agro — visão do agrônomo: situação de cada talhão (praga, carência, colheita, visita), mapa da fazenda
   pintado pela situação, resumo agronômico do talhão, linha do tempo da safra e cabeçalho/assinaturas nos relatórios.
   Também ajusta a tela inicial conforme a função de quem entrou. */

// ---------- Situação do talhão ----------
const SITUACOES = {
  praga: ['red', 'Praga no nível de ação'], carencia: ['purple', 'Em carência'], colheita: ['blue', 'Colheita próxima'],
  visita: ['orange', 'Sem monitoramento recente'], ok: ['green', 'Em dia'], vazio: ['gray', 'Sem cultura em campo']};
function situacaoTalhao(f) {
  const t = today(), mons = db.monitoramentos.filter(m => m.fieldId === f.id).sort(byDateDesc);
  const aplicadoDepois = x => db.aplicacoes.some(a => a.fieldId === x.fieldId && (a.date || '') >= x.date);
  const porAlvo = Object.values(mons.reduce((acc, x) => { acc[String(x.alvo || '').toLowerCase()] ||= x; return acc; }, {}));
  const praga = typeof atingiuNivel === 'function' ? porAlvo.find(x => atingiuNivel(x) && x.date >= daysAgo(30) && !aplicadoDepois(x)) : null;
  const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(f.id) : null, carencia = lib && lib.libera > t ? lib : null;
  const c = typeof cicloTalhao === 'function' ? cicloTalhao(f) : null;
  const semVisita = c && c.dap >= 7 ? (mons[0] ? diasEntreAuto(mons[0].date, t) : c.dap) : null;
  const s = k => ({chave: k, cor: SITUACOES[k][0], rotulo: SITUACOES[k][1]});
  if (praga) return {...s('praga'), texto: `${praga.alvo}: ${num(praga.valor, 2)} ${praga.unidade || ''} em ${fmtDate(praga.date)}`};
  if (carencia) return {...s('carencia'), texto: `${carencia.a.produto} — colheita a partir de ${fmtDate(carencia.libera)}`};
  if (c && c.faltam != null && c.faltam <= 7) return {...s('colheita'), texto: c.faltam <= 0 ? 'Data prevista de colheita chegou' : `Colheita em ${c.faltam} ${c.faltam === 1 ? 'dia' : 'dias'}`};
  if (semVisita != null && semVisita > 7) return {...s('visita'), texto: mons[0] ? `Último monitoramento há ${semVisita} dias` : 'Nenhum monitoramento desde o plantio'};
  if (c) return {...s('ok'), texto: `${c.dap} dias após o plantio`};
  return {...s('vazio'), texto: 'Sem plantio em andamento'};
}
const chipSituacao = f => { const s = situacaoTalhao(f); return `<span class="chip sit-${s.cor}" title="${esc(s.texto)}">${esc(s.rotulo)}</span>`; };

// ---------- Mapa da fazenda (sem internet: desenho dos contornos medidos por GPS) ----------
function mapaTalhoes(fs = db.fields) {
  const com = fs.filter(f => f.contorno?.pontos?.length > 2), sem = fs.filter(f => !(f.contorno?.pontos?.length > 2));
  let svg = '';
  if (com.length) {
    const todos = com.flatMap(f => f.contorno.pontos), lat0 = todos.reduce((s, p) => s + p[0], 0) / todos.length;
    const R = 6378137, rd = g => g * Math.PI / 180, xy = ([la, lo]) => [rd(lo) * R * Math.cos(rd(lat0)), -rd(la) * R];
    const pts = todos.map(xy), minx = Math.min(...pts.map(p => p[0])), miny = Math.min(...pts.map(p => p[1]));
    const w = Math.max(1, Math.max(...pts.map(p => p[0])) - minx), h = Math.max(1, Math.max(...pts.map(p => p[1])) - miny);
    const L = 1000, k = (L - 40) / w, H = Math.max(260, Math.min(900, h * k + 40)), k2 = Math.min(k, (H - 40) / h);
    const P = p => { const [x, y] = xy(p); return [20 + (x - minx) * k2, 20 + (y - miny) * k2]; };
    svg = `<svg class="mapa-faz" viewBox="0 0 ${L} ${H.toFixed(0)}" role="img" aria-label="Mapa dos talhões">${com.map(f => {
      const s = situacaoTalhao(f), q = f.contorno.pontos.map(P), cx = q.reduce((a, p) => a + p[0], 0) / q.length, cy = q.reduce((a, p) => a + p[1], 0) / q.length;
      return `<g class="mapa-t sit-${s.cor}" data-act="nav" data-id="talhao/${esc(f.id)}" tabindex="0"><title>${esc(f.name)} — ${esc(s.rotulo)}: ${esc(s.texto)}</title><polygon points="${q.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/><text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${esc(f.name)}</text></g>`;
    }).join('')}</svg>`;
  }
  const blocos = sem.length ? `<div class="mapa-sem">${com.length ? '<small>Sem contorno medido:</small>' : ''}<div class="mapa-blocos">${sem.map(f => { const s = situacaoTalhao(f); return `<button type="button" class="mapa-bloco sit-${s.cor}" data-act="nav" data-id="talhao/${esc(f.id)}" title="${esc(s.texto)}"><b>${esc(f.name)}</b><small>${esc(s.rotulo)}</small><small>${num(f.area)} ha</small></button>`; }).join('')}</div></div>` : '';
  const cont = {}; fs.forEach(f => { const c = situacaoTalhao(f).chave; cont[c] = (cont[c] || 0) + 1; });
  const legenda = `<div class="mapa-leg">${Object.entries(SITUACOES).filter(([k]) => cont[k]).map(([k, [cor, nome]]) => `<span><i class="sit-${cor}"></i>${esc(nome)} (${cont[k]})</span>`).join('')}</div>`;
  return `<section class="card panel mapa-card">${legenda}${svg}${blocos}${!com.length && sem.length ? '<p class="nota">Meça o contorno dos talhões pelo GPS (Talhões → talhão → Contorno) para vê-los no mapa.</p>' : ''}</section>`;
}

// Talhões: alternar Lista | Mapa
const modoTalhoes = () => safeStorage.get('agro-talhoes-modo') === 'mapa' ? 'mapa' : 'lista';
const talhoesSemMapa = VIEWS.talhoes;
VIEWS.talhoes = (...a) => {
  if (!db.fields.length) return talhoesSemMapa(...a);
  const html = talhoesSemMapa(...a), i = html.indexOf('</section>') + '</section>'.length, modo = modoTalhoes();
  const alternar = `<div class="filters seg-modo">${[['lista', 'Lista'], ['mapa', 'Mapa por situação']].map(([m, n]) => `<button class="${modo === m ? 'active' : ''}" data-act="talhoes-modo" data-id="${m}">${n}</button>`).join('')}</div>`;
  return html.slice(0, i) + alternar + (modo === 'mapa' ? mapaTalhoes() : html.slice(i));
};
ACTIONS['talhoes-modo'] = m => { safeStorage.set('agro-talhoes-modo', m); render(); };

// ---------- Linha do tempo da safra ----------
function linhaDoTempo(f, ini, fim) {
  const c = typeof cicloTalhao === 'function' ? cicloTalhao(f) : null;
  ini = ini || (c ? f.plantingDate : daysAgo(180)); fim = fim || (c?.colheita && c.colheita > today() ? c.colheita : today());
  if (fim <= ini) return '';
  const no = d => d && d >= ini && d <= fim, total = diasEntreAuto(ini, fim) || 1, x = d => 140 + diasEntreAuto(ini, d) / total * 840;
  const faixas = [
    ['Operações', db.operations.filter(o => o.fieldId === f.id && no(o.date) && o.status !== 'Cancelada').map(o => ({d: o.date, cor: o.type === 'Plantio' ? 'green' : o.type === 'Colheita' ? 'blue' : 'gray', t: `${o.type} — ${fmtDate(o.date)}${o.status !== 'Concluída' ? ' (' + o.status.toLowerCase() + ')' : ''}`}))],
    ['Aplicações', db.aplicacoes.filter(a => a.fieldId === f.id && no(a.date)).map(a => ({d: a.date, cor: 'purple', t: `${a.produto} — ${fmtDate(a.date)} • carência ${num(a.carencia)} dias`, ate: addDias(a.date, Number(a.carencia) || 0)}))],
    ['Monitoramento', db.monitoramentos.filter(m => m.fieldId === f.id && no(m.date)).map(m => ({d: m.date, cor: typeof atingiuNivel === 'function' && atingiuNivel(m) ? 'red' : 'orange', t: `${m.alvo}: ${num(m.valor, 2)} ${m.unidade || ''} — ${fmtDate(m.date)}`}))],
    ['Colheita', db.colheitas.filter(h => h.fieldId === f.id && no(h.date)).map(h => ({d: h.date, cor: 'blue', t: `Colheita — ${fmtDate(h.date)}${h.kg ? ' • ' + num(h.kg / (typeof KG_SACA_GRAO !== 'undefined' ? KG_SACA_GRAO : 60), 0) + ' sc' : ''}`}))]];
  const chuvas = db.chuvas.filter(ch => (ch.fieldId === f.id || !ch.fieldId) && no(ch.date) && Number(ch.mm) >= 15);
  if (!faixas.some(([, ev]) => ev.length) && !chuvas.length) return '';
  const meses = []; const d0 = new Date(ini + 'T12:00:00'); d0.setDate(1); d0.setMonth(d0.getMonth() + 1);
  for (const d = d0; isoDate(d) <= fim; d.setMonth(d.getMonth() + 1)) meses.push(isoDate(d));
  const altura = 34 + faixas.length * 34 + 30, hoje = today();
  const svgT = `<svg class="tl-svg" viewBox="0 0 1000 ${altura}" role="img" aria-label="Linha do tempo da safra de ${esc(f.name)}">
    ${meses.map(m => `<line class="tl-mes" x1="${x(m).toFixed(1)}" x2="${x(m).toFixed(1)}" y1="22" y2="${altura - 22}"/><text class="tl-rot" x="${x(m).toFixed(1)}" y="14">${MESES_TL[Number(m.slice(5, 7)) - 1]}</text>`).join('')}
    ${chuvas.map(ch => `<g><title>Chuva de ${num(ch.mm, 0)} mm — ${fmtDate(ch.date)}</title><rect class="tl-chuva" x="${(x(ch.date) - 1.5).toFixed(1)}" y="22" width="3" height="${Math.min(30, Number(ch.mm) / 3).toFixed(1)}"/></g>`).join('')}
    ${faixas.map(([nome, ev], k) => { const y = 44 + k * 34; return `<text class="tl-faixa" x="0" y="${y + 4}">${nome}</text><line class="tl-base" x1="140" x2="980" y1="${y}" y2="${y}"/>${ev.map(e => `<g><title>${esc(e.t)}</title>${e.ate && e.ate > e.d ? `<line class="tl-car" x1="${x(e.d).toFixed(1)}" x2="${Math.min(980, x(e.ate > fim ? fim : e.ate)).toFixed(1)}" y1="${y}" y2="${y}"/>` : ''}<circle class="tl-pt sit-${e.cor}" cx="${x(e.d).toFixed(1)}" cy="${y}" r="7"/></g>`).join('')}`; }).join('')}
    ${no(hoje) ? `<line class="tl-hoje" x1="${x(hoje).toFixed(1)}" x2="${x(hoje).toFixed(1)}" y1="20" y2="${altura - 18}"/><text class="tl-rot tl-hoje-t" x="${x(hoje).toFixed(1)}" y="${altura - 4}">hoje</text>` : ''}
    ${c?.colheita && no(c.colheita) && c.colheita > hoje ? `<text class="tl-rot" x="${Math.min(x(c.colheita), 990).toFixed(1)}" y="${altura - 4}" style="text-anchor:end">colheita prevista</text>` : ''}
  </svg>`;
  return `<section class="card panel tl-card"><div class="section-title" style="margin:0 0 6px"><h3>Linha do tempo da safra</h3><small class="nota">${fmtDate(ini)} a ${fmtDate(fim)}</small></div><div class="tl-wrap">${svgT}</div>
    <div class="mapa-leg"><span><i class="sit-green"></i>Plantio</span><span><i class="sit-gray"></i>Outras operações</span><span><i class="sit-purple"></i>Aplicação (traço = carência)</span><span><i class="sit-orange"></i>Monitoramento</span><span><i class="sit-red"></i>No nível de ação</span><span><i class="sit-blue"></i>Colheita</span><span><i class="tl-chuva-leg"></i>Chuva ≥ 15 mm</span></div></section>`;
}
const MESES_TL = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------- Cartão do talhão: tudo do agrônomo num lugar ----------
function resumoAgronomico(f) {
  const s = situacaoTalhao(f), c = typeof cicloTalhao === 'function' ? cicloTalhao(f) : null;
  const ap = db.aplicacoes.filter(a => a.fieldId === f.id).sort(byDateDesc)[0], lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(f.id) : null;
  const mon = db.monitoramentos.filter(m => m.fieldId === f.id).sort(byDateDesc)[0];
  const prod = typeof safrasConhecidas === 'function' && typeof analiseSafra === 'function' ? safrasConhecidas().slice(0, 4).map(sf => { const l = analiseSafra(sf).linhas.find(x => (x.fieldId || x.id) === f.id || x.nome === f.name); return l && l.sacas > 0 ? {sf, scha: l.scha} : null; }).filter(Boolean) : [];
  const caixa = (titulo, valor, detalhe = '') => `<div class="ag-caixa"><small>${titulo}</small><b>${valor}</b>${detalhe ? `<small>${detalhe}</small>` : ''}</div>`;
  return `<section class="card panel ag-resumo"><div class="ag-topo"><span class="chip sit-${s.cor}">${esc(s.rotulo)}</span><span class="nota">${esc(s.texto)}</span></div>
    <div class="ag-grade">
      ${caixa('Cultura e estágio', esc(f.crop || '—'), c ? `${c.dap} dias após o plantio${c.colheita ? ` • colheita ~${fmtDate(c.colheita)}` : ''}` : f.plantingDate ? 'Plantio em ' + fmtDate(f.plantingDate) : 'Sem plantio informado')}
      ${caixa('Última aplicação', ap ? esc(ap.produto) : '—', ap ? `${fmtDate(ap.date)}${lib && lib.libera > today() ? ` • carência até ${fmtDate(lib.libera)}` : ' • colheita liberada'}` : 'Nenhuma registrada')}
      ${caixa('Último monitoramento', mon ? esc(mon.alvo) : '—', mon ? `${num(mon.valor, 2)} ${esc(mon.unidade || '')} • ${fmtDate(mon.date)}${typeof atingiuNivel === 'function' && atingiuNivel(mon) ? ' • <b class="txt-red">nível de ação</b>' : ''}` : 'Nenhum registrado')}
      ${caixa('Chuva desde o plantio', c ? `${num(c.mm, 0)} mm` : '—', c ? 'Pluviômetro do talhão ou da sede' : '')}
      ${caixa('Produtividade', prod.length ? `${um1(prod[0].scha)} sc/ha` : '—', prod.length ? prod.map(p => `${esc(p.sf)}: ${um1(p.scha)}`).join(' • ') : 'Sem colheita registrada')}
    </div>${mon && typeof galeriaFotos === 'function' ? galeriaFotos('monitoramentos', mon) : ''}</section>`;
}
const talhaoSemResumo = VIEWS.talhao;
VIEWS.talhao = id => {
  const html = talhaoSemResumo(id), f = find('fields', id); if (!f) return html;
  const i = html.indexOf('</section>') + '</section>'.length;
  return html.slice(0, i) + resumoAgronomico(f) + linhaDoTempo(f) + html.slice(i);
};
// Relatório da safra: linha do tempo do período do relatório
if (VIEWS.safra) {
  const safraSemLinha = VIEWS.safra;
  VIEWS.safra = id => {
    const html = safraSemLinha(id), f = find('fields', id); if (!f || typeof periodoSafra !== 'function') return html;
    const p = periodoSafra(f), i = html.indexOf('</header>', html.indexOf('class="card panel relatorio"'));
    return i < 0 ? html : html.slice(0, i + 9) + linhaDoTempo(f, p.ini, p.fim > today() ? today() : p.fim).replace('card panel tl-card', 'tl-card tl-rel') + html.slice(i + 9);
  };
}

// ---------- Relatórios impressos com cara de documento ----------
function cabecalhoImpressao() {
  const s = db.settings, agora = new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'});
  return `<div class="print-cab"><div><b class="print-marca">NEXUS<span>AGRO</span></b><small>${esc(s.farm || 'Propriedade')}${s.owner ? ' • ' + esc(s.owner) : ''}</small></div><div class="print-dir">${s.respTecnico ? `<small>Responsável técnico: <b>${esc(s.respTecnico)}</b>${s.respRegistro ? ' — ' + esc(s.respRegistro) : ''}</small>` : ''}<small>Emitido em ${esc(agora)}</small></div></div>`;
}
const assinaturasImpressao = () => { const s = db.settings; return `<div class="print-assin"><div><span></span><small>${esc(s.respTecnico || 'Responsável técnico')}${s.respRegistro ? ' — ' + esc(s.respRegistro) : ''}</small></div><div><span></span><small>${esc(s.owner || 'Produtor / responsável')}</small></div></div>`; };
function prepararImpressao(raiz = document) {
  raiz.querySelectorAll('.relatorio:not([data-print])').forEach(r => {
    r.dataset.print = '1'; r.insertAdjacentHTML('afterbegin', cabecalhoImpressao());
    if (!r.querySelector('.insp-assinatura')) r.insertAdjacentHTML('beforeend', assinaturasImpressao());
  });
}

// ---------- Tela inicial conforme a função ----------
const FUNCOES_TALHAO = ['agronomo', 'monitor', 'encarregado'], FUNCOES_CAMPO = ['operador', 'aplicador', 'abastecedor', 'mecanico', 'monitor', 'encarregado', 'secador', 'classificador', 'almoxarife'];
const funcaoAtual = () => typeof nv !== 'undefined' && nv?.funcao || '';
const inicioSemFuncao = VIEWS.inicio, inicioAfter = VIEWS.inicio.after;
VIEWS.inicio = (...a) => {
  // Equipe de campo: a lista do dia já vem aberta (é o que eles usam), a menos que a pessoa tenha fechado
  if (FUNCOES_CAMPO.includes(funcaoAtual()) && safeStorage.get('agro-hoje-aberto') == null) safeStorage.set('agro-hoje-aberto', '1');
  const html = inicioSemFuncao(...a);
  if (!FUNCOES_TALHAO.includes(funcaoAtual()) || !db.fields.length) return html;
  // Agrônomo, monitor e encarregado: situação dos talhões logo depois do “Hoje”
  const fim = html.indexOf('<!--fim-hoje-->'), i = fim >= 0 ? fim : html.indexOf('</section>', html.indexOf('class="hoje"')) + '</section>'.length;
  return html.slice(0, i) + `<div class="section-title"><h3>Situação dos talhões</h3><button data-act="nav" data-id="talhoes">Ver talhões</button></div>` + mapaTalhoes() + html.slice(i);
};
VIEWS.inicio.after = inicioAfter;

const renderSemAgro = render;
render = function (...a) { const r = renderSemAgro.apply(this, a); prepararImpressao(document); return r; };
