// ---------- Conferência das operações ----------
// O dono/responsável confere de longe se a operação foi feita, onde e como:
// localização (GPS) no início e na conclusão comparada com o contorno do talhão, hora real, horímetro × relógio,
// fotos tiradas na hora com carimbo (data, hora, local, quem) e a situação “A conferir” → Aprovar ou Pedir correção.
// Vale para o que o usuário comum (operador) conclui; o que o ADM/supervisor conclui não precisa de conferência.
const CONF_FOTO_PADRAO = ['Plantio', 'Aplicação', 'Limpeza de secador', 'Limpeza de moega', 'Limpeza de silo', 'Tratamento de sementes'];
const confAjustes = () => { const c = db.settings.conferencia || {}; return {exigir: c.exigir !== false, fotos: Array.isArray(c.fotos) ? c.fotos : CONF_FOTO_PADRAO, fotoInicio: c.fotoInicio !== false}; };
const confOperador = () => typeof nvComum === 'function' && nvComum(); // usuário comum ligado a uma fazenda
const confGestor = () => !confOperador();
const confUsuario = () => (typeof nv !== 'undefined' && nv?.sessao?.usuario) || '';
const confNome = id => !id ? '' : id === confUsuario() ? 'você' : (typeof nv !== 'undefined' && nv?.nomes?.[id]) || 'outro usuário';
const confPrecisaFoto = o => confAjustes().fotos.includes(o?.type);
const confSituacao = o => o?.conferencia?.situacao || '';
const confPendentes = () => db.operations.filter(o => o.status === 'Concluída' && confSituacao(o) === 'pendente').sort((a, b) => String(a.finishedAt || a.date).localeCompare(String(b.finishedAt || b.date)));

// ---------- Localização ----------
const confGpsTemp = new Map(); // operação → posição lida ao abrir a conclusão
function confPosicao(timeout = 15000) {
  // Leitura nova (comprovação); se o GPS não responder a tempo, aceita a última posição de até 2 min (marcada como “aproximada”)
  const ler = (opc) => new Promise(ok => {
    const em = new Date().toISOString();
    if (!navigator.geolocation) return ok({erro: 'Aparelho sem GPS', em});
    try {
      navigator.geolocation.getCurrentPosition(p => ok({lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), prec: Math.round(p.coords.accuracy || 0), em}),
        e => ok({erro: e.code === 1 ? 'Localização negada no aparelho' : 'Sem sinal de GPS', codigo: e.code, em}), opc);
    } catch { ok({erro: 'GPS indisponível', em}); }
  });
  return ler({enableHighAccuracy: true, timeout, maximumAge: 0}).then(g => g.erro && g.codigo !== 1 ? ler({enableHighAccuracy: false, timeout: 4000, maximumAge: 120000}).then(g2 => g2.erro ? g : {...g2, aproximada: true}) : g)
    .then(g => { delete g.codigo; return g; });
}
// Distância em metros (aproximação plana, ótima para distâncias de fazenda)
function confXY(p, ref) { const R = 6371000, k = Math.PI / 180; return [(p[1] - ref[1]) * k * R * Math.cos(ref[0] * k), (p[0] - ref[0]) * k * R]; }
function confDentro(lat, lon, pts) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}
function confDistContorno(lat, lon, pts) {
  const ref = [lat, lon]; let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = confXY(pts[i], ref), [bx, by] = confXY(pts[(i + 1) % pts.length], ref), dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}
const confDist = m => m >= 1000 ? `${num(m / 1000, 1)} km` : `${num(Math.round(m))} m`;
// Selo de uma posição: no talhão / na divisa / fora (com a distância) / só registrada (sem contorno para comparar)
function confSeloGps(o, g) {
  if (!g) return null;
  if (g.erro) return {cor: 'orange', txt: g.erro};
  const pts = o.fieldId ? find('fields', o.fieldId)?.contorno?.pontos : null;
  if (pts?.length > 2) {
    if (confDentro(g.lat, g.lon, pts)) return {cor: 'green', txt: 'no talhão'};
    const d = confDistContorno(g.lat, g.lon, pts);
    if (d <= Math.max(60, g.prec || 0)) return {cor: 'green', txt: 'na divisa do talhão'};
    return {cor: 'red', txt: `fora do talhão (${confDist(d)})`, fora: true};
  }
  return {cor: 'blue', txt: o.fieldId ? 'local registrado (talhão sem contorno)' : 'local registrado'};
}
const confMapa = g => g && !g.erro ? `https://www.google.com/maps?q=${g.lat},${g.lon}` : '';
const confHoraLocal = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

