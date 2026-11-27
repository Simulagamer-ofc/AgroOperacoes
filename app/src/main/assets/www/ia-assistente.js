'use strict';
/* MercaPlant — Assistente (IA, Gemini pela função ia do servidor).
   Tela "✨ Assistente": a pessoa pergunta em texto (ou pelo microfone, quando o aparelho deixa) e a IA responde com os dados
   da fazenda — talhões, operações, colheitas, chuvas, estoque, máquinas, pragas, sementes, grãos e a previsão do tempo.
   O app monta um resumo só com o que a pessoa já vê no aparelho (o financeiro não vai) e manda junto com a pergunta;
   a chave da IA fica só no servidor. A IA não salva nem muda nada: só responde.
   No MercaClima, "✨ IA do tempo" traz perguntas prontas (pulverizar, plantar, colher, entrar com máquina).
   iaContexto é testada em referencias/tests/ia-assistente.test.js. */
const IA_DIAS_OPS = 60, IA_DIAS_CHUVA = 120;
const iaAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const iaR = (v, c = 1) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** c) / 10 ** c;

/** Resumo da fazenda para a IA (objeto; o app manda em JSON). hoje = AAAA-MM-DD. */
function iaContexto(hoje = today()) {
  const nomeT = id => (typeof fieldName === 'function' ? fieldName(id) : '') || (id ? 'talhão removido' : 'Sede/geral');
  const nomeM = id => (typeof machineName === 'function' ? machineName(id) : '') || '';
  const desde = d => (x => x && x >= iaAdd(hoje, -d));
  const lista = c => Array.isArray(db?.[c]) ? db[c] : [];
  const talhoes = lista('fields').map(f => ({nome: f.name, ha: iaR(f.area, 2), cultura: f.crop || '', cultivar: f.cultivar || '', safra: f.season || '', plantio: f.plantingDate || '', ...(f.parteDe ? {parteDe: f.parteDe.nome} : {})}));
  const ops = lista('operations').filter(o => desde(IA_DIAS_OPS)(o.date) || (o.date >= hoje && o.status !== 'Concluída'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 150)
    .map(o => ({data: o.date, hora: o.time || '', tipo: o.type, talhao: nomeT(o.fieldId), status: o.status, ha: iaR(o.area, 2), maquina: nomeM(o.machineId), ...(o.produto ? {produto: o.produto} : {}), ...(o.notes ? {obs: String(o.notes).slice(0, 80)} : {}),
      ...(o.climaIni ? {tempoInicio: `${o.climaIni.t}°C ${o.climaIni.ur}% vento ${o.climaIni.v}`} : {})}));
  const colheitas = lista('colheitas').slice(-120).map(c => ({talhao: nomeT(c.fieldId), cultura: c.cultura, safra: c.season, data: c.date, kg: iaR(c.kg, 0), sacas60: iaR((Number(c.kg) || 0) / 60, 1), umidade: c.umidade ?? null}));
  // Chuva: registros recentes e somas prontas (a IA não precisa somar)
  const ch = lista('chuvas').filter(c => desde(IA_DIAS_CHUVA)(c.date)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const porDiaSede = {}; ch.forEach(c => { const k = c.date; porDiaSede[k] = Math.max(porDiaSede[k] || 0, Number(c.mm) || 0); }); // um valor por dia (o maior dos locais)
  const somaDias = d => iaR(Object.entries(porDiaSede).filter(([k]) => k >= iaAdd(hoje, -d + 1)).reduce((s, [, v]) => s + v, 0));
  const mes = hoje.slice(0, 7), somaMes = iaR(Object.entries(porDiaSede).filter(([k]) => k.startsWith(mes)).reduce((s, [, v]) => s + v, 0));
  const chuvas = {registros: ch.slice(0, 120).map(c => ({data: c.date, mm: iaR(c.mm), local: nomeT(c.fieldId), fonte: c.fonte || 'pluviômetro'})),
    somas: {ultimos7dias: somaDias(7), ultimos30dias: somaDias(30), ultimos90dias: somaDias(90), esteMes: somaMes, diasSemChuvaDesdeUltima: (() => { const u = Object.keys(porDiaSede).filter(k => porDiaSede[k] >= 1).sort().at(-1); return u ? Math.round((new Date(hoje) - new Date(u)) / 864e5) : null; })()},
    desdePlantio: lista('fields').filter(f => f.plantingDate).map(f => ({talhao: f.name, plantio: f.plantingDate, mm: iaR(Object.entries(porDiaSede).filter(([k]) => k >= f.plantingDate).reduce((s, [, v]) => s + v, 0))}))};
  const estoque = lista('stock').map(s => ({item: s.name, categoria: s.category || '', saldo: iaR(s.qty, 2), unidade: s.unit || '', minimo: iaR(s.min, 2), abaixoDoMinimo: Number(s.min) > 0 && Number(s.qty) < Number(s.min)}));
  const maquinas = lista('machines').map(m => ({nome: m.name, tipo: m.type, modelo: m.model || '', horimetro: iaR(m.hours, 1), proximaRevisao: iaR(m.nextService, 0)}));
  const manutencoes = lista('maintenances').filter(m => m.status !== 'Concluída' || desde(60)(m.date)).slice(-40).map(m => ({maquina: nomeM(m.machineId), tipo: m.kind, data: m.date, descricao: m.description || '', status: m.status}));
  const pragas = lista('monitoramentos').filter(m => desde(45)(m.date)).slice(-60).map(m => ({talhao: nomeT(m.fieldId), data: m.date, tipo: m.tipo, alvo: m.alvo, estadio: m.estadio || '', valor: m.valor, unidade: m.unidade || ''}));
  const aplicacoes = lista('aplicacoes').filter(a => desde(60)(a.date || a.data)).slice(-40).map(a => ({talhao: nomeT(a.fieldId), data: a.date || a.data, produto: a.produto || a.product || '', carenciaDias: a.carencia ?? null}));
  const sementes = lista('lots').slice(-60).map(l => ({lote: l.code, especie: l.species, cultivar: l.cultivar, categoria: l.category, status: l.status, kg: iaR(l.weight, 0), germinacao: l.germination || null, safra: l.season}));
  const rom = lista('romaneios').filter(r => desde(120)(r.date)), porProd = {};
  rom.forEach(r => { const k = `${r.produtoNome || r.produto || 'grão'} ${r.safra || ''}`.trim(), c = typeof calcRomaneio === 'function' ? calcRomaneio(r) : {liquido: (Number(r.pesoBruto) || 0) - (Number(r.tara) || 0), pesoFinal: 0};
    const p = porProd[k] ||= {cargas: 0, liquidoKg: 0, pesoFinalKg: 0}; p.cargas++; p.liquidoKg += c.liquido || 0; p.pesoFinalKg += c.pesoFinal || 0; });
  const silos = (typeof saldoSilo === 'function' ? lista('machines').filter(m => /silo|armaz/i.test(m.type || '')) : []).map(s => { const sd = saldoSilo(s); return {silo: s.name, saldoKg: iaR(sd.saldo, 0), capacidadeKg: sd.cap, ocupacaoPct: iaR(sd.ocupacao, 0), umidadeMedia: iaR(sd.uMedia)}; });
  // Tempo: previsão por dia do ponto da fazenda e janelas de pulverização dos próximos dias
  let tempo = null;
  try {
    const c = typeof lerClima === 'function' ? lerClima() : null, d = c?.dados?.daily, h = c?.dados?.hourly;
    if (d?.time) {
      tempo = {atualizadoEm: c.em ? new Date(c.em).toLocaleString('pt-BR') : '', dias: d.time.map((t, i) => ({data: t, min: iaR(d.temperature_2m_min?.[i], 0), max: iaR(d.temperature_2m_max?.[i], 0), chuvaMm: iaR(d.precipitation_sum?.[i]), chanceChuva: d.precipitation_probability_max?.[i] ?? null, ventoMax: iaR(d.wind_speed_10m_max?.[i], 0)})).filter(x => x.data >= iaAdd(hoje, -1))};
      if (h?.time && typeof janelasDoDia === 'function') tempo.janelasPulverizacao = d.time.filter(t => t >= hoje).slice(0, 4).map(t => { const j = janelasDoDia(c.dados, t); return {data: t, janelas: j.janelas.map(([a, b]) => `${a}h–${b}h`), motivoPrincipalFora: j.principal || ''}; });
      if (typeof balancoHidrico === 'function') { try {
        const txt = b => b ? {nivel: {boa: 'boa umidade', secando: 'secando', deficit: 'déficit hídrico'}[b.nivel], armazenadoPct: Math.round(b.pct * 100), chuva7dias: b.chuva7, consumo7dias: b.etc7} : null;
        tempo.aguaNoSolo = {sede: txt(balancoHidrico(null)), talhoes: lista('fields').filter(f => f.plantingDate).map(f => ({talhao: f.name, ...(txt(balancoHidrico(f)) || {})}))};
      } catch { /* opcional */ } }
    }
  } catch { /* sem tempo */ }
  return {fazenda: db.settings?.farm || '', hoje, talhoes, operacoes: ops, colheitas, chuvas, estoque, maquinas, manutencoes, pragas, aplicacoes, sementes,
    graos: {recebidoUltimos120dias: Object.entries(porProd).map(([k, v]) => ({produto: k, cargas: v.cargas, liquidoKg: Math.round(v.liquidoKg), pesoFinalKg: Math.round(v.pesoFinalKg)})), silos}, tempo};
}

// ---------- Tela ----------
let iaConversa = [];
try { iaConversa = JSON.parse(sessionStorage.getItem('ia-conversa') || '[]'); } catch { iaConversa = []; }
const iaGuardar = () => { try { sessionStorage.setItem('ia-conversa', JSON.stringify(iaConversa.slice(-30))); } catch { /* sem armazenamento */ } };
const IA_SUGESTOES = ['Quanto choveu nos últimos 30 dias?', 'O que está programado para esta semana?', 'Posso pulverizar amanhã?', 'Quais insumos estão abaixo do mínimo?', 'Quanto colhi em cada talhão nesta safra?', 'Qual máquina está perto da revisão?'];
const IA_SUG_TEMPO = ['Posso pulverizar amanhã? Qual o melhor horário?', 'Qual o melhor dia desta semana para plantar?', 'Dá para colher nos próximos dias ou vem chuva?', 'O solo aguenta entrar com máquina pesada amanhã?', 'Resumo do tempo da semana para a fazenda'];
/** Texto da IA → HTML seguro (negrito e listas). */
function iaFormatar(t) {
  const linhas = esc(String(t || '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', lista = false;
  linhas.forEach(l => { const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${m[1]}</li>`; }
    else { if (lista) { html += '</ul>'; lista = false; } if (l.trim()) html += `<p>${l}</p>`; } });
  return html + (lista ? '</ul>' : '');
}
function iaBolhas() {
  if (!iaConversa.length) return `<div class="ia-vazio"><span class="ia-logo" aria-hidden="true">✨</span><b>Pergunte sobre a sua fazenda</b><small>A IA responde com os dados do MercaPlant: talhões, operações, colheitas, chuva, estoque, máquinas, pragas, sementes, grãos e a previsão do tempo.</small></div>`;
  return iaConversa.map(m => `<div class="ia-msg ${m.de}">${m.de === 'ia' ? iaFormatar(m.texto) : `<p>${esc(m.texto)}</p>`}</div>`).join('');
}
VIEWS.assistente = () => {
  const ligado = typeof nvVinculado === 'function' && nvVinculado();
  return head('✨ Assistente', 'Pergunte sobre a fazenda: a IA responde com os seus dados. Ela não salva nem muda nada.', iaConversa.length ? btn('Nova conversa', 'ia-limpar', '', 'secondary') : '') +
    `<section class="card ia-chat">
      <div class="ia-msgs" id="iaMsgs" aria-live="polite">${iaBolhas()}</div>
      <div class="ia-sug">${IA_SUGESTOES.map(s => `<button type="button" class="chip" data-act="ia-sug" data-id="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      ${ligado ? `<form class="ia-form" id="iaForm"><textarea id="iaPergunta" rows="1" maxlength="800" placeholder="Escreva a pergunta…" aria-label="Pergunta"></textarea>
        ${window.SpeechRecognition || window.webkitSpeechRecognition ? '<button type="button" class="secondary ia-mic" data-act="ia-mic" aria-label="Falar a pergunta" title="Falar">🎤</button>' : ''}
        <button type="submit" class="primary" aria-label="Enviar">Enviar</button></form>`
      : '<p class="nota">Entre na sua conta da nuvem para usar a IA.</p>'}
      <p class="nota ia-rodape">A IA pode errar: confira números importantes. Não receita defensivo nem dose (isso é com o agrônomo).</p>
    </section>`;
};
TITLES.assistente = 'Assistente';
VIEWS.assistente.after = () => {
  const f = $('#iaForm'), t = $('#iaPergunta'), msgs = $('#iaMsgs'); if (msgs) msgs.scrollTop = msgs.scrollHeight;
  if (!f) return;
  const ajustar = () => { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; };
  t.addEventListener('input', ajustar);
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
  f.onsubmit = e => { e.preventDefault(); iaPerguntar(t.value); };
  const pend = sessionStorage.getItem('ia-pendente'); if (pend) { sessionStorage.removeItem('ia-pendente'); iaPerguntar(pend); }
};
let iaOcupado = false;
async function iaPerguntar(texto) {
  const q = String(texto || '').trim(); if (!q || iaOcupado) return;
  if (!(typeof nvVinculado === 'function' && nvVinculado())) return showToast('Entre na sua conta da nuvem para usar a IA.', true);
  iaOcupado = true;
  const historico = iaConversa.filter(m => !m.erro).slice(-8).map(({de, texto}) => ({de, texto}));
  iaConversa.push({de: 'pessoa', texto: q}); iaGuardar();
  const msgs = $('#iaMsgs'), t = $('#iaPergunta');
  if (t) { t.value = ''; t.style.height = 'auto'; }
  if (msgs) { msgs.innerHTML = iaBolhas() + '<div class="ia-msg ia pensando"><span class="ia-roda" aria-hidden="true"></span> Pensando…</div>'; msgs.scrollTop = msgs.scrollHeight; }
  try {
    const r = await nvHttp('/functions/v1/ia', {method: 'POST', body: {farm_id: nv.fazenda.id, acao: 'perguntar', pergunta: q, historico, contexto: JSON.stringify(iaContexto())}});
    iaConversa.push({de: 'ia', texto: r.resposta || 'Sem resposta.'});
  } catch (e) {
    iaConversa.push({de: 'ia', texto: `⚠️ ${e?.message || 'Não foi possível falar com a IA agora.'}`, erro: true});
  }
  iaOcupado = false; iaGuardar();
  if (parseRoute().name === 'assistente' && !document.querySelector('.modal.open')) render();
}
Object.assign(ACTIONS, {
  'ia-sug': q => { if (parseRoute().name !== 'assistente') { try { sessionStorage.setItem('ia-pendente', q); } catch { /* */ } go('assistente'); } else iaPerguntar(q); },
  'ia-limpar': () => { iaConversa = []; iaGuardar(); render(); },
  'ia-mic': () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    const r = new SR(), b = $('.ia-mic'); r.lang = 'pt-BR'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => { const t = $('#iaPergunta'); if (t) { t.value = (t.value ? t.value + ' ' : '') + e.results[0][0].transcript; t.dispatchEvent(new Event('input')); } };
    r.onend = () => b?.classList.remove('ouvindo'); r.onerror = () => { b?.classList.remove('ouvindo'); showToast('Não deu para ouvir. Tente de novo ou escreva.', true); };
    b?.classList.add('ouvindo'); r.start();
  },
});
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.assistente = 'inicio';

// MercaClima: perguntas prontas sobre o tempo
if (VIEWS.clima) {
  const _clima = VIEWS.clima;
  VIEWS.clima = (...a) => {
    const html = _clima(...a);
    if (!(typeof nvVinculado === 'function' && nvVinculado())) return html;
    const cx = `<section class="card panel ia-tempo"><h3>✨ IA do tempo <small>pergunte com a previsão da fazenda</small></h3><div class="ia-sug">${IA_SUG_TEMPO.map(s => `<button type="button" class="chip" data-act="ia-sug" data-id="${esc(s)}">${esc(s)}</button>`).join('')}</div></section>`;
    const i = html.indexOf('<section', html.indexOf('class="view-head"') + 1);
    return i < 0 ? html + cx : html.slice(0, i) + cx + html.slice(i);
  };
  VIEWS.clima.after = _clima.after;
}
