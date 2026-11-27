'use strict';
/* MercaPlant — Edy, a inteligência do MercaPlant (IA Gemini pela função ia do servidor).
   Tela "✨ Edy": a pessoa pergunta em texto (ou pelo microfone, quando o aparelho deixa) e a IA responde com os dados
   da fazenda — talhões, operações, colheitas, chuvas, estoque, máquinas, pragas, sementes, grãos e a previsão do tempo.
   O app monta um resumo só com o que a pessoa já vê no aparelho (o financeiro não vai) e manda junto com a pergunta;
   a chave da IA fica só no servidor. A IA não salva nada sozinha: quando a pessoa conta o que fez ("plantei 30 ha no T3")
   ou pede para reprogramar, o Edy devolve o registro pronto e o app abre o formulário preenchido para a pessoa conferir e salvar.
   Modo "🔎 Técnica (com fontes)": o Edy pesquisa na Embrapa, MAPA/ZARC, manual CQFS-RS/SC… e mostra as fontes.
   Análise: produtividade (sc/ha) por talhão e safra, estádio e colheita prevista, vigor do satélite (atual × anterior);
   custo por hectare só vai para o administrador da fazenda.
   No MercaClima, "✨ Pergunte ao Edy sobre o tempo" traz perguntas prontas (pulverizar, plantar, colher, entrar com máquina).
   iaContexto é testada em referencias/tests/ia-assistente.test.js. */
const IA_DIAS_OPS = 60, IA_DIAS_CHUVA = 120;
const iaAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const iaR = (v, c = 1) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** c) / 10 ** c;

const iaTenta = (fn, padrao = null) => { try { return fn(); } catch { return padrao; } };
// Só o administrador da fazenda vê custo na IA (o financeiro não vai para mais ninguém)
const iaVeCusto = () => typeof nvVinculado === 'function' && nvVinculado() && typeof nv === 'object' && (nv.sysadm || nv.papel === 'admin');
/** Estádio, colheita prevista e vigor do satélite (atual × anterior) de um talhão. */
function iaTecTalhao(f, hoje) {
  const r = {};
  const est = typeof estadioTalhao === 'function' ? iaTenta(() => estadioTalhao(f)) : null;
  if (est) { r.estadio = typeof tecEstadioTxt === 'function' ? tecEstadioTxt(est) : est.cod || ''; r.diasAposPlantio = est.dap; }
  const ci = typeof cicloTalhao === 'function' ? iaTenta(() => cicloTalhao(f)) : null;
  const prev = ci?.colheita || (est?.ciclo && f.plantingDate ? iaAdd(f.plantingDate, est.ciclo) : null);
  if (prev) r.colheitaPrevista = prev;
  const nd = typeof edyNdviTalhao === 'function' ? iaTenta(() => edyNdviTalhao(f.id)) : null;
  if (nd) r.ndvi = nd;
  return r;
}
/** Produtividade (sc/ha) por safra e talhão; custo por hectare só para o administrador. */
function iaProdutividade() {
  if (typeof resumoSafra !== 'function' || typeof safrasConhecidas !== 'function') return [];
  const custo = iaVeCusto();
  return iaTenta(() => safrasConhecidas().slice(0, 4).map(resumoSafra).filter(r => r.col.length).map(r => ({safra: r.s, mediaScHa: iaR(r.scha), areaColhidaHa: iaR(r.area), sacas: iaR(r.sacas, 0),
    ...(r.chuva != null ? {chuvaSafraMm: iaR(r.chuva, 0)} : {}), ...(custo && r.custoSc ? {custoPorSaca: iaR(r.custoSc, 2)} : {}),
    talhoes: r.col.map(l => ({talhao: l.nome, cultura: l.cultura, ha: iaR(l.area, 2), sacas: iaR(l.sacas, 0), scHa: iaR(l.scha), ...(custo && l.custo > 0 ? {custoHa: iaR(l.custoHa, 2), custoSaca: iaR(l.custoSc, 2)} : {})}))})), []);
}
/** Última análise de solo de cada talhão e a recomendação que o app calculou (manual CQFS-RS/SC). */
function iaSolo() {
  if (typeof tecUltimaAnalise !== 'function' || typeof recomendacaoSolo !== 'function') return [];
  const cl = i => typeof TEC_CLASSES !== 'undefined' ? TEC_CLASSES[i] : i;
  return (Array.isArray(db?.fields) ? db.fields : []).map(f => { const a = tecUltimaAnalise(f); if (!a) return null; const r = iaTenta(() => recomendacaoSolo(a)) || {};
    return {talhao: f.name, data: a.date, phAgua: a.phAgua, smp: a.smp, argila: a.argila, mo: a.mo, p: a.p, k: a.k, ctc: a.ctc, v: a.v, mAl: a.mAl, sistema: a.sistema, proximaCultura: a.cultura || '',
      recomendacaoApp: {calagem: [r.cal?.txt, r.cal?.como].filter(Boolean).join(', '), interpretacaoP: r.p ? cl(r.p.i) : '', interpretacaoK: r.k ? cl(r.k.i) : '',
        ...(r.adubo && !r.adubo.falta ? {P2O5kgHa: r.adubo.P, K2OkgHa: r.adubo.K, ...(r.adubo.N ? {NkgHa: r.adubo.N} : {}), expectativaTHa: r.adubo.exp} : {}), avisos: r.avisos || []}};
  }).filter(Boolean);
}