// ---------- Ganchos do iniciar / concluir / editar ----------
// Fotos de cada etapa: as do início ficam marcadas (etapa: 'inicio'); as da conclusão não
const confFotosEtapa = (o, etapa) => (o.fotos || []).filter(f => etapa === 'inicio' ? f.etapa === 'inicio' : f.etapa !== 'inicio');
const confQtdFotos = (o, etapa) => confFotosEtapa(o, etapa).length + ((typeof fotosDoForm !== 'undefined' && fotosDoForm.get(o.id)?.length) || 0);
const confFotoInicioObrig = () => confAjustes().fotoInicio;
// Abre a etapa (iniciar ou concluir): lê o GPS na hora e põe o campo de fotos tiradas pela câmera, com carimbo
function confAbrirEtapa(o, etapa) {
  const form = $('form', dialog); if (!form) return;
  const ini = etapa === 'inicio', obrig = ini ? confFotoInicioObrig() : confOperador() && confPrecisaFoto(o);
  const status = Object.assign(document.createElement('p'), {className: 'nota conf-gps', textContent: '📍 Lendo a localização…'});
  (form.querySelector('.form') || form).prepend(status);
  confGpsTemp.delete(o.id);
  confPosicao().then(g => {
    confGpsTemp.set(o.id, g);
    const s = confSeloGps(o, g);
    status.textContent = g.erro ? `⚠ ${g.erro}: a operação fica marcada “sem localização”.` : `📍 Localização registrada${g.prec ? ` (± ${num(g.prec)} m)` : ''}${s && o.fieldId && !/registrado/.test(s.txt) ? ' — ' + s.txt : ''}.`;
    status.classList.toggle('conf-ruim', !!(g.erro || s?.fora));
  });
  if (typeof anexarCampoFotos === 'function') {
    carimbosFoto.set(o.id, () => {
      const g = confGpsTemp.get(o.id), quem = confUsuario() ? (nv?.nomes?.[confUsuario()] || nv?.sessao?.email || '') : '';
      const h = $('#f_horimetro', dialog)?.value;
      return [`${confHoraLocal(new Date().toISOString())} • ${ini ? 'INÍCIO' : 'CONCLUSÃO'} • ${o.type} — ${opPlace(o)}`,
        [g && !g.erro ? `${g.lat}, ${g.lon} (± ${g.prec} m)` : 'sem GPS', h ? `horímetro ${h} h` : '', quem || o.operator || ''].filter(Boolean).join(' • ') + ' • MercaPlant'];
    });
    anexarCampoFotos('operations', o.id, confFotosEtapa(o, etapa), {soCamera: true, obrigatoria: obrig, rotulo: ini ? 'Foto do início' : 'Fotos de comprovação',
      dica: ini ? 'Tire agora pela câmera: de preferência o painel com o horímetro e a máquina no local. Sai com data, hora, local e nome gravados.' : 'Tire a foto agora pela câmera: ela sai com data, hora, local e nome gravados.'});
  }
}
const confAoAbrirInicio = o => confAbrirEtapa(o, 'inicio');
const confAoAbrirConclusao = o => confAbrirEtapa(o, 'fim');
function confValidarInicio(o) {
  if (confFotoInicioObrig() && !confQtdFotos(o, 'inicio')) return 'Tire a foto do início (de preferência do painel com o horímetro).';
  return '';
}
function confValidarConclusao(o) {
  if (confOperador() && confPrecisaFoto(o) && !confQtdFotos(o, 'fim')) return `Tire pelo menos uma foto de comprovação (${o.type.toLowerCase()} exige foto).`;
  return '';
}
// Salvou o início: fotos marcadas como do início, GPS e quem iniciou
function confAoIniciar(o) {
  const antes = new Set((o.fotos || []).map(f => f.id));
  if (typeof fotosAoSalvar === 'function') fotosAoSalvar('operations', o.id);
  (o.fotos || []).forEach(f => { if (!antes.has(f.id)) f.etapa = 'inicio'; });
  carimbosFoto?.delete?.(o.id);
  o.iniciadaPor = confUsuario() || o.iniciadaPor || ''; o.viaIniciar = true;
  const g = confGpsTemp.get(o.id); confGpsTemp.delete(o.id);
  if (g) o.gpsIni = g;
  else { delete o.gpsIni; confPosicao(8000).then(p => { const r = find('operations', o.id); if (r) { r.gpsIni = p; save(); } }); }
}
function confAoConcluir(o) {
  if (typeof fotosAoSalvar === 'function') fotosAoSalvar('operations', o.id);
  carimbosFoto?.delete?.(o.id);
  o.concluidaPor = confUsuario() || '';
  o.viaConcluir = true;
  const g = confGpsTemp.get(o.id); confGpsTemp.delete(o.id);
  if (g) o.gpsFim = g;
  else { o.gpsFim = {erro: 'Localização não lida a tempo', em: new Date().toISOString()}; confPosicao(8000).then(p => { const r = find('operations', o.id); if (r && !p.erro) { r.gpsFim = p; save(); } }); }
  // Usuário comum (operador) concluiu: vai para a conferência do responsável
  if (confOperador() && confAjustes().exigir) {
    if (o.conferencia?.situacao === 'correcao') (o.conferenciaHist = o.conferenciaHist || []).push(o.conferencia);
    o.conferencia = {situacao: 'pendente', em: new Date().toISOString()};
  }
}
// Editar: o operador não conclui pelo formulário (sem localização nem fotos); operação aprovada só o responsável altera
function confValidarEdicao(op, v) {
  if (confOperador() && confAjustes().exigir && v.status === 'Concluída' && op.status !== 'Concluída')
    return 'Para concluir, salve como “Em andamento” e toque em ✓ Concluir na lista: ele registra a localização e as fotos de comprovação.';
  return '';
}
const confTravada = op => op?.id && confOperador() && confSituacao(op) === 'aprovada' ? 'Operação já conferida e aprovada pelo responsável: só ele pode alterar.' : '';

