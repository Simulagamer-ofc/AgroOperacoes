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

/** Município da sede pelo ponto (OpenStreetMap, aqui no aparelho; só o nome vai para o servidor): para o ZARC. */
async function iaMunicipioSede() {
  const l = db.settings?.local; if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon) || !navigator.onLine) return;
  const m = db.settings.municipioSede; if (m && Math.abs(m.lat - l.lat) < 0.005 && Math.abs(m.lon - l.lon) < 0.005) return;
  try {
    const j = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${l.lat}&lon=${l.lon}`).then(r => r.json());
    const a = j?.address || {}, nome = a.city || a.town || a.municipality || a.village;
    if (nome) { db.settings.municipioSede = {nome, uf: String(a['ISO3166-2-lvl4'] || '').replace(/^BR-/, ''), lat: l.lat, lon: l.lon}; save(); }
  } catch { /* sem internet: tenta na próxima */ }
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
  const ms = db.settings?.municipioSede, municipio = ms?.nome ? {nome: ms.nome, uf: ms.uf || ''} : undefined; // para o ZARC do município
  return {fazenda: db.settings?.farm || '', hoje, ...(municipio ? {municipio} : {}), tiposOperacao: typeof OP_TYPES !== 'undefined' ? OP_TYPES : [], talhoes, operacoes: ops, produtividade: iaProdutividade(), analisesSolo: iaSolo(), colheitas, chuvas, estoque, maquinas, manutencoes, pragas, aplicacoes, sementes,
    graos: {recebidoUltimos120dias: Object.entries(porProd).map(([k, v]) => ({produto: k, cargas: v.cargas, liquidoKg: Math.round(v.liquidoKg), pesoFinalKg: Math.round(v.pesoFinalKg)})), silos}, tempo};
}

// ---------- Tela ----------
let iaConversa = [];
try { iaConversa = JSON.parse(sessionStorage.getItem('ia-conversa') || '[]'); } catch { iaConversa = []; }
const iaGuardar = () => { try { sessionStorage.setItem('ia-conversa', JSON.stringify(iaConversa.slice(-30))); } catch { /* sem armazenamento */ } };
const IA_SUG_FOTO = '📷 Foto da lavoura';
// Um só Edy: ele mesmo decide se responde com os dados da fazenda ou pesquisa nas fontes técnicas
const IA_SUGESTOES = [IA_SUG_FOTO, 'O que tenho para hoje?', 'Posso pulverizar amanhã?', 'Como foi a safra por talhão?', 'Nível de ação do percevejo na soja', 'Quanto choveu no mês?'];
const IA_SUG_TEMPO = ['Posso pulverizar amanhã? Qual o melhor horário?', 'Qual o melhor dia desta semana para plantar?', 'Dá para colher nos próximos dias ou vem chuva?', 'O solo aguenta entrar com máquina pesada amanhã?', 'Resumo do tempo da semana para a fazenda'];
/** Texto da IA → HTML seguro (negrito e listas). */
function iaFormatar(t) {
  const linhas = esc(String(t || '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>').split('\n');
  let html = '', lista = false;
  linhas.forEach(l => { const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${m[1]}</li>`; }
    else { if (lista) { html += '</ul>'; lista = false; } if (l.trim()) html += `<p>${l}</p>`; } });
  return html + (lista ? '</ul>' : '');
}
const iaLink = u => /^https:\/\//.test(String(u || '')) ? String(u) : '';
function iaBolhas() {
  if (!iaConversa.length) return `<div class="ia-vazio"><span class="edy-avatar grande" aria-hidden="true">${(typeof iconeMenu === 'function' && iconeMenu('assistente', 64)) || '✨'}</span><b>Oi! Eu sou o Edy.</b><small>Pergunte, conte o que fez ou mande uma foto da lavoura.</small></div>`;
  return iaConversa.map((m, i) => {
    if (m.de !== 'ia') return `<div class="ia-msg pessoa">${(m.fotos || []).length ? `<div class="ia-msg-fotos">${m.fotos.filter(f => /^data:image\/(jpeg|png|webp);base64,/.test(f)).map(f => `<img src="${f}" alt="Foto enviada ao Edy">`).join('')}</div>` : ''}${m.texto ? `<p>${esc(m.texto)}</p>` : ''}</div>`;
    const acoes = (m.acoes || []).map((a, k) => typeof edyCartaoAcao === 'function' ? edyCartaoAcao(a, `${i}|${k}`, (m.abertas || []).includes(k) ? 'aberto' : '') : '').join('');
    const fontes = (m.fontes || []).filter(f => iaLink(f.url)), d = m.diagnostico;
    const diag = d ? `<div class="edy-diag conf-${esc(d.confianca)}"><span>🔍 ${esc(d.tipo)}</span><b>${esc(d.alvo)}</b><small>confiança ${esc({alta: 'alta', media: 'média', baixa: 'baixa'}[d.confianca] || d.confianca)}</small></div>` : '';
    const ofi = (m.oficiais || []).map(o => `<details class="edy-oficial"><summary>📋 ${esc(o.titulo)}</summary><ul>${(o.linhas || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul><small>Fonte: ${iaLink(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.fonte)}</a>` : esc(o.fonte)}</small></details>`).join('');
    return `<div class="ia-msg ia">${diag}${iaFormatar(m.texto)}${ofi}${acoes ? `<div class="edy-acoes">${acoes}</div>` : ''}${fontes.length ? `<div class="ia-fontes"><span>Fontes:</span>${fontes.map(f => `<a class="${f.oficial ? 'oficial' : ''}" href="${esc(iaLink(f.url))}" target="_blank" rel="noopener noreferrer" title="${f.oficial ? 'Fonte técnica/oficial' : 'Outra fonte: confira'}">${f.oficial ? '✔ ' : ''}${esc(f.titulo)}</a>`).join('')}</div>` : ''}</div>`;
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
const IA_ENVIAR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h13M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
VIEWS.assistente = () => {
  const ligado = typeof nvVinculado === 'function' && nvVinculado(), ic = (n, t) => (typeof iconeMenu === 'function' && iconeMenu(n, t)) || '';
  return `<section class="edy-tela">
    <div class="edy-topo">${typeof edyCartaoResumo === 'function' ? edyCartaoResumo(false) : ''}${iaConversa.length ? '<button type="button" class="edy-novo" data-act="ia-limpar" aria-label="Nova conversa" title="Nova conversa"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' : ''}</div>
    <div class="ia-msgs" id="iaMsgs" aria-live="polite">${iaBolhas()}</div>
    ${iaConversa.length ? '' : `<div class="ia-sug">${IA_SUGESTOES.map(s => `<button type="button" class="chip" data-act="ia-sug" data-id="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
    ${ligado ? `<div class="ia-fotos" id="iaFotos">${iaFotosHtml()}</div>
      <form class="ia-form" id="iaForm"><label class="ia-foto-btn" title="Foto da lavoura"><input type="file" accept="image/*" hidden data-ia-foto aria-label="Mandar foto da lavoura ao Edy">${ic('camera', 40) || '📷'}</label><textarea id="iaPergunta" rows="1" maxlength="800" placeholder="Pergunte ao Edy…" aria-label="Mensagem para o Edy"></textarea>${iaTemMic() ? `<button type="button" class="ia-mic" data-act="ia-mic" aria-label="Falar" title="Falar">${ic('microfone', 40) || '🎤'}</button>` : ''}<button type="submit" class="ia-enviar" aria-label="Enviar" title="Enviar">${IA_ENVIAR}</button></form>`
    : '<p class="nota">Entre na sua conta da nuvem para usar o Edy.</p>'}
  </section>`;
};
TITLES.assistente = 'Edy';
VIEWS.assistente.after = () => {
  const f = $('#iaForm'), t = $('#iaPergunta'), msgs = $('#iaMsgs');
  iaCaber(); if (msgs) msgs.scrollTop = msgs.scrollHeight;
  iaMunicipioSede();
  if (iaOuvindo) { window.AndroidBridge?.vozCancelar?.(); iaVozWeb?.abort?.(); iaOuvindo = ''; iaVozWeb = null; }
  if (!f) return;
  const ajustar = () => { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; };
  t.addEventListener('input', ajustar);
  t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
  f.onsubmit = e => { e.preventDefault(); if (iaOuvindo) { window.AndroidBridge?.vozCancelar?.(); iaVozWeb?.abort?.(); iaVozFim(); } iaFotos.length ? iaDiagnosticar(t.value) : iaPerguntar(t.value); };
  const arq = $('[data-ia-foto]', f);
  if (arq) arq.onchange = async () => { const a = arq.files?.[0]; arq.value = ''; if (a) await iaAddFoto(a); };
  const pend = sessionStorage.getItem('ia-pendente'); if (pend) { sessionStorage.removeItem('ia-pendente'); iaPerguntar(pend); }
};
/** No celular, a conversa ocupa a tela toda (entre o topo e o menu de baixo), como num app de mensagens. */
function iaCaber() {
  const tela = $('.edy-tela'), msgs = $('#iaMsgs'); if (!tela || !msgs) return;
  if (innerWidth > 760) { msgs.style.height = ''; return; }
  const alto = window.visualViewport ? visualViewport.height : innerHeight, nav = $('.mobile-nav');
  const baixo = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
  const resto = tela.getBoundingClientRect().height - msgs.getBoundingClientRect().height;
  const h = Math.max(200, Math.floor(alto - tela.getBoundingClientRect().top - baixo - resto - 12));
  msgs.style.height = h + 'px';
  const sobra = document.documentElement.scrollHeight - alto; // margens do layout: a página não pode rolar
  if (sobra > 0 && h - sobra >= 200) msgs.style.height = (h - sobra) + 'px';
}
if (typeof addEventListener === 'function') addEventListener('resize', () => { if ($('.edy-tela')) iaCaber(); });
let iaOcupado = false;
async function iaPerguntar(texto) {
  const q = String(texto || '').trim(); if (!q || iaOcupado) return;
  if (!(typeof nvVinculado === 'function' && nvVinculado())) return showToast('Entre na sua conta da nuvem para usar o Edy.', true);
  iaOcupado = true;
  const historico = iaConversa.filter(m => !m.erro).slice(-8).map(({de, texto}) => ({de, texto}));
  iaConversa.push({de: 'pessoa', texto: q}); iaGuardar();
  const msgs = $('#iaMsgs'), t = $('#iaPergunta');
  if (t) { t.value = ''; t.style.height = 'auto'; }
  if (msgs) { msgs.innerHTML = iaBolhas() + `<div class="ia-msg ia pensando"><span class="ia-roda" aria-hidden="true"></span> Edy está pensando…</div>`; msgs.scrollTop = msgs.scrollHeight; }
  try {
    const r = await nvHttp('/functions/v1/ia', {method: 'POST', body: {farm_id: nv.fazenda.id, acao: 'perguntar', pergunta: q, historico, contexto: JSON.stringify(iaContexto())}});
    iaConversa.push({de: 'ia', texto: r.resposta || 'Sem resposta.', ...(Array.isArray(r.oficiais) && r.oficiais.length ? {oficiais: r.oficiais.slice(0, 3)} : {}), ...(Array.isArray(r.acoes) && r.acoes.length ? {acoes: r.acoes.slice(0, 6)} : {}), ...(Array.isArray(r.fontes) && r.fontes.length ? {fontes: r.fontes.slice(0, 6)} : {})});
  } catch (e) {
    iaConversa.push({de: 'ia', texto: `⚠️ ${e?.message || 'Não foi possível falar com o Edy agora.'}`, erro: true});
  }
  iaOcupado = false; iaGuardar();
  if (parseRoute().name === 'assistente' && !document.querySelector('.modal.open')) render();
}
// ---------- Edy agrônomo pela foto ----------
let iaFotos = []; // fotos escolhidas para a próxima pergunta: [{tipo, dados, mini, arq}]
const iaArqDiag = new Map(); // mensagem do Edy → arquivos da foto (para anexar ao monitoramento; só nesta sessão)
const IA_MAX_FOTOS = 3;
function iaFotosHtml() {
  return iaFotos.map((f, i) => `<span class="ia-foto-mini"><img src="${f.mini}" alt="Foto ${i + 1}"><button type="button" data-act="ia-foto-tirar" data-id="${i}" aria-label="Tirar a foto ${i + 1}">×</button></span>`).join('');
}
/** Miniatura pequena para mostrar na conversa. */
function iaMiniatura(arq, lado = 240) {
  return new Promise(ok => {
    const u = URL.createObjectURL(arq), img = new Image();
    img.onload = () => { const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.7)); };
    img.onerror = () => { URL.revokeObjectURL(u); ok(''); }; img.src = u;
  });
}
async function iaAddFoto(arq) {
  if (iaFotos.length >= IA_MAX_FOTOS) return showToast(`No máximo ${IA_MAX_FOTOS} fotos por pergunta`, true);
  if (!/^image\//.test(arq.type)) return showToast('Escolha uma foto', true);
  try {
    const [f, mini] = await Promise.all([iaArquivo(arq), iaMiniatura(arq)]);
    iaFotos.push({...f, mini, arq});
  } catch (e) { return showToast(e?.message || 'Não foi possível usar esta foto', true); }
  const box = $('#iaFotos'); if (box) box.innerHTML = iaFotosHtml();
  const t = $('#iaPergunta'); if (t) { t.placeholder = 'O que você viu? (opcional)'; t.focus(); }
  iaCaber();
}
/** Talhão citado no texto ("talhão 07", "T7", nome do talhão). */
function iaTalhaoNoTexto(q) {
  const t = String(q || '').toLowerCase(), nums = [...t.matchAll(/\b(?:t|talh[aã]o\s*)0*(\d+)\b/g)].map(m => Number(m[1]));
  return (db.fields || []).find(f => t.includes(String(f.name || '').toLowerCase()) || nums.includes(Number(String(f.name || '').match(/(\d+)\s*$/)?.[1])))?.id || '';
}
/** O que o agrônomo precisa saber para a foto: cultura, estádio, monitoramentos, aplicações e tempo. */
function iaContextoFoto() {
  const c = iaContexto(), s = db.settings || {};
  return {hoje: c.hoje, ...(c.municipio ? {municipio: c.municipio} : {}), regiao: c.municipio ? `${c.municipio.nome}/${c.municipio.uf}` : 'Rio Grande do Sul',
    talhoes: c.talhoes.map(({nome, cultura, cultivar, safra, plantio, estadio, diasAposPlantio}) => ({nome, cultura, cultivar, safra, plantio, estadio, diasAposPlantio})),
    monitoramentos: c.pragas, aplicacoes: c.aplicacoes, chuva: c.chuvas?.somas, tempo: (c.tempo?.dias || []).slice(0, 5)};
}
async function iaDiagnosticar(texto) {
  if (iaOcupado || !iaFotos.length) return;
  if (!(typeof nvVinculado === 'function' && nvVinculado())) return showToast('Entre na sua conta da nuvem para usar o Edy.', true);
  iaOcupado = true;
  const q = String(texto || '').trim(), fotos = iaFotos; iaFotos = [];
  iaConversa.push({de: 'pessoa', texto: q, fotos: fotos.map(f => f.mini).filter(Boolean)}); iaGuardar();
  const msgs = $('#iaMsgs'), t = $('#iaPergunta'), box = $('#iaFotos');
  if (t) { t.value = ''; t.style.height = 'auto'; } if (box) box.innerHTML = '';
  if (msgs) { msgs.innerHTML = iaBolhas() + '<div class="ia-msg ia pensando"><span class="ia-roda" aria-hidden="true"></span> Edy está analisando a foto…</div>'; msgs.scrollTop = msgs.scrollHeight; }
  try {
    const r = await nvHttp('/functions/v1/ia', {method: 'POST', body: {farm_id: nv.fazenda.id, acao: 'foto', pergunta: q, fotos: fotos.map(({tipo, dados}) => ({tipo, dados})), contexto: JSON.stringify(iaContextoFoto())}});
    const d = r.diagnostico && r.diagnostico.alvo ? r.diagnostico : null;
    const registra = d && ['Praga', 'Doença', 'Planta daninha'].includes(d.tipo);
    iaConversa.push({de: 'ia', texto: r.resposta || 'Sem resposta.', ...(d ? {diagnostico: d} : {}), ...(Array.isArray(r.oficiais) && r.oficiais.length ? {oficiais: r.oficiais.slice(0, 3)} : {}),
      ...(registra ? {acoes: [{tipo: 'monitoramento', tipoAlvo: d.tipo, alvo: d.alvo, talhaoId: iaTalhaoNoTexto(q), data: today()}]} : {}),
      ...(Array.isArray(r.fontes) && r.fontes.length ? {fontes: r.fontes.slice(0, 6)} : {})});
    iaArqDiag.set(iaConversa.length - 1, fotos.map(f => f.arq).filter(Boolean));
  } catch (e) {
    iaConversa.push({de: 'ia', texto: `⚠️ ${e?.message || 'Não foi possível falar com o Edy agora.'}`, erro: true});
  }
  iaOcupado = false; iaGuardar();
  if (parseRoute().name === 'assistente' && !document.querySelector('.modal.open')) render();
}

Object.assign(ACTIONS, {
  'ia-foto-tirar': i => { iaFotos.splice(Number(i), 1); const box = $('#iaFotos'); if (box) box.innerHTML = iaFotosHtml(); iaCaber(); },
  'ia-sug': q => { if (q === IA_SUG_FOTO) { if (parseRoute().name !== 'assistente') go('assistente'); return setTimeout(() => $('[data-ia-foto]')?.click(), 50); }
    if (parseRoute().name !== 'assistente') { try { sessionStorage.setItem('ia-pendente', q); } catch { /* */ } go('assistente'); } else iaPerguntar(q); },
  'ia-limpar': () => { iaConversa = []; iaFotos = []; iaArqDiag.clear(); iaGuardar(); render(); },
  // Registro preparado pelo Edy: abre o formulário preenchido
  'edy-acao': ref => {
    const [i, k] = String(ref).split('|').map(Number), m = iaConversa[i], a = m?.acoes?.[k]; if (!a || typeof edyAbrirAcao !== 'function') return;
    (m.abertas ||= []).includes(k) || m.abertas.push(k); iaGuardar();
    edyAbrirAcao(a, iaArqDiag.get(i) || []);
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