/** Resumo da fazenda para a IA (objeto; o app manda em JSON). hoje = AAAA-MM-DD. */
function iaContexto(hoje = today()) {
  const nomeT = id => (typeof fieldName === 'function' ? fieldName(id) : '') || (id ? 'talhão removido' : 'Sede/geral');
  const nomeM = id => (typeof machineName === 'function' ? machineName(id) : '') || '';
  const desde = d => (x => x && x >= iaAdd(hoje, -d));
  const lista = c => Array.isArray(db?.[c]) ? db[c] : [];
  const talhoes = lista('fields').filter(f => !f.inactive && !f.inativo).map(f => ({id: f.id, nome: f.name, ha: iaR(f.area, 2), cultura: f.crop || '', cultivar: f.cultivar || '', safra: f.season || '', plantio: f.plantingDate || '', ...(f.parteDe ? {parteDe: f.parteDe.nome} : {}), ...iaTecTalhao(f, hoje)}));
  const ops = lista('operations').filter(o => desde(IA_DIAS_OPS)(o.date) || (o.date >= hoje && o.status !== 'Concluída'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 150)
    .map(o => ({id: o.id, data: o.date, hora: o.time || '', tipo: o.type, talhao: nomeT(o.fieldId), status: o.status, ha: iaR(o.area, 2), maquina: nomeM(o.machineId), ...(o.produto ? {produto: o.produto} : {}), ...(o.notes ? {obs: String(o.notes).slice(0, 80)} : {}),
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
  const maquinas = lista('machines').filter(m => !(typeof isInactive === 'function' && isInactive(m))).map(m => ({id: m.id, nome: m.name, tipo: m.type, modelo: m.model || '', horimetro: iaR(m.hours, 1), proximaRevisao: iaR(m.nextService, 0)}));
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
  return {fazenda: db.settings?.farm || '', hoje, tiposOperacao: typeof OP_TYPES !== 'undefined' ? OP_TYPES : [], talhoes, operacoes: ops, produtividade: iaProdutividade(), analisesSolo: iaSolo(), colheitas, chuvas, estoque, maquinas, manutencoes, pragas, aplicacoes, sementes,
    graos: {recebidoUltimos120dias: Object.entries(porProd).map(([k, v]) => ({produto: k, cargas: v.cargas, liquidoKg: Math.round(v.liquidoKg), pesoFinalKg: Math.round(v.pesoFinalKg)})), silos}, tempo};
}

// ---------- Tela ----------
let iaConversa = [];
try { iaConversa = JSON.parse(sessionStorage.getItem('ia-conversa') || '[]'); } catch { iaConversa = []; }
const iaGuardar = () => { try { sessionStorage.setItem('ia-conversa', JSON.stringify(iaConversa.slice(-30))); } catch { /* sem armazenamento */ } };
let iaModo = ''; try { iaModo = sessionStorage.getItem('ia-modo') || ''; } catch { iaModo = ''; }
const IA_SUGESTOES = ['O que tenho para hoje?', 'Quanto choveu nos últimos 30 dias?', 'Posso pulverizar amanhã?', 'Compare os talhões com a safra passada (sc/ha)', 'Qual talhão caiu de vigor no satélite?', 'Quando colho cada talhão?', 'Quais insumos estão abaixo do mínimo?'];
const IA_SUG_TECNICA = ['Qual o nível de controle de percevejo na soja?', 'Qual a janela de plantio da soja no RS pelo ZARC?', 'Explique a adubação pela minha análise de solo', 'Em que estádio está cada talhão e o que vem agora?', 'Como amostrar lagarta no milho (MIP)?'];
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
const iaLink = u => /^https:\/\//.test(String(u || '')) ? String(u) : '';
function iaBolhas() {
  if (!iaConversa.length) return `<div class="ia-vazio"><span class="ia-logo" aria-hidden="true">✨</span><b>Oi, eu sou o Edy, a inteligência do MercaPlant.</b><small>Pergunte sobre a sua fazenda ou me conte o que fez: <i>"plantei 30 ha no Talhão 07"</i>, <i>"abasteci 180 L no 7230"</i>, <i>"passa a colheita do T08 para sábado"</i> — eu preparo o registro e você confere antes de salvar.</small></div>`;
  return iaConversa.map((m, i) => {
    if (m.de !== 'ia') return `<div class="ia-msg pessoa">${m.tecnica ? '<span class="ia-selo">🔎 técnica</span>' : ''}<p>${esc(m.texto)}</p></div>`;
    const acoes = (m.acoes || []).map((a, k) => typeof edyCartaoAcao === 'function' ? edyCartaoAcao(a, `${i}|${k}`, (m.abertas || []).includes(k) ? 'aberto' : '') : '').join('');
    const fontes = (m.fontes || []).filter(f => iaLink(f.url));
    return `<div class="ia-msg ia">${iaFormatar(m.texto)}${acoes ? `<div class="edy-acoes">${acoes}</div>` : ''}${fontes.length ? `<div class="ia-fontes"><span>Fontes:</span>${fontes.map(f => `<a href="${esc(iaLink(f.url))}" target="_blank" rel="noopener noreferrer">${esc(f.titulo)}</a>`).join('')}</div>` : ''}</div>`;
  }).join('');
}
/* Microfone do Edy */
let iaOuvindo = '', iaVozBase = '', iaVozWeb = null;
function iaTemMic() { return !!(window.AndroidBridge || window.SpeechRecognition || window.webkitSpeechRecognition); }
function iaVozTexto(t) {
  const c = $('#iaPergunta'); if (!c) return;
  c.value = (iaVozBase ? iaVozBase + ' ' : '') + String(t || '').trim(); c.dispatchEvent(new Event('input'));
}
const IA_VOZ_ERRO = {
  negado: 'O MercaPlant precisa da permissão do microfone. Libere em Configurações › Apps › MercaPlant › Permissões.',
  nada: 'Não ouvi nada. Toque no microfone e fale perto do celular.',
  rede: 'Sem internet para entender a voz. Tente de novo ou escreva.',
  'sem-servico': 'Este aparelho não tem o reconhecimento de voz do Google. Instale ou ative o app Google e tente de novo.',
  ocupado: 'O microfone está ocupado em outro app. Tente de novo.',
  falha: 'Não deu para ouvir. Tente de novo ou escreva.'
};
function iaVozFim(erro) {
  iaOuvindo = ''; iaVozWeb = null;
  const b = $('.ia-mic'); if (b) { b.classList.remove('ouvindo'); b.style.removeProperty('--nivel'); }
  if (erro && erro !== 'cancelado') showToast(IA_VOZ_ERRO[erro] || IA_VOZ_ERRO.falha, true);
  else $('#iaPergunta')?.focus();
}
// Resposta do reconhecimento nativo (MainActivity → Voz.kt)
window.onVoz = ({etapa, texto, nivel} = {}) => {
  if (etapa === 'ouvindo') return;
  if (etapa === 'nivel') { $('.ia-mic')?.style.setProperty('--nivel', String((nivel || 0) / 100)); return; }
  if (etapa === 'parcial') return iaVozTexto(texto);
  if (etapa === 'fim') { iaVozTexto(texto); return iaVozFim(); }
  if (etapa === 'erro') iaVozFim(texto);
};
VIEWS.assistente = () => {
  const ligado = typeof nvVinculado === 'function' && nvVinculado(), tec = iaModo === 'tecnica';
  return head('✨ Edy', 'A inteligência do MercaPlant. Pergunte, peça análises ou conte o que fez: o Edy responde com os seus dados e prepara os registros para você conferir.', iaConversa.length ? btn('Nova conversa', 'ia-limpar', '', 'secondary') : '') +
    (typeof edyCartaoResumo === 'function' ? edyCartaoResumo(!iaConversa.length) : '') +
    `<section class="card ia-chat${tec ? ' ia-tecnica' : ''}">
      <div class="ia-msgs" id="iaMsgs" aria-live="polite">${iaBolhas()}</div>
      <div class="ia-sug">${(tec ? IA_SUG_TECNICA : IA_SUGESTOES).map(s => `<button type="button" class="chip" data-act="ia-sug" data-id="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      ${ligado ? `<div class="ia-modos" role="group" aria-label="Modo"><button type="button" class="chip ${tec ? '' : 'active'}" data-act="ia-modo" data-id="" aria-pressed="${!tec}">💬 Fazenda</button><button type="button" class="chip ${tec ? 'active' : ''}" data-act="ia-modo" data-id="tecnica" aria-pressed="${tec}">🔎 Técnica (com fontes)</button></div>
        <form class="ia-form" id="iaForm"><textarea id="iaPergunta" rows="1" maxlength="800" placeholder="${tec ? 'Pergunta técnica…' : 'Pergunte ao Edy…'}" aria-label="Pergunta"></textarea>
        ${iaTemMic() ? `<button type="button" class="ia-mic" data-act="ia-mic" aria-label="Falar a pergunta" title="Falar">${(typeof iconeMenu === 'function' && iconeMenu('microfone', 44)) || '🎤'}</button>` : ''}
        <button type="submit" class="primary" aria-label="Enviar">Enviar</button></form>`
      : '<p class="nota">Entre na sua conta da nuvem para usar o Edy.</p>'}
      <p class="nota ia-rodape">${tec ? 'Modo técnico: o Edy pesquisa na Embrapa, MAPA/ZARC, manual CQFS-RS/SC e Emater e mostra as fontes.' : 'O Edy pode errar: confira números importantes.'} Ele não receita defensivo nem dose (isso é com o agrônomo).</p>
    </section>`;
};
TITLES.assistente = 'Edy';
VIEWS.assistente.after = () => {
  const f = $('#iaForm'), t = $('#iaPergunta'), msgs = $('#iaMsgs'); if (msgs) msgs.scrollTop = msgs.scrollHeight;
  if (iaOuvindo) { window.AndroidBridge?.vozCancelar?.(); iaVozWeb?.abort?.(); iaOuvindo = ''; iaVozWeb = null; }
  if (!f) return;
  const ajustar = () => { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; };
  t.addEventListener('input', ajustar);
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
  f.onsubmit = e => { e.preventDefault(); if (iaOuvindo) { window.AndroidBridge?.vozCancelar?.(); iaVozWeb?.abort?.(); iaVozFim(); } iaPerguntar(t.value); };
  const pend = sessionStorage.getItem('ia-pendente'); if (pend) { sessionStorage.removeItem('ia-pendente'); iaPerguntar(pend); }
};
let iaOcupado = false;
async function iaPerguntar(texto) {
  const q = String(texto || '').trim(); if (!q || iaOcupado) return;
  if (!(typeof nvVinculado === 'function' && nvVinculado())) return showToast('Entre na sua conta da nuvem para usar o Edy.', true);
  iaOcupado = true;
  const tec = iaModo === 'tecnica';
  const historico = iaConversa.filter(m => !m.erro).slice(-8).map(({de, texto}) => ({de, texto}));
  iaConversa.push({de: 'pessoa', texto: q, ...(tec ? {tecnica: true} : {})}); iaGuardar();
  const msgs = $('#iaMsgs'), t = $('#iaPergunta');
  if (t) { t.value = ''; t.style.height = 'auto'; }
  if (msgs) { msgs.innerHTML = iaBolhas() + `<div class="ia-msg ia pensando"><span class="ia-roda" aria-hidden="true"></span> ${tec ? 'O Edy está pesquisando nas fontes técnicas…' : 'O Edy está pensando…'}</div>`; msgs.scrollTop = msgs.scrollHeight; }
  try {
    const r = await nvHttp('/functions/v1/ia', {method: 'POST', body: {farm_id: nv.fazenda.id, acao: 'perguntar', pergunta: q, historico, contexto: JSON.stringify(iaContexto()), ...(tec ? {modo: 'tecnica'} : {})}});
    iaConversa.push({de: 'ia', texto: r.resposta || 'Sem resposta.', ...(Array.isArray(r.acoes) && r.acoes.length ? {acoes: r.acoes.slice(0, 6)} : {}), ...(Array.isArray(r.fontes) && r.fontes.length ? {fontes: r.fontes.slice(0, 6)} : {})});
  } catch (e) {
    iaConversa.push({de: 'ia', texto: `⚠️ ${e?.message || 'Não foi possível falar com o Edy agora.'}`, erro: true});
  }
  iaOcupado = false; iaGuardar();
  if (parseRoute().name === 'assistente' && !document.querySelector('.modal.open')) render();
}
Object.assign(ACTIONS, {
  'ia-sug': q => { if (parseRoute().name !== 'assistente') { try { sessionStorage.setItem('ia-pendente', q); } catch { /* */ } go('assistente'); } else iaPerguntar(q); },
  'ia-limpar': () => { iaConversa = []; iaGuardar(); render(); },
  'ia-modo': m => { iaModo = m === 'tecnica' ? 'tecnica' : ''; try { sessionStorage.setItem('ia-modo', iaModo); } catch { /* */ } render(); },
  // Registro preparado pelo Edy: abre o formulário preenchido
  'edy-acao': ref => {
    const [i, k] = String(ref).split('|').map(Number), m = iaConversa[i], a = m?.acoes?.[k]; if (!a || typeof edyAbrirAcao !== 'function') return;
    (m.abertas ||= []).includes(k) || m.abertas.push(k); iaGuardar();
    edyAbrirAcao(a);
  },
  'ia-mic': () => {
    const b = $('.ia-mic');
    if (iaOuvindo) { iaOuvindo === 'web' ? iaVozWeb?.stop() : window.AndroidBridge?.vozParar?.(); return; }
    // App Android: a WebView não ouve sozinha, a voz passa pelo reconhecimento do próprio aparelho
    if (window.AndroidBridge) {
      if (!window.AndroidBridge.vozOuvir) return showToast('Atualize o app MercaPlant para falar com o Edy pelo microfone.', true);
      iaVozBase = ($('#iaPergunta')?.value || '').trim(); iaOuvindo = 'app'; b?.classList.add('ouvindo');
      window.AndroidBridge.vozOuvir(); return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    const r = new SR(); iaVozWeb = r; r.lang = 'pt-BR'; r.interimResults = true; r.maxAlternatives = 1;
    iaVozBase = ($('#iaPergunta')?.value || '').trim(); iaOuvindo = 'web';
    r.onresult = e => { const t = Array.from(e.results).map(x => x[0].transcript).join(''); iaVozTexto(t); };
    r.onend = () => iaVozFim(); r.onerror = e => iaVozFim(e.error === 'not-allowed' ? 'negado' : e.error === 'no-speech' ? 'nada' : 'falha');
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
    const cx = `<section class="card panel ia-tempo"><h3>✨ Pergunte ao Edy sobre o tempo <small>ele responde com a previsão da fazenda</small></h3><div class="ia-sug">${IA_SUG_TEMPO.map(s => `<button type="button" class="chip" data-act="ia-sug" data-id="${esc(s)}">${esc(s)}</button>`).join('')}</div></section>`;
    const i = html.indexOf('<section', html.indexOf('class="view-head"') + 1);
    return i < 0 ? html + cx : html.slice(0, i) + cx + html.slice(i);
  };
  VIEWS.clima.after = _clima.after;
}