// ---------- O que não fecha (alertas da conferência) ----------
function confAlertas(o) {
  const out = [];
  const sIni = confSeloGps(o, o.gpsIni), sFim = confSeloGps(o, o.gpsFim);
  if (sFim?.fora) out.push(['red', `Concluída ${sFim.txt}`]);
  if (sIni?.fora) out.push(['red', `Iniciada ${sIni.txt}`]);
  if (o.viaConcluir && (!o.gpsFim || o.gpsFim.erro)) out.push(['orange', 'Sem localização na conclusão']);
  if (o.conferencia && !o.viaConcluir && o.status === 'Concluída') out.push(['orange', 'Concluída pela edição, sem localização nem fotos de comprovação']);
  if (o.conferencia && confPrecisaFoto(o) && !confFotosEtapa(o, 'fim').length) out.push(['red', 'Sem foto de comprovação na conclusão']);
  if (o.viaIniciar && !confFotosEtapa(o, 'inicio').length) out.push(['orange', 'Sem foto do início']);
  const ini = Date.parse(o.startedAt), fim = Date.parse(o.finishedAt), relogio = ini && fim && fim > ini ? (fim - ini) / 3600000 : null;
  if (relogio != null && Number(o.horas) > relogio + 0.5) out.push(['red', `Horímetro marcou ${um1(o.horas)} h, mas entre iniciar e concluir passaram só ${um1(relogio)} h`]);
  if (relogio != null && relogio < 0.1 && Number(o.area) > 0 && opTemArea(o)) out.push(['orange', `Concluída ${Math.max(1, Math.round(relogio * 60))} min depois de iniciar, com ${num(o.area)} ha`]);
  if (!o.startedAt && o.viaConcluir) out.push(['orange', 'Não foi iniciada pelo app (sem hora de início)']);
  if (Number(o.horas) > 0 && Number(o.area) > 0 && opTemArea(o) && o.machineId && typeof rendimentoMaquina === 'function') {
    const r = rendimentoMaquina(o.machineId, o.type), taxa = o.area / o.horas;
    if (r && r.n >= 3 && taxa > r.porHora * 1.8) out.push(['orange', `${um1(taxa)} ha/h: bem acima do normal desta máquina (${um1(r.porHora)} ha/h)`]);
  }
  const f = o.fieldId ? find('fields', o.fieldId) : null;
  if (f && Number(f.area) > 0 && Number(o.area) > Number(f.area) * 1.05 && opTemArea(o)) out.push(['orange', `Área lançada (${num(o.area)} ha) maior que o talhão (${num(f.area)} ha)`]);
  return out;
}

// ---------- Selos na lista de operações ----------
function confSelos(o) {
  const s = [], sit = confSituacao(o);
  if (sit === 'pendente') s.push(`<button class="chip orange conf-chip" data-act="conf-ver" data-id="${esc(o.id)}">A conferir</button>`);
  if (sit === 'aprovada') s.push(`<button class="chip green conf-chip" data-act="conf-ver" data-id="${esc(o.id)}">✓ Conferida</button>`);
  if (sit === 'correcao') s.push(`<button class="chip red conf-chip" data-act="conf-ver" data-id="${esc(o.id)}">↩ Correção pedida</button>`);
  const g = o.status === 'Concluída' ? o.gpsFim : o.gpsIni, sg = confSeloGps(o, g);
  if (sg) s.push(`<span class="conf-selo ${sg.cor}">📍 ${esc(sg.txt)}</span>`);
  if (o.fotos?.length) s.push(`<span class="conf-selo">📷 ${o.fotos.length}</span>`);
  if (sit === 'correcao' && o.conferencia.obs) s.push(`<span class="conf-selo red">“${esc(o.conferencia.obs)}”</span>`);
  return s.length ? `<div class="conf-selos">${s.join('')}</div>` : '';
}
const linhaOpSemConferencia = operationRow;
operationRow = function (o, actions = true) {
  const h = linhaOpSemConferencia(o, actions), s = confSelos(o);
  return s ? h.replace('</small></div>', `</small>${s}</div>`) : h;
};

// ---------- Tela de conferência ----------
let confFiltro = 'pendentes';
function confLinhaGps(rotulo, o, g, iso) {
  const s = confSeloGps(o, g), mapa = confMapa(g);
  return `<div class="conf-linha"><span>${esc(rotulo)}</span><div><strong>${esc(confHoraLocal(iso) || '—')}</strong>${s ? ` <span class="conf-selo ${s.cor}">📍 ${esc(s.txt)}${g && !g.erro && g.prec ? ` ± ${num(g.prec)} m` : ''}</span>` : iso ? ' <span class="conf-selo">sem localização</span>' : ''}${mapa ? ` <a href="${mapa}" target="_blank" rel="noopener">ver no mapa</a>` : ''}</div></div>`;
}
function confCartao(o) {
  const sit = confSituacao(o), al = o.status === 'Concluída' ? confAlertas(o) : [];
  const ini = Date.parse(o.startedAt), fim = Date.parse(o.finishedAt), relogio = ini && fim && fim > ini ? (fim - ini) / 3600000 : null;
  const quem = [o.operator, o.concluidaPor ? 'concluída por ' + confNome(o.concluidaPor) : ''].filter(Boolean).join(' • ');
  const numeros = [relogio != null ? `${um1(relogio)} h no relógio` : '', Number(o.horas) > 0 ? `${um1(o.horas)} h no horímetro${o.horimetroIni != null && o.horimetroFim != null ? ` (${num(o.horimetroIni)} → ${num(o.horimetroFim)})` : ''}` : '',
    Number(o.area) > 0 && opTemArea(o) ? `${num(o.area)} ha${Number(o.horas) > 0 ? ` • ${um1(o.area / o.horas)} ha/h` : ''}` : '', Number(o.kg) > 0 ? `${num(o.kg)} kg` : ''].filter(Boolean).join(' • ');
  const chipSit = sit === 'pendente' ? chip('A conferir', 'orange') : sit === 'aprovada' ? chip('✓ Conferida', 'green') : sit === 'correcao' ? chip('↩ Correção pedida', 'red') : chip(o.status, STATUS_COLOR[o.status]);
  return `<article class="card panel conf-cartao" id="conf-${esc(o.id)}">
    <div class="conf-topo"><div><h3>${esc(o.type)} — ${esc(opPlace(o))}</h3><p class="nota">${esc([fmtDate(o.date), [machineName(o.machineId), machineName(o.implementoId)].filter(Boolean).join(' + '), quem].filter(Boolean).join(' • '))}</p></div>${chipSit}</div>
    ${confLinhaGps('Início', o, o.gpsIni, o.startedAt)}
    ${confLinhaGps('Conclusão', o, o.gpsFim, o.finishedAt)}
    ${numeros ? `<div class="conf-linha"><span>Números</span><div>${esc(numeros)}</div></div>` : ''}
    ${o.notes ? `<div class="conf-linha"><span>Observações</span><div>${esc(o.notes)}</div></div>` : ''}
    ${[['inicio', 'Fotos do início'], ['fim', 'Fotos da conclusão']].map(([e, r]) => { const fs = confFotosEtapa(o, e); return `<div class="conf-linha"><span>${r}</span><div>${fs.length ? galeriaFotos('operations', {id: o.id, fotos: fs}) : '<span class="nota">Nenhuma foto</span>'}</div></div>`; }).join('')}
    ${o.status === 'Concluída' ? `<div class="conf-alertas">${al.length ? al.map(([c, t]) => `<div class="conf-al ${c}">${c === 'red' ? '⚠' : '!'} ${esc(t)}</div>`).join('') : '<div class="conf-al green">✓ Nada fora do normal: local, horário e números conferem.</div>'}</div>` : ''}
    ${o.conferencia && sit !== 'pendente' ? `<p class="nota">${sit === 'aprovada' ? 'Aprovada' : 'Correção pedida'} por ${esc(confNome(o.conferencia.por))} em ${esc(confHoraLocal(o.conferencia.em))}${o.conferencia.obs ? `: “${esc(o.conferencia.obs)}”` : ''}</p>` : ''}
    ${(o.conferenciaHist || []).map(h => `<p class="nota">Antes: correção pedida em ${esc(confHoraLocal(h.em))}${h.obs ? `: “${esc(h.obs)}”` : ''}</p>`).join('')}
    ${confGestor() && sit === 'pendente' ? `<div class="actions">${mini('↩ Pedir correção', 'conf-corrigir', o.id, 'secondary')}${mini('✓ Aprovar', 'conf-aprovar', o.id, 'primary')}</div>` : ''}
    ${confGestor() && sit === 'aprovada' ? `<div class="actions">${mini('Desfazer aprovação', 'conf-reabrir', o.id, 'secondary')}</div>` : ''}
  </article>`;
}
function confPainelAjustes() {
  const a = confAjustes();
  return `<details class="card panel conf-ajustes"><summary><strong>Regras da conferência</strong> <span class="nota">${a.exigir ? 'ligada' : 'desligada'} • foto ao iniciar ${confFotoInicioObrig() ? 'obrigatória' : 'opcional'} • ao concluir em ${a.fotos.length} ${a.fotos.length === 1 ? 'tipo' : 'tipos'}</span></summary>
    <div class="conf-linha"><span>Conferir o que o operador conclui</span><div><button class="${a.exigir ? 'primary' : 'secondary'}" data-act="conf-exigir">${a.exigir ? 'Ligado' : 'Desligado'}</button></div></div>
    <div class="conf-linha"><span>Foto obrigatória ao iniciar</span><div><button class="${confFotoInicioObrig() ? 'primary' : 'secondary'}" data-act="conf-foto-inicio">${confFotoInicioObrig() ? 'Ligado' : 'Desligado'}</button></div></div>
    <p class="nota">Foto de comprovação obrigatória ao concluir (toque para ligar ou desligar):</p>
    <div class="conf-tipos">${OP_TYPES.map(t => `<button class="chip ${a.fotos.includes(t) ? 'green' : 'gray'}" data-act="conf-foto" data-id="${esc(t)}">${a.fotos.includes(t) ? '📷 ' : ''}${esc(t)}</button>`).join('')}</div>
  </details>`;
}
VIEWS.conferencia = arg => {
  const um = arg && find('operations', arg);
  if (um) return head('Conferência', `${um.type} — ${opPlace(um)}`, btn('← Conferência', 'nav', 'conferencia', 'secondary') + btn('Operações', 'nav', 'operacoes', 'secondary')) + confCartao(um);
  const pend = confPendentes(), desde = addDias(today(), -30);
  const conferidas = db.operations.filter(o => ['aprovada', 'correcao'].includes(confSituacao(o)) && String(o.conferencia.em || '').slice(0, 10) >= desde).sort((a, b) => String(b.conferencia.em).localeCompare(String(a.conferencia.em)));
  const lista = confFiltro === 'pendentes' ? pend : conferidas;
  return head('Conferência das operações', 'Confira de longe: local, horário, números e fotos do que o operador concluiu.', btn('Operações', 'nav', 'operacoes', 'secondary')) +
    (confGestor() ? confPainelAjustes() : '') +
    `<div class="filters"><button class="${confFiltro === 'pendentes' ? 'active' : ''}" data-act="conf-filtro" data-id="pendentes">A conferir (${pend.length})</button><button class="${confFiltro === 'conferidas' ? 'active' : ''}" data-act="conf-filtro" data-id="conferidas">Conferidas — 30 dias (${conferidas.length})</button></div>` +
    (lista.length ? lista.map(confCartao).join('') : `<section class="card">${empty(confFiltro === 'pendentes' ? 'Nada a conferir' : 'Nenhuma operação conferida nos últimos 30 dias', confFiltro === 'pendentes' ? 'Quando o operador concluir uma operação, ela aparece aqui com local, horário e fotos.' : '')}</section>`);
};
TITLES.conferencia = 'Conferência';

// Operações: botão da conferência para o responsável
const telaOperacoesSemConf = VIEWS.operacoes;
VIEWS.operacoes = (...a) => {
  const h = telaOperacoesSemConf(...a);
  if (!confGestor()) return h;
  const n = confPendentes().length;
  return h.replace('<div class="btns">', `<div class="btns">${btn(`✓ Conferência${n ? ` (${n})` : ''}`, 'nav', 'conferencia', 'secondary')}`);
};

// ---------- Avisos ----------
const alertasSemConferencia = alerts;
alerts = function () {
  const lista = alertasSemConferencia();
  if (confGestor()) {
    const p = confPendentes();
    if (p.length) lista.unshift({color: p.some(o => confAlertas(o).some(([c]) => c === 'red')) ? 'red' : 'orange', icon: '✓', title: `${p.length} ${p.length === 1 ? 'operação a conferir' : 'operações a conferir'}`,
      text: p.slice(0, 3).map(o => `${o.type} — ${opPlace(o)}${confAlertas(o).length ? ' ⚠' : ''}`).join(' • '), route: 'conferencia'});
  } else {
    const eu = confUsuario();
    db.operations.filter(o => confSituacao(o) === 'correcao' && (!eu || o.concluidaPor === eu || o._por === eu)).forEach(o =>
      lista.unshift({color: 'red', icon: '↩', title: `Correção pedida: ${o.type} — ${opPlace(o)}`, text: o.conferencia.obs || 'Confira e conclua de novo.', route: 'conferencia/' + o.id}));
  }
  return lista;
};

// ---------- Ações ----------
Object.assign(ACTIONS, {
  'conf-ver': id => go('conferencia/' + id),
  'conf-filtro': id => { confFiltro = id; render(); },
  'conf-aprovar': id => {
    if (!confGestor()) return;
    const o = find('operations', id); if (!o) return;
    o.conferencia = {situacao: 'aprovada', por: confUsuario(), em: new Date().toISOString()}; save();
    showToast('Operação aprovada'); render();
  },
  'conf-reabrir': id => {
    if (!confGestor()) return;
    const o = find('operations', id); if (!o) return;
    o.conferencia = {situacao: 'pendente', em: new Date().toISOString()}; save(); render();
  },
  'conf-corrigir': id => {
    if (!confGestor()) return;
    const o = find('operations', id); if (!o) return;
    openForm({title: 'Pedir correção', sub: `${o.type} — ${opPlace(o)}. A operação volta para “Em andamento” e o operador recebe o aviso.`, submit: 'Pedir correção',
      fields: [{k: 'obs', label: 'O que precisa ser corrigido ou refeito?', type: 'textarea', required: true, placeholder: 'Ex.: faltou a foto do tanque; a área não confere com o talhão…'}],
      onSubmit: v => {
        o.conferencia = {situacao: 'correcao', por: confUsuario(), em: new Date().toISOString(), obs: v.obs};
        o.status = 'Em andamento'; save(); showToast('Correção pedida ao operador');
      }});
  },
  'conf-foto-inicio': () => { if (!confGestor()) return; db.settings.conferencia = {...confAjustes(), fotoInicio: !confFotoInicioObrig()}; save(); render(); },
  'conf-exigir': () => { if (!confGestor()) return; const c = db.settings.conferencia = {...confAjustes()}; c.exigir = !c.exigir; save(); render(); },
  'conf-foto': t => {
    if (!confGestor()) return;
    const c = db.settings.conferencia = {...confAjustes()};
    c.fotos = c.fotos.includes(t) ? c.fotos.filter(x => x !== t) : [...c.fotos, t]; save(); render();
  }
});
