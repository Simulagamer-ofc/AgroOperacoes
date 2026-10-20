// Bateria de testes — Moega, Secador e Silos (MercaPlant).
// Tudo é lançado pelos FORMULÁRIOS do sistema (como o operador faria). Os valores "esperados" vêm de um
// cálculo independente escrito neste roteiro (oráculo), a partir das fórmulas de referência — não do código do app.
async () => {
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const casos = [];   // {id, mod, desc, esperado, obtido, ok}
  const T = (id, mod, desc, esperado, obtido, ok) => casos.push({id, mod, desc, esperado: String(esperado), obtido: String(obtido), ok: !!ok});
  const perto = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;
  const toasts = []; const _st = showToast; showToast = (m, e) => { toasts.push((e ? '[!] ' : '') + m); return _st(m, e); };
  const aberto = () => document.getElementById('modal').classList.contains('open');
  const br = (v, d = 2) => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
  // Abre a ação, preenche e salva. confirmacoes = quantos avisos "toque de novo" aceitar. Retorna {salvo, msgs}
  async function F(act, id, vals, confirmacoes = 0) {
    closeModal?.(); toasts.length = 0;
    const r = ACTIONS[act](id); if (r?.then) await r; await espera(20);
    const f = document.querySelector('#dialog form'); if (!f) return {salvo: false, msgs: ['formulário não abriu']};
    for (const [k, v] of Object.entries(vals)) { const el = f.elements[k]; if (!el) return {salvo: false, msgs: ['campo inexistente ' + k]}; el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }
    const msgs = [];
    for (let i = 0; i <= confirmacoes && aberto(); i++) { const n = toasts.length; f.requestSubmit(); await espera(30); if (aberto()) msgs.push(toasts.slice(n).join(' | ') || 'campo inválido'); }
    const salvo = !aberto(); if (!salvo) closeModal(); return {salvo, msgs, toast: toasts.at(-1) || ''};
  }
  const vir = n => String(n).replace('.', ',');
  // ---------- Oráculo (fórmulas de referência, implementação independente) ----------
  // Balanço de massa: grão seco e limpo se conserva; desconta-se só o excesso sobre o padrão, em cascata (impureza → umidade → outros)
  function oraculoRomaneio({bruto, tara, u, up, imp, ip, metodo = 'balanco', fu = 0, fi = 1, quebra = 0, outros = 0}) {
    const liq = bruto - tara; let p = liq;
    if (metodo === 'tabela') { p *= 1 - Math.max(0, imp - ip) * fi / 100; p *= 1 - Math.max(0, u - up) * fu / 100; }
    else { if (imp > ip) p = p * (100 - imp) / (100 - ip); if (u > up) p = p * (100 - u) / (100 - up); }
    if (quebra + outros > 0) p *= 1 - (quebra + outros) / 100;
    return {liq, final: p, desc: liq - p, descPct: (liq - p) / liq * 100, sc: p / 60};
  }
  // Secagem: água sai, matéria seca fica — Mf = Mi × (100 − Ui) / (100 − Uf)
  const oraculoSecagem = (mi, ui, uf) => ({mf: mi * (100 - ui) / (100 - uf), agua: mi - mi * (100 - ui) / (100 - uf)});
  // RNG com semente: dados reprodutíveis
  let semente = 20260320; const rnd = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };
  const entre = (a, b, d = 1) => Math.round((a + rnd() * (b - a)) * 10 ** d) / 10 ** d;

  // ================= PREPARAÇÃO: unidade armazenadora =================
  db = emptyDb(); save();
  db.settings = {...db.settings, farm: 'Unidade Armazenadora Santa Clara', owner: 'Edson', respTecnico: 'Eng. Agr. Carla Souza', respRegistro: 'CREA-RS 123456'}; save();
  const maq = async (name, type, extra = {}) => { await F('mc-new', undefined, {name, type, model: extra.model || '', hours: '0', interval: '', nextService: '', state: extra.state || 'Ativa'}); return db.machines.at(-1).id; };
  const SEC = await maq('Secador contínuo 60 t/h', 'Secador', {model: 'Coluna 60'});
  const SEC_INAT = await maq('Secador antigo (desativado)', 'Secador', {state: 'Inativa'});
  const S1 = await maq('Silo 01 — soja', 'Silo/Armazém'), S2 = await maq('Silo 02 — soja', 'Silo/Armazém'), S3 = await maq('Silo 03 — milho', 'Silo/Armazém'), S4 = await maq('Silo 04 — pulmão', 'Silo/Armazém');
  for (const [s, c] of [[S1, 3000], [S2, 3000], [S3, 1500], [S4, 600]]) await F('gr-cap', s, {capacidadeT: String(c)});
  for (const [n, a, c] of [['Talhão 01 — Coxilha', 420, 'Soja'], ['Talhão 02 — Sanga', 310, 'Soja'], ['Talhão 03 — Capão', 180, 'Milho']]) await F('fd-new', undefined, {name: n, area: String(a), crop: c, season: '2025/26'});
  const [F1, F2, F3] = db.fields.map(f => f.id);

  // ================= MOE: casos calculados =================
  const casoMoega = async (id, desc, ent, dest = 'secador|' + SEC, extra = {}) => {
    const v = {dono: 'proprio', fieldId: F1, produto: 'soja', season: '2025/26', date: '2026-03-10', time: '08:00', placa: 'TST' + id.replace(/\D/g, '').padStart(4, '0'), pesoBruto: String(ent.bruto), tara: String(ent.tara), umidade: vir(ent.u), impureza: vir(ent.imp),
      umidadePadrao: vir(ent.up), impurezaPadrao: vir(ent.ip), metodoDesc: ent.metodo || 'balanco', fatorUmid: vir(ent.fu ?? ''), fatorImp: vir(ent.fi ?? 1), quebraTecnica: vir(ent.quebra || ''), outrosDesc: vir(ent.outros || ''), destino: dest, ...extra};
    const r = await F('gr-romaneio', undefined, v, 1), rom = db.romaneios.at(-1), o = oraculoRomaneio(ent);
    const ok = r.salvo && perto(rom.calc.liquido, o.liq) && perto(rom.calc.pesoFinal, o.final, 0.01);
    T(id, 'Moega', desc, `líquido ${br(o.liq, 0)} kg • desconto ${br(o.desc)} kg (${br(o.descPct, 3)}%) • final ${br(o.final)} kg = ${br(o.sc)} sc`,
      r.salvo ? `líquido ${br(rom.calc.liquido, 0)} kg • desconto ${br(rom.calc.descontoKg)} kg (${br(rom.calc.descontoPct, 3)}%) • final ${br(rom.calc.pesoFinal)} kg` : 'não salvou: ' + r.msgs.join(' / '), ok);
    return rom;
  };
  const r1 = await casoMoega('MOE-01', 'Soja úmida e suja — balanço de massa (impureza e umidade acima do padrão)', {bruto: 52840, tara: 15620, u: 17.5, up: 14, imp: 2.0, ip: 1.0});
  await casoMoega('MOE-02', 'Soja seca e limpa — abaixo do padrão não tem desconto', {bruto: 51200, tara: 15480, u: 12.8, up: 14, imp: 0.6, ip: 1.0}, 'silo|' + S1);
  await casoMoega('MOE-03', 'Só umidade acima do padrão (impureza dentro)', {bruto: 50310, tara: 15550, u: 19.2, up: 14, imp: 0.8, ip: 1.0});
  await casoMoega('MOE-04', 'Tabela da cooperativa: 1,5% por ponto de umidade e 1% por ponto de impureza, com quebra técnica de 0,3%', {bruto: 49870, tara: 15610, u: 16.0, up: 14, imp: 3.0, ip: 1.0, metodo: 'tabela', fu: 1.5, fi: 1, quebra: 0.3});
  await casoMoega('MOE-05', 'Milho úmido — balanço de massa com outros descontos (avariados) de 0,5%', {bruto: 47920, tara: 15900, u: 23.4, up: 14, imp: 1.8, ip: 1.0, outros: 0.5}, 'secador|' + SEC, {produto: 'milho', fieldId: F3});
  // Colheita gerada em Produção (peso final arredondado)
  const col = db.colheitas.find(c => c.romaneioId === r1.id);
  T('MOE-06', 'Moega', 'Carga própria com talhão vira colheita do talhão em Produção (peso já descontado)', `${Math.round(r1.calc.pesoFinal)} kg na safra 2025/26`, col ? `${col.kg} kg na safra ${col.season}` : 'sem colheita', col && col.kg === Math.round(r1.calc.pesoFinal) && col.season === '2025/26');
  T('MOE-07', 'Moega', 'Numeração sequencial dos romaneios', '1, 2, 3, 4, 5', db.romaneios.map(r => r.numero).join(', '), db.romaneios.map(r => r.numero).join(',') === '1,2,3,4,5');
  // Validações
  let r = await F('gr-romaneio', undefined, {pesoBruto: '15000', tara: '15600', umidade: '14', destino: 'secador|' + SEC});
  T('MOE-08', 'Moega', 'Bloqueia peso bruto menor ou igual à tara', 'não registra e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /maior que a tara/.test(r.msgs[0]));
  r = await F('gr-romaneio', undefined, {dono: 'terceiro', depositante: '', fieldId: '', pesoBruto: '45000', tara: '15000', umidade: '14', destino: 'secador|' + SEC});
  T('MOE-09', 'Moega', 'Carga de terceiro exige o nome do dono', 'não registra e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /nome do terceiro/.test(r.msgs[0]));
  r = await F('gr-romaneio', undefined, {produto: 'outro', produtoNome: '', pesoBruto: '45000', tara: '15000', umidade: '14', destino: 'secador|' + SEC});
  T('MOE-10', 'Moega', 'Cultura "Outro" exige o nome da cultura', 'não registra e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /qual é a cultura/.test(r.msgs[0]));
  r = await F('gr-romaneio', undefined, {metodoDesc: 'tabela', fatorUmid: '', pesoBruto: '45000', tara: '15000', umidade: '16', destino: 'secador|' + SEC});
  T('MOE-11', 'Moega', 'Tabela da cooperativa exige o desconto por ponto de umidade', 'não registra e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /desconto por ponto/.test(r.msgs[0]));
  const n0r = db.romaneios.length;
  r = await F('gr-romaneio', undefined, {placa: 'tst-0001', date: '2026-03-10', time: '08:20', pesoBruto: '52000', tara: '15600', umidade: '17', impureza: '1', destino: 'secador|' + SEC}, 0);
  T('MOE-12', 'Moega', 'Mesma placa em até 30 min: avisa possível lançamento em dobro (placa digitada em minúscula e com traço)', 'pede confirmação', r.salvo ? 'registrou sem avisar' : r.msgs[0], !r.salvo && /já tem o romaneio/.test(r.msgs[0]) && db.romaneios.length === n0r);
  r = await F('gr-romaneio', undefined, {pesoBruto: '50000', tara: '15500', umidade: '16,5', impureza: '1', destino: 'silo|' + S1}, 0);
  T('MOE-13', 'Moega', 'Carga úmida (16,5%) mandada direto ao silo: alerta antes de registrar', 'pede confirmação', r.salvo ? 'registrou sem avisar' : r.msgs[0], !r.salvo && /acima do padrão/.test(r.msgs[0]));
  const destinos = (() => { ACTIONS['gr-romaneio'](); const o = [...document.querySelectorAll('#dialog [name=destino] option')].map(x => x.textContent); closeModal(); return o; })();
  T('MOE-14', 'Moega', 'Secador desativado não aparece como destino', 'só equipamentos ativos', destinos.join(' • '), !destinos.some(d => /antigo/.test(d)));
  r = await F('gr-romaneio', undefined, {pesoBruto: '45.000', tara: '15000', umidade: '14', destino: 'secador|' + SEC});
  T('MOE-15', 'Moega', 'Número ambíguo "45.000" não é aceito sem confirmar a escrita (evita 45 kg × 45 t)', 'pede para escrever 45000 ou 45.000,00', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /ambíguo/.test(r.msgs[0]));
  // Edição recalcula e atualiza a colheita
  const edit = db.romaneios[0];
  r = await F('gr-rom-edit', edit.id, {umidade: '15,0', motivoAlteracao: 'Reamostragem: medidor conferido com estufa'});
  const oEd = oraculoRomaneio({bruto: 52840, tara: 15620, u: 15.0, up: 14, imp: 2.0, ip: 1.0}), colEd = db.colheitas.find(c => c.romaneioId === edit.id);
  const edN = find('romaneios', edit.id);
  T('MOE-16', 'Moega', 'Editar a umidade do romaneio (17,5% → 15,0%) recalcula o desconto e a colheita em Produção', `final ${br(oEd.final)} kg • colheita ${Math.round(oEd.final)} kg`, `final ${br(edN.calc.pesoFinal)} kg • colheita ${colEd?.kg} kg`, perto(edN.calc.pesoFinal, oEd.final) && colEd?.kg === Math.round(oEd.final) && db.colheitas.filter(c => c.romaneioId === edit.id).length === 1);
  // Classificação oficial
  const regras = await dados('regras'); regrasGraos = regras;
  const classif = async (romId, grupo, vals) => { await F('gr-classif', romId, {...(grupo ? {grupo} : {}), ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, vir(v)]))}); return find('romaneios', romId).classif?.resultado; };
  let c1 = await classif(db.romaneios[1].id, 'II', {avariados_total: 4.2, ardidos_queimados: 1.1, queimados: 0.2, mofados: 0.8, esverdeados: 2.5, quebrados: 12, impurezas: 0.6});
  T('MOE-17', 'Classificação', 'Soja Grupo II dentro de todos os limites da IN MAPA 11/2007', 'Padrão Básico', c1?.enquadramento, /Padrão Básico/i.test(c1?.enquadramento || ''));
  c1 = await classif(db.romaneios[2].id, 'II', {avariados_total: 9.5, ardidos_queimados: 2, queimados: 0.4, mofados: 1, esverdeados: 3, quebrados: 14, impurezas: 0.8});
  T('MOE-18', 'Classificação', 'Soja Grupo II com avariados 9,5% (limite 8%)', 'Fora de Tipo', c1?.enquadramento, /Fora/i.test(c1?.enquadramento || ''));
  c1 = await classif(db.romaneios[4].id, '', {avariados_total: 7.2, ardidos: 1.6, quebrados: 3.6, impurezas: 1.2, carunchados: 1.5});
  T('MOE-19', 'Classificação', 'Milho com ardidos 1,6%, quebrados 3,6%, impurezas 1,2% (IN MAPA 60/2011)', 'Tipo 2', c1?.enquadramento, /Tipo 2/.test(c1?.enquadramento || ''));
  c1 = await classif(db.romaneios[4].id, '', {avariados_total: 18, ardidos: 3.5, quebrados: 4, impurezas: 1, carunchados: 2});
  T('MOE-20', 'Classificação', 'Milho com avariados 18% e ardidos 3,5% (acima do Tipo 3)', 'Fora de Tipo', c1?.enquadramento, /Fora/i.test(c1?.enquadramento || ''));

  // ================= SEC: secagem =================
  const esperaTodas = cargasEsperando(SEC), espera1 = esperaTodas.filter(x => x.produto === 'soja'), sugMassa = espera1.reduce((s, x) => s + x.calc.liquido * (1 - Number(x.impureza) / 100), 0);
  const sugU = espera1.reduce((s, x) => s + Number(x.umidade) * x.calc.liquido, 0) / espera1.reduce((s, x) => s + x.calc.liquido, 0);
  ACTIONS['gr-secar'](SEC); await espera(20);
  const fSec = document.querySelector('#dialog form'), sugApp = {m: numeroBR(fSec.elements.massaT.value), u: numeroBR(fSec.elements.umidadeEntrada.value)};
  T('SEC-01', 'Secador', `Carga sugerida = líquido das ${espera1.length} cargas de soja em espera menos a impureza medida (sai na pré-limpeza)`, `${br(Math.round(sugMassa / 100) / 10, 1)} t`, `${br(sugApp.m, 1)} t`, perto(sugApp.m, Math.round(sugMassa / 100) / 10, 0.05));
  T('SEC-02', 'Secador', 'Umidade de entrada sugerida = média ponderada pelo peso líquido', `${br(Math.round(sugU * 10) / 10, 1)}%`, `${br(sugApp.u, 1)}%`, perto(sugApp.u, Math.round(sugU * 10) / 10, 0.05));
  const secOpts = [...fSec.elements.secadorId.options].map(o => o.textContent); closeModal();
  T('SEC-03', 'Secador', 'Secador desativado não aparece para iniciar secagem', 'só o secador ativo', secOpts.join(' • '), secOpts.length === 1);
  // Lote controlado: 120 t de soja a 18,0% → meta 13%
  r = await F('gr-secar', SEC, {produto: 'soja', destino: 'armazenamento_graos', umidadeMeta: '13', massaT: '120', umidadeEntrada: '18', combTipo: 'lenha', combPreco: '95'});
  const L = db.lotesSecagem.at(-1); L.inicio = '2026-03-10T09:00'; save();
  r = await F('gr-secar', SEC, {massaT: '10', umidadeEntrada: '18'});
  T('SEC-04', 'Secador', 'Com um lote em andamento, "Iniciar secagem" abre o lote aberto (não cria dois no mesmo secador)', '1 lote em andamento', `${db.lotesSecagem.filter(l => l.status === 'Em andamento').length} em andamento`, db.lotesSecagem.filter(l => l.status === 'Em andamento').length === 1);
  closeModal();
  T('SEC-05', 'Secador', 'Cargas de soja em espera ficam vinculadas ao lote (rastreabilidade carga → secagem)', `${espera1.length} cargas`, `${L.romaneioIds.length} cargas`, L.romaneioIds.length === espera1.length);
  const milhoFora = esperaTodas.filter(x => x.produto === 'milho');
  T('SEC-18', 'Secador', `Havia ${esperaTodas.length} cargas na fila (${espera1.length} de soja e ${milhoFora.length} de milho): o lote de soja não mistura o milho, que fica esperando o próximo lote`, `milho fora do lote e ainda na fila`, `${milhoFora.some(x => L.romaneioIds.includes(x.id)) ? 'milho entrou no lote de soja' : 'milho fora do lote'} • ${cargasEsperando(SEC).filter(x => x.produto === 'milho').length} de milho na fila`, milhoFora.length > 0 && !milhoFora.some(x => L.romaneioIds.includes(x.id)) && cargasEsperando(SEC).filter(x => x.produto === 'milho').length === milhoFora.length);
  // Leituras de hora em hora (o roteiro ajusta o horário de cada leitura para simular a secagem real)
  // Sensores do secador iguais ao painel: controlador do ar (Entringer) e alarme com P1…P4 (TSW Winckieel)
  await F('gr-sensores', SEC, {temAr: 'sim', arNome: 'Entringer', alarmeNome: 'TSW Winckieel', tipo_P1: 'massa', local_P1: 'coluna, parte de baixo', tipo_P2: 'massa', local_P2: 'coluna, meio', tipo_P3: 'massa', local_P3: 'coluna, parte de cima', tipo_P4: 'massa', local_P4: 'saída do grão'});
  ACTIONS['gr-leitura'](L.id); await espera(20);
  const rotulos = [...document.querySelectorAll('#dialog form label')].map(x => x.textContent.replace(/\s+/g, ' ').trim()); closeModal();
  T('LEI-01', 'Leitura', 'Leitura do secador segue o painel: ar quente do Entringer e pontos P1 a P4 do TSW, com o local de cada um', 'campos "Ar quente — visor do Entringer" e "P1 — coluna, parte de baixo" … "P4"', rotulos.filter(x => /Ar quente|^P\d/.test(x)).map(x => x.replace(/ \(°C\).*/, '')).join(' • '),
    rotulos.some(x => /Ar quente — visor do Entringer/.test(x)) && ['P1 — coluna, parte de baixo', 'P2 — coluna, meio', 'P3 — coluna, parte de cima', 'P4 — saída do grão'].every(r => rotulos.some(x => x.startsWith(r))) && !rotulos.some(x => /Temperatura da massa/.test(x)));
  r = await F('gr-leitura', L.id, {hora: '00:30', tAr: '95', p_P1: '36', p_P2: '410', umidade: '17'});
  T('LEI-02', 'Leitura', 'Número fora do possível (410 °C no P2, em vez de 41) é barrado como erro de digitação', 'pede para conferir o visor', r.salvo ? 'salvou' : r.msgs[0], !r.salvo && /digitado errado/.test(r.msgs[0]) && /P2/.test(r.msgs[0]));
  // P1…P4 de hora em hora (a massa é o ponto mais quente); às 12h o P3 passa de 40 °C; às 13h o P4 mostra OFF (em branco)
  const leituras = [[10, 82, [31, 34, 36, 33], 17.1], [11, 88, [33, 38, 37, 35], 16.0], [12, 92, [35, 39, 41, 38], 15.0], [13, 90, [34, 37, 39, ''], 14.1]];
  let toastMassa = '';
  for (const [h, ar, ps, u] of leituras) { const rr = await F('gr-leitura', L.id, {hora: '00:30', tAr: String(ar), p_P1: String(ps[0]), p_P2: String(ps[1]), p_P3: String(ps[2]), p_P4: String(ps[3]), umidade: vir(u)}); if (h === 12) toastMassa = rr.toast; const lt = L.leituras.at(-1); lt.em = `2026-03-10T${h}:00`; L.leituras.sort((a, b) => a.em.localeCompare(b.em)); }
  const l12 = L.leituras.find(x => x.em.endsWith('12:00')), l13 = L.leituras.find(x => x.em.endsWith('13:00'));
  T('LEI-03', 'Leitura', 'Guarda os 4 pontos, usa o mais quente como temperatura da massa e diz em linguagem simples qual ponto passou do limite', 'massa 41 °C no P3 • aviso cita P3 e o limite de 40 °C', `massa ${l12?.tMassa} °C no ${l12?.pontoQuente} • ${toastMassa.replace('[!] ', '')}`,
    l12?.tMassa === 41 && l12.pontoQuente === 'P3' && Object.keys(l12.pontos).length === 4 && /P3 com 41 °C/.test(toastMassa) && /limite de 40 °C/.test(toastMassa));
  T('LEI-04', 'Leitura', 'Ponto mostrando OFF fica em branco e não atrapalha: a massa é o maior dos outros', 'P4 vazio • massa 39 °C (P3)', `P4 ${l13?.pontos?.P4 ?? 'vazio'} • massa ${l13?.tMassa} °C (${l13?.pontoQuente})`, l13 && l13.pontos.P4 == null && l13.tMassa === 39 && l13.pontoQuente === 'P3');
  save();
  const avs = L.leituras.map(x => x.aval?.find(a => a.ponto === 'massa_graos')?.status);
  T('SEC-06', 'Secador', 'Massa de soja (grão) comparada ao limite de 40 °C (Embrapa): 36, 38, 41 e 39 °C', 'OK, OK, FORA, OK', avs.map(s => s === 'FORA_DO_PADRAO' ? 'FORA' : s).join(', '), avs.join() === 'OK,OK,FORA_DO_PADRAO,OK');
  const htmlLote = VIEWS.graos('lote/' + L.id);
  T('LEI-05', 'Leitura', 'Planilha de secagem mostra P1 a P4, a massa máxima e a situação de cada hora', 'colunas P1…P4 • "Massa acima de 40 °C (P3)"', `${['P1', 'P2', 'P3', 'P4'].every(p => htmlLote.includes(`>${p}</th>`)) ? 'colunas P1…P4' : 'faltam colunas'} • ${/Massa acima de 40 °C \(P3\)/.test(htmlLote) ? 'situação com P3' : 'sem situação'}`, ['P1', 'P2', 'P3', 'P4'].every(p => htmlLote.includes(`>${p}</th>`)) && /Massa acima de 40 °C \(P3\)/.test(htmlLote));
  const prev = calcSecagem({...L, fim: null});
  const ritmo = (14.1 - 15.0) / -1, faltam = (14.1 - 13) / ritmo;
  T('SEC-07', 'Secador', 'Previsão de término pelo ritmo das duas últimas leituras (15,0% → 14,1% em 1 h; meta 13%)', `${br(ritmo)} ponto/h • chega ~${String(13 + Math.floor(faltam)).padStart(2, '0')}:${String(Math.round((faltam % 1) * 60)).padStart(2, '0')}`, prev.previsao?.fim ? `${br(prev.previsao.ritmo)} ponto/h • chega ~${String(prev.previsao.fim.getHours()).padStart(2, '0')}:${String(prev.previsao.fim.getMinutes()).padStart(2, '0')}` : 'sem previsão', perto(prev.previsao?.ritmo, ritmo) && prev.previsao.fim.getHours() === 14 && Math.abs(prev.previsao.fim.getMinutes() - Math.round((faltam % 1) * 60)) <= 1);
  r = await F('gr-finalizar', L.id, {umidadeSaida: '14,5', siloId: S1, combQtd: '', combPreco: '95'}, 0);
  T('SEC-08', 'Secador', 'Finalizar com 14,5% (acima do limite de armazenagem de 13% para soja): pede confirmação', 'avisa e não finaliza', r.salvo ? 'finalizou sem avisar' : r.msgs[0], !r.salvo && L.status === 'Em andamento');
  r = await F('gr-finalizar', L.id, {umidadeSaida: '13', siloId: S1, combQtd: '7,2', combPreco: '95', kwh: '480', precoKwh: '0,82'});
  L.fim = '2026-03-10T15:00'; save();
  const cL = calcSecagem(L), oL = oraculoSecagem(120000, 18, 13), custo = 7.2 * 95 + 480 * 0.82;
  T('SEC-09', 'Secador', 'Grão seco pelo balanço de água: 120 t de 18% para 13% (Mf = Mi × (100−Ui)/(100−Uf))', `${br(oL.mf)} kg • água ${br(oL.agua)} kg`, `${br(cL.mf)} kg • água ${br(cL.agua)} kg`, perto(cL.mf, oL.mf) && perto(cL.agua, oL.agua));
  T('SEC-10', 'Secador', 'Rendimento e pontos retirados por hora (6 h de secagem)', `${br(120 / 6)} t/h • ${br(5 / 6)} ponto/h`, `${br(cL.tph)} t/h • ${br(cL.ppH)} ponto/h`, perto(cL.tph, 20) && perto(cL.ppH, 5 / 6));
  T('SEC-11', 'Secador', 'Custo da secagem: 7,2 m³ de lenha × R$ 95 + 480 kWh × R$ 0,82, por saca seca', `R$ ${br(custo)} • R$ ${br(custo / (oL.mf / 60))}/sc • ${br(7.2 / 120, 3)} m³/t`, `R$ ${br(cL.custo)} • R$ ${br(cL.custoSc)}/sc • ${br(cL.combPorT, 3)} m³/t`, perto(cL.custo, custo) && perto(cL.custoSc, custo / (oL.mf / 60)) && perto(cL.combPorT, 0.06, 0.0001));
  T('SEC-12', 'Secador', 'Grão seco entra no silo de destino', `Silo 01 recebe ${br(oL.mf, 0)} kg do secador`, (() => { const e = movimentosSilo(S1).ent.find(x => x.tipo === 'Do secador'); return e ? `Silo 01 recebe ${br(e.kg, 0)} kg do secador` : 'não entrou'; })(), perto(movimentosSilo(S1).ent.find(x => x.tipo === 'Do secador')?.kg, oL.mf));
  // Leitura de madrugada
  await F('gr-romaneio', undefined, {dono: 'proprio', fieldId: F3, produto: 'milho', season: '2025/26', date: '2026-03-11', time: '07:40', placa: 'IXA3D21', pesoBruto: '48160', tara: '16020', umidade: '22,6', impureza: '1,4', umidadePadrao: '14', impurezaPadrao: '1', metodoDesc: 'balanco', destino: 'secador|' + SEC});
  r = await F('gr-secar', SEC, {produto: 'milho', destino: 'racao_animal', umidadeMeta: '13'});
  const L2 = db.lotesSecagem.at(-1); const futura = new Date(Date.now() + 3 * 36e5);
  await F('gr-leitura', L2.id, {hora: `${String(futura.getHours()).padStart(2, '0')}:00`, tAr: '80'});
  T('SEC-13', 'Secador', 'Leitura anotada após a meia-noite para um horário "à frente" do relógio fica no dia anterior', `${daysAgo(1)} ${String(futura.getHours()).padStart(2, '0')}:00`, L2.leituras.at(-1).em.replace('T', ' '), L2.leituras.at(-1).em.startsWith(daysAgo(1)) || futura.getDate() !== new Date().getDate());
  const arMilho = L2.leituras.at(-1).aval?.find(a => a.ponto === 'ar_entrada');
  T('SEC-14', 'Secador', 'Milho para ração: ar de entrada 80 °C comparado ao limite de 82 °C', 'OK', arMilho?.status, arMilho?.status === 'OK');
  const limp1 = alerts().some(a => /Limpeza do secador/.test(a.title));
  await F('gr-limpeza', SEC, {date: today(), responsavel: 'João Pereira'});
  const limp2 = alerts().some(a => /Limpeza do secador/.test(a.title));
  T('SEC-17', 'Secador', 'Secador em uso sem limpeza registrada: aviso de risco de incêndio; some após registrar a limpeza', 'aviso aparece → some', `${limp1 ? 'aviso aparece' : 'sem aviso'} → ${limp2 ? 'continua' : 'some'}`, limp1 && !limp2);
  // Excluir lote devolve as cargas e tira o grão do silo
  const romsL2 = L2.romaneioIds.length; remove('lotesSecagem', L2.id);
  T('SEC-15', 'Secador', 'Excluir uma secagem devolve as cargas para "esperando secagem"', `${romsL2} cargas voltam`, `${cargasEsperando(SEC).length} esperando`, cargasEsperando(SEC).length >= romsL2);
  r = await F('gr-rom-del', db.romaneios[0].id, {});
  T('SEC-16', 'Secador', 'Romaneio que já entrou numa secagem não pode ser excluído', 'bloqueia e avisa', /já entrou numa secagem/.test(toasts.join(' ')) ? 'bloqueou' : 'permitiu', /já entrou numa secagem/.test(toasts.join(' ')) && find('romaneios', db.romaneios[0].id));
  closeModal();

  // ================= SIL: silos =================
  const saldo = id => saldoSilo(find('machines', id));
  const s1a = saldo(S1);
  const direto = db.romaneios.find(x => x.destinoTipo === 'silo' && x.destinoId === S1);
  T('SIL-01', 'Silos', 'Saldo do silo = cargas recebidas direto + grão seco do secador', `${br(direto.calc.pesoFinal + oL.mf)} kg`, `${br(s1a.saldo)} kg`, perto(s1a.saldo, direto.calc.pesoFinal + oL.mf));
  T('SIL-02', 'Silos', 'Ocupação sobre a capacidade de 3.000 t', `${br((direto.calc.pesoFinal + oL.mf) / 3e6 * 100, 2)}%`, `${br(s1a.ocupacao, 2)}%`, perto(s1a.ocupacao, (direto.calc.pesoFinal + oL.mf) / 3e6 * 100));
  const uPond = (direto.calc.pesoFinal * 12.8 + oL.mf * 13) / (direto.calc.pesoFinal + oL.mf);
  T('SIL-03', 'Silos', 'Umidade média do silo ponderada pelo peso de cada entrada', `${br(uPond, 2)}%`, `${br(s1a.uMedia, 2)}%`, perto(s1a.uMedia, uPond));
  r = await F('gr-saida', S1, {siloId: S1, tipo: 'saida', date: '2026-04-02', kg: String(Math.round(s1a.saldo) + 5000), dono: 'proprio', lancarVenda: 'nao'});
  T('SIL-04', 'Silos', 'Expedição maior que o saldo é bloqueada', 'bloqueia e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /não pode passar do saldo/.test(r.msgs[0]));
  r = await F('gr-saida', S1, {siloId: S1, tipo: 'transferencia', date: '2026-04-02', kg: '1000', dono: 'proprio', destinoSiloId: S1});
  T('SIL-05', 'Silos', 'Transferência para o mesmo silo é bloqueada', 'bloqueia e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /outro silo/.test(r.msgs[0]));
  r = await F('gr-saida', S1, {siloId: S1, tipo: 'saida', date: '2026-04-03', kg: '60000', dono: 'proprio', comprador: 'Cooperativa Tritícola', placa: 'IVR2B44', lancarVenda: 'sim', preco: '128,50', season: '2025/26', recebimento: 'A prazo', vencimento: '2026-05-03'});
  const vd = db.vendas.at(-1), ct = db.contas.at(-1);
  T('SIL-06', 'Silos', 'Expedição de 60.000 kg a R$ 128,50/sc lança a venda (1.000 sc) e a conta a receber a prazo', `1.000 sc • R$ ${br(128500)} • conta aberta venc. 03/05/2026`, vd ? `${br(vd.sacas, 0)} sc • R$ ${br(vd.valor)} • conta ${ct.status} venc. ${fmtDate(ct.vencimento)}` : 'sem venda', vd?.sacas === 1000 && perto(vd.valor, 128500) && ct.status === 'aberta' && ct.vencimento === '2026-05-03' && ct.tipo === 'receber');
  r = await F('gr-saida', S1, {siloId: S1, tipo: 'transferencia', date: '2026-04-05', kg: '20000', dono: 'proprio', destinoSiloId: S4});
  r = await F('gr-saida', S4, {siloId: S4, tipo: 'ajuste', date: '2026-04-06', kg: '-180', dono: 'proprio', notes: 'Quebra técnica de armazenagem'});
  const s1b = saldo(S1), s4 = saldo(S4);
  T('SIL-07', 'Silos', 'Transferência de 20 t do Silo 01 para o 04 e ajuste de −180 kg no 04', `Silo 01: ${br(s1a.saldo - 60000 - 20000)} kg • Silo 04: ${br(20000 - 180)} kg`, `Silo 01: ${br(s1b.saldo)} kg • Silo 04: ${br(s4.saldo)} kg`, perto(s1b.saldo, s1a.saldo - 80000) && perto(s4.saldo, 19820));
  const mvVenda = db.movSilo.find(m => m.vendaId === vd.id); await (async () => { excluirMovSilo(mvVenda.id); await espera(20); document.querySelector('#dialog .danger, #dialog .primary')?.click(); await espera(20); })();
  T('SIL-08', 'Silos', 'Excluir a expedição remove junto a venda e a conta a receber', 'venda e conta removidas; saldo volta', `venda ${find('vendas', vd.id) ? 'ficou' : 'removida'} • conta ${db.contas.some(c => c.vendaId === vd.id) ? 'ficou' : 'removida'} • saldo ${br(saldo(S1).saldo)} kg`, !find('vendas', vd.id) && !db.contas.some(c => c.vendaId === vd.id) && perto(saldo(S1).saldo, s1b.saldo + 60000));
  // Terceiro
  await F('gr-saida', S1, {siloId: S1, tipo: 'transferencia', date: '2026-04-06', kg: '50000', dono: 'proprio', destinoSiloId: S2});
  await F('gr-tarifas', undefined, {secagemT: '28', armazenagemScMes: '0,30'});
  r = await F('gr-romaneio', undefined, {dono: 'terceiro', depositante: 'Agropecuária Lima', fieldId: '', produto: 'soja', season: '2025/26', date: daysAgo(30), time: '10:00', placa: 'IVT4455', pesoBruto: '46200', tara: '15400', umidade: '13', impureza: '0,8', umidadePadrao: '14', impurezaPadrao: '1', metodoDesc: 'balanco', destino: 'silo|' + S2});
  const rt = db.romaneios.at(-1);
  T('SIL-09', 'Terceiros', 'Grão de terceiro não vira colheita da fazenda', 'nenhuma colheita gerada', db.colheitas.some(c => c.romaneioId === rt.id) ? 'gerou colheita' : 'nenhuma colheita', !db.colheitas.some(c => c.romaneioId === rt.id));
  r = await F('gr-saida', S2, {siloId: S2, tipo: 'saida', date: daysAgo(10), kg: '40000', dono: 'terceiro|Agropecuária Lima', lancarVenda: 'nao'});
  T('SIL-10', 'Terceiros', 'Retirada de 40 t por terceiro que tem 30,8 t é bloqueada (silo tem saldo, o terceiro não)', 'bloqueia e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /armazenados/.test(r.msgs[0]));
  r = await F('gr-saida', S2, {siloId: S2, tipo: 'saida', date: daysAgo(10), kg: '15000', dono: 'terceiro|Agropecuária Lima', lancarVenda: 'nao'});
  const ex = extratoTerceiro('Agropecuária Lima');
  let armOr = 0; for (let d = 30; d >= 0; d--) { const dt = daysAgo(d); const sd = rt.calc.pesoFinal - (dt >= daysAgo(10) ? 15000 : 0); armOr += sd / 60 * 0.30 / 30; }
  T('SIL-11', 'Terceiros', 'Extrato do terceiro: saldo e armazenagem diária (R$ 0,30/sc/mês sobre o saldo de cada dia)', `saldo ${br(rt.calc.pesoFinal - 15000)} kg • armazenagem R$ ${br(armOr)}`, `saldo ${br(ex.saldo)} kg • armazenagem R$ ${br(ex.armazenagem)}`, perto(ex.saldo, rt.calc.pesoFinal - 15000) && perto(ex.armazenagem, armOr));

  // Tarifas completas de terceiros: recepção, secagem, armazenagem e quebra técnica mensal
  await F('gr-tarifas', undefined, {recepcaoT: '6', secagemT: '28', armazenagemScMes: '0,30', quebraMes: '0,1'});
  const ex2 = extratoTerceiro('Agropecuária Lima');
  let arm2 = 0, qb2 = 0; for (let d = 30; d >= 0; d--) { const dt = daysAgo(d); const sdB = rt.calc.pesoFinal - (dt >= daysAgo(10) ? 15000 : 0), sdL = Math.max(0, sdB - qb2); arm2 += sdL / 60 * 0.30 / 30; qb2 += sdL * 0.001 / 30; }
  const rec2 = 6 * rt.calc.liquido / 1000;
  T('TER-01', 'Terceiros', 'Quebra técnica de 0,1% ao mês sobre o saldo de cada dia sai do saldo do depositante; recepção de R$ 6/t sobre o líquido recebido', `quebra ${br(qb2)} kg • saldo ${br(rt.calc.pesoFinal - 15000 - qb2)} kg • recepção R$ ${br(rec2)} • armazenagem R$ ${br(arm2)}`, `quebra ${br(ex2.quebra)} kg • saldo ${br(ex2.saldo)} kg • recepção R$ ${br(ex2.recepcao)} • armazenagem R$ ${br(ex2.armazenagem)}`, perto(ex2.quebra, qb2) && perto(ex2.saldo, rt.calc.pesoFinal - 15000 - qb2) && perto(ex2.recepcao, rec2) && perto(ex2.armazenagem, arm2));
  T('TER-02', 'Terceiros', 'Total a cobrar = recepção + secagem + armazenagem', `R$ ${br(rec2 + arm2)}`, `R$ ${br(ex2.total)}`, perto(ex2.total, rec2 + ex2.secagem + arm2) && perto(ex2.total, rec2 + arm2));
  r = await F('gr-saida', S2, {siloId: S2, tipo: 'saida', date: today(), kg: String(Math.round(rt.calc.pesoFinal - 15000)), dono: 'terceiro|Agropecuária Lima', lancarVenda: 'nao'});
  T('TER-03', 'Terceiros', 'Retirar o saldo sem descontar a quebra é bloqueado (o depositante tem menos por causa da quebra)', 'bloqueia e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /armazenados/.test(r.msgs[0]));
  const htmlExt = VIEWS.graos('extrato/' + encodeURIComponent('Agropecuária Lima'));
  T('TER-04', 'Terceiros', 'Extrato impresso mostra a recepção e a quebra técnica', 'linhas de recepção e quebra', `${/Recepção/.test(htmlExt) ? 'recepção' : 'sem recepção'} • ${/Quebra técnica/.test(htmlExt) ? 'quebra' : 'sem quebra'}`, /Recepção/.test(htmlExt) && /Quebra técnica de armazenagem/.test(htmlExt));
  // Termometria, expurgo, inventário
  await F('gr-termo', S1, {date: '2026-04-10', time: '08:00', c0: '22', c1: '23', c2: '22', c3: '21', insetos: 'nao'});
  await F('gr-termo', S1, {date: '2026-04-17', time: '08:00', c0: '22', c1: '25,5', c2: '22', c3: '21', insetos: 'poucos', especie: 'Rhyzopertha dominica'});
  const tm = termometriaSilo(S1);
  T('SIL-12', 'Silos', 'Termometria: cabo 2 subiu 2,5 °C em uma semana (critério: ≥ 2 °C)', 'cabo 2 marcado', tm.subindo.map(c => `cabo ${c.cabo} +${br(c.dif, 1)} °C`).join(', ') || 'nenhum', tm.subindo.length === 1 && tm.subindo[0].cabo === 2);
  T('SIL-13', 'Silos', 'Insetos vivos na vistoria geram aviso', 'aviso "Insetos no Silo 01"', alerts().filter(a => /Insetos/.test(a.title)).map(a => a.title).join(' • ') || 'sem aviso', alerts().some(a => /Insetos no Silo 01/.test(a.title)));
  const agora = new Date(); await F('gr-expurgo', S1, {date: today(), time: `${String(agora.getHours()).padStart(2, '0')}:00`, produto: 'Fosfina (fosfeto de alumínio)', dose: '2 g/m³', exposicaoH: '120', praga: 'Rhyzopertha dominica', receituario: 'RA 7781', responsavel: 'Aplicador credenciado'});
  r = await F('gr-saida', S1, {siloId: S1, tipo: 'saida', date: today(), kg: '1000', dono: 'proprio', lancarVenda: 'nao'});
  T('SIL-14', 'Silos', 'Silo em expurgo (120 h de exposição): movimentação pede confirmação de liberação', 'bloqueia e avisa', r.salvo ? 'registrou sem avisar' : r.msgs[0], !r.salvo && /expurgo/.test(r.msgs[0]));
  ACTIONS['gr-expurgo-fim'](db.checklistsGraos.find(c => c.tipo === 'expurgo').id);
  const sdInv = saldo(S1).saldo; await F('gr-inventario', S1, {date: '2026-06-30', medidoT: vir(Math.round((sdInv - 4300) / 100) / 10), metodo: 'cubagem', responsavel: 'Ana Costa'});
  const inv = db.checklistsGraos.find(c => c.tipo === 'inventario'), medido = Math.round((sdInv - 4300) / 100) * 100;
  T('SIL-15', 'Silos', 'Inventário por cubagem: diferença calculada e estoque ajustado ao medido', `${br(medido - sdInv, 0)} kg (${br((medido - sdInv) / sdInv * 100, 2)}%) • saldo ${br(medido, 0)} kg`, `${br(inv.difKg, 0)} kg (${br(inv.difPct, 2)}%) • saldo ${br(saldo(S1).saldo, 0)} kg`, perto(inv.difKg, medido - sdInv, 1) && perto(saldo(S1).saldo, medido, 1));
  const org = origemSilo(S1);
  T('SIL-16', 'Silos', 'Rastreabilidade: origem do grão do Silo 01 por talhão (só talhões de soja, soma 100%)', 'Talhão 01 — Coxilha 100%', `${org.map(o => `${o.nome} ${br(o.pct, 1)}%`).join(' • ')}`, perto(org.reduce((s, o) => s + o.pct, 0), 100) && !org.some(o => /Talhão 03/.test(o.nome)));
  // Medidor de umidade
  await F('gr-medidor', undefined, {medidor: 'Gehaka G650 — moega', date: '2026-02-20', ref: 'estufa', produto: 'soja', m1: '14,6', r1: '14,2', m2: '16,1', r2: '15,8', m3: '18,4', r3: '18,0', m4: '13,2', r4: '13,0', m5: '20,3', r5: '19,8', tolerancia: '0,5'});
  const med = db.checklistsGraos.find(c => c.tipo === 'conf_umidade');
  T('SIL-17', 'Medidor', 'Conferência do medidor da moega contra estufa (5 amostras, tolerância ±0,5 ponto)', 'erro médio +0,36 ponto • dentro da tolerância', `erro médio ${med.erroMedio >= 0 ? '+' : ''}${br(med.erroMedio)} ponto • ${med.ok ? 'dentro' : 'fora'} da tolerância`, perto(med.erroMedio, 0.36) && med.ok === true);
  T('SIL-18', 'Medidor', 'Medidor sem verificação anual do Inmetro (Portaria 47/2022) fica sinalizado', 'pendente', /verificação|Inmetro/i.test(blocoMedidores()) ? 'sinalizado' : 'não sinalizado', /Inmetro/.test(blocoMedidores()));
  // Limpeza do secador

  // ================= VOL: safra simulada em volume (lote de cargas reais) =================
  const t0 = performance.now(); const vol = [];
  const PROD = [['soja', F1, 'secador', 60, 17.5, 3.2, 1.6, 0.8], ['soja', F2, 'secador', 45, 16.8, 2.8, 1.4, 0.7], ['milho', F3, 'secador', 35, 22.5, 3.0, 1.8, 0.8]];
  let placa = 1000;
  for (const [prod, fid, , n, um, du, im, di] of PROD) for (let i = 0; i < n; i++) {
    const tara = Math.round(entre(15200, 17200, 0)), liq = Math.round(entre(34000, 38500, 0)), u = Math.max(12.2, entre(um - du, um + du, 1)), imp = Math.max(0.2, entre(im - di, im + di, 1));
    const data = addDias(prod === 'milho' ? '2026-02-20' : fid === F1 ? '2026-03-08' : '2026-03-20', Math.floor(i / 8));
    const seca = u <= 14;
    const ent = {bruto: tara + liq, tara, u, up: 14, imp, ip: 1};
    const res = await F('gr-romaneio', undefined, {dono: 'proprio', fieldId: fid, produto: prod, season: '2025/26', date: data, time: `${String(7 + (i % 11)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`, placa: `IV${String.fromCharCode(65 + (placa % 26))}${placa++}`,
      pesoBruto: String(tara + liq), tara: String(tara), umidade: vir(u), impureza: vir(imp), umidadePadrao: '14', impurezaPadrao: '1', metodoDesc: 'balanco', destino: seca ? 'silo|' + (prod === 'milho' ? S3 : S2) : 'secador|' + SEC}, 1);
    if (res.salvo) vol.push({rom: db.romaneios.at(-1), o: oraculoRomaneio(ent)});
  }
  const t1 = performance.now();
  const difs = vol.map(x => Math.abs(x.rom.calc.pesoFinal - x.o.final)), maxDif = Math.max(...difs);
  const totLiq = vol.reduce((s, x) => s + x.o.liq, 0), totFin = vol.reduce((s, x) => s + x.o.final, 0), appFin = vol.reduce((s, x) => s + x.rom.calc.pesoFinal, 0);
  T('VOL-01', 'Volume', `${vol.length} cargas de bitrem (34 a 38,5 t líquidas) lançadas pela moega e conferidas uma a uma com o cálculo independente`, `${vol.length}/140 registradas • diferença máx. 0,01 kg`, `${vol.length}/140 registradas • diferença máx. ${br(maxDif, 4)} kg`, vol.length === 140 && maxDif <= 0.01);
  T('VOL-02', 'Volume', 'Totais da safra simulada (peso líquido e peso final descontado)', `líquido ${br(totLiq / 1000, 1)} t • final ${br(totFin / 1000, 3)} t`, `final ${br(appFin / 1000, 3)} t`, perto(appFin, totFin, 0.5));
  // Secagens diárias das cargas em espera, por produto e dia
  const porDia = {}; cargasEsperando(SEC).forEach(x => { (porDia[`${x.date}|${x.produto}`] ||= []).push(x); });
  let nLotes = 0, okLotes = 0;
  for (const [k, rs] of Object.entries(porDia).sort()) {
    const [data, prod] = k.split('|');
    // inicia só com as cargas desse dia: as outras ficam para os próximos lotes
    const outras = cargasEsperando(SEC).filter(x => !rs.includes(x)); outras.forEach(x => { x._pausa = x.destinoId; x.destinoId = '__fila'; });
    const mi = rs.reduce((s, x) => s + x.calc.liquido * (1 - Number(x.impureza) / 100), 0), ui = rs.reduce((s, x) => s + Number(x.umidade) * x.calc.liquido, 0) / rs.reduce((s, x) => s + x.calc.liquido, 0);
    const rr = await F('gr-secar', SEC, {produto: prod, destino: prod === 'milho' ? 'racao_animal' : 'armazenamento_graos', umidadeMeta: '13', combTipo: 'lenha', combPreco: '95'});
    outras.forEach(x => { x.destinoId = x._pausa; delete x._pausa; });
    if (!rr.salvo) continue;
    const l = db.lotesSecagem.at(-1); l.inicio = `${data}T13:00`;
    const horas = Math.max(2, Math.round(mi / 1000 / (prod === 'milho' ? 32 : 45) * 10) / 10);
    const mfPrev = mi * (100 - ui) / 87, s2sd = saldo(S2), siloV = prod === 'milho' ? S3 : (s2sd.saldo + mfPrev <= s2sd.cap ? S2 : S1);
    const rf = await F('gr-finalizar', l.id, {umidadeSaida: '13', siloId: siloV, combQtd: vir(Math.round(mi / 1000 * (ui - 13) * 0.025 * 100) / 100), combPreco: '95', kwh: String(Math.round(horas * 75)), precoKwh: '0,82'});
    const fim = new Date(new Date(`${data}T13:00`).getTime() + horas * 36e5); l.fim = `${isoDate(fim)}T${String(fim.getHours()).padStart(2, '0')}:${String(fim.getMinutes()).padStart(2, '0')}`; save();
    nLotes++; const c = calcSecagem(l), o = oraculoSecagem(l.massaEntradaKg, Number(l.umidadeEntrada), 13);
    if (rf.salvo && perto(c.mf, o.mf) && perto(l.massaEntradaKg, Math.round(mi / 100) * 100, 60)) okLotes++;
  }
  T('VOL-03', 'Volume', 'Secagens por dia e produto: carga de entrada sugerida e grão seco pelo balanço de água conferidos', `${nLotes}/${nLotes} lotes corretos`, `${okLotes}/${nLotes} lotes corretos`, nLotes > 0 && okLotes === nLotes);
  // Balanço geral dos silos
  // Capacidade dos silos
  const s2c = saldo(S2), s4c = saldo(S4), kgCap = 700000;
  r = await F('gr-saida', S2, {siloId: S2, tipo: 'transferencia', date: '2026-04-20', kg: String(kgCap), dono: 'proprio', destinoSiloId: S4});
  T('CAP-01', 'Silos', `Transferir 700 t para o Silo 04 (capacidade 600 t, já com ${br(s4c.saldo / 1000, 1)} t): avisa antes de passar da capacidade`, 'avisa e não registra', r.salvo ? 'registrou sem avisar' : r.msgs[0], !r.salvo && /capacidade/.test(r.msgs[0]));
  r = await F('gr-saida', S2, {siloId: S2, tipo: 'transferencia', date: '2026-04-20', kg: String(kgCap), dono: 'proprio', destinoSiloId: S4}, 1);
  const alCap = alerts().find(a => /acima da capacidade/.test(a.title));
  T('CAP-02', 'Silos', 'Se o operador confirma mesmo assim, o painel mostra aviso vermelho de silo acima da capacidade', 'aviso vermelho', alCap ? `${alCap.color}: ${alCap.title} — ${alCap.text}` : 'sem aviso', alCap?.color === 'red');
  const mvCap = db.movSilo.at(-1); excluirMovSilo(mvCap.id); await espera(20); document.querySelector('#dialog .danger, #dialog .primary')?.click(); await espera(20);
  T('CAP-03', 'Silos', 'Desfeita a transferência, o aviso some e os saldos voltam', `Silo 02 ${br(s2c.saldo / 1000, 1)} t • Silo 04 ${br(s4c.saldo / 1000, 1)} t • sem aviso`, `Silo 02 ${br(saldo(S2).saldo / 1000, 1)} t • Silo 04 ${br(saldo(S4).saldo / 1000, 1)} t • ${alerts().some(a => /acima da capacidade/.test(a.title)) ? 'aviso ficou' : 'sem aviso'}`, perto(saldo(S2).saldo, s2c.saldo) && perto(saldo(S4).saldo, s4c.saldo) && !alerts().some(a => /acima da capacidade/.test(a.title)));
  r = await F('gr-romaneio', undefined, {dono: 'proprio', fieldId: F2, produto: 'soja', season: '2025/26', date: '2026-04-21', time: '09:10', placa: 'IZZ9A99', pesoBruto: '52600', tara: '16100', umidade: '13,2', impureza: '0,7', umidadePadrao: '14', impurezaPadrao: '1', metodoDesc: 'balanco', destino: 'silo|' + (saldo(S2).ocupacao > saldo(S1).ocupacao ? S2 : S1)});
  T('CAP-04', 'Silos', 'Carga seca direto a silo com espaço: registra sem aviso de capacidade', 'registra', r.salvo ? 'registrou' : r.msgs[0], r.salvo);
  // ================= PAT/AUD: pesagem em duas etapas e histórico =================
  r = await F('gr-chegada', undefined, {dono: 'proprio', fieldId: F2, produto: 'soja', season: '2025/26', date: today(), time: '07:15', placa: 'ixb-4f10', motorista: 'Carlos Menezes', pesoBruto: '51340', umidade: '13,1', impureza: '0,9', destino: 'silo|' + S1});
  const pz = noPatio()[0];
  T('PAT-01', 'Pátio', 'Chegada do caminhão (1ª pesagem, cheio): fica no pátio aguardando a tara', 'IXB-4F10 no pátio com 51.340 kg', pz ? `${pz.placa} no pátio com ${br(pz.pesoBruto, 0)} kg` : (r.msgs[0] || 'não entrou'), pz?.placa === 'IXB-4F10' && pz.pesoBruto === 51340 && /IXB-4F10/.test(VIEWS.graos('moega')));
  r = await F('gr-chegada', undefined, {placa: 'IXB4F10', time: '07:40', pesoBruto: '50000', destino: 'silo|' + S1});
  T('PAT-02', 'Pátio', 'Mesma placa não pode chegar de novo enquanto está no pátio', 'bloqueia e avisa', r.salvo ? 'registrou' : r.msgs[0], !r.salvo && /já está no pátio/.test(r.msgs[0]) && noPatio().length === 1);
  const nRom0 = db.romaneios.length;
  r = await F('gr-tara', pz.id, {tara: '15880'});
  const rp = db.romaneios.at(-1), op = oraculoRomaneio({bruto: 51340, tara: 15880, u: 13.1, up: 14, imp: 0.9, ip: 1, quebra: Number(rp.quebraTecnica) || 0});
  T('PAT-03', 'Pátio', '2ª pesagem (vazio, 15.880 kg) fecha o romaneio com o bruto da chegada; entrada e saída ficam no comprovante', `líquido ${br(op.liq, 0)} kg • final ${br(op.final)} kg • entrada e saída registradas • pátio vazio`, r.salvo ? `líquido ${br(rp.calc.liquido, 0)} kg • final ${br(rp.calc.pesoFinal)} kg • entrada ${rp.entrada ? 'ok' : 'falta'} • saída ${rp.saida ? 'ok' : 'falta'} • pátio ${noPatio().length ? 'com carga' : 'vazio'}` : r.msgs.join(' / '),
    r.salvo && db.romaneios.length === nRom0 + 1 && perto(rp.calc.pesoFinal, op.final) && rp.entrada && rp.saida && !noPatio().length && find('pesagens', pz.id)?.status === 'fechada' && (rp.historico || []).length === 2);
  await F('gr-chegada', undefined, {placa: 'JAA1B22', time: '08:05', pesoBruto: '49700', destino: 'silo|' + S1});
  const pz2 = noPatio()[0];
  r = await F('gr-patio-del', pz2.id, {motivo: ''});
  const r2 = await F('gr-patio-del', pz2.id, {motivo: 'Caminhão voltou sem descarregar (carga recusada)'});
  T('PAT-04', 'Pátio', 'Tirar caminhão do pátio sem descarregar exige motivo e fica registrado', 'sem motivo bloqueia; com motivo fica "cancelada"', `${r.salvo ? 'aceitou sem motivo' : 'pediu motivo'} • ${find('pesagens', pz2.id)?.status}`, !r.salvo && r2.salvo && find('pesagens', pz2.id)?.status === 'cancelada' && find('pesagens', pz2.id)?.motivo);
  r = await F('gr-rom-edit', rp.id, {tara: '15680'});
  T('AUD-01', 'Histórico', 'Alterar a tara de um romaneio sem informar o motivo é bloqueado', 'pede o motivo', r.salvo ? 'salvou sem motivo' : r.msgs[0], !r.salvo && /motivo da alteração/.test(r.msgs[0]) && find('romaneios', rp.id).tara === 15880);
  const finAntes = find('romaneios', rp.id).calc.pesoFinal;
  r = await F('gr-rom-edit', rp.id, {tara: '15680', motivoAlteracao: 'Tara repesada: caminhão estava com lona molhada'});
  const ra = find('romaneios', rp.id), ha = (ra.historico || []).at(-1);
  T('AUD-02', 'Histórico', 'Com motivo: grava quem alterou, quando, o valor antigo e o novo, e o peso final antes e depois', `Tara: 15.880 kg → 15.680 kg • final ${br(finAntes, 0)} → ${br(oraculoRomaneio({bruto: 51340, tara: 15680, u: 13.1, up: 14, imp: 0.9, ip: 1, quebra: Number(rp.quebraTecnica) || 0}).final, 0)} kg`, ha?.mudancas ? `${ha.mudancas.map(m => `${m.campo}: ${m.antes} → ${m.depois}`).join('; ')} • final ${br(ha.finalAntes, 0)} → ${br(ha.finalDepois, 0)} kg • por ${ha.por} • ${ha.motivo}` : 'sem histórico',
    ha?.mudancas?.length === 1 && ha.mudancas[0].campo === 'Tara' && ha.mudancas[0].antes === '15.880 kg' && ha.mudancas[0].depois === '15.680 kg' && ha.por && ha.em && /alterado/.test(VIEWS.graos('moega')));
  const nH = ra.historico.length;
  r = await F('gr-rom-edit', rp.id, {notes: 'Descarga na moega 2'});
  T('AUD-03', 'Histórico', 'Mudar só a observação não pede motivo nem cria registro de alteração', `salva • ${nH} registros`, `${r.salvo ? 'salva' : r.msgs[0]} • ${find('romaneios', rp.id).historico.length} registros`, r.salvo && find('romaneios', rp.id).historico.length === nH);
  const numDel = rp.numero;
  r = await F('gr-rom-del', rp.id, {motivo: ''});
  const r3 = await F('gr-rom-del', rp.id, {motivo: 'Lançado na unidade errada'});
  const exReg = db.checklistsGraos.find(c => c.tipo === 'romaneio_excluido' && c.numero === numDel);
  await F('gr-romaneio', undefined, {dono: 'proprio', fieldId: F2, produto: 'soja', season: '2025/26', date: today(), time: '09:30', placa: 'JBC7H31', pesoBruto: '50120', tara: '15900', umidade: '13', impureza: '0,8', umidadePadrao: '14', impurezaPadrao: '1', metodoDesc: 'balanco', destino: 'silo|' + S1});
  const novoNum = db.romaneios.at(-1).numero;
  T('AUD-04', 'Histórico', 'Excluir romaneio exige motivo, fica no registro de excluídos e o número não é reaproveitado', `nº ${numDel} registrado como excluído • próximo romaneio nº ${numDel + 1}`, `${r.salvo ? 'excluiu sem motivo' : 'pediu motivo'} • nº ${exReg?.numero ?? '—'} ${exReg ? 'registrado' : 'sem registro'} (${exReg?.motivo || ''}) • próximo nº ${novoNum}`, !r.salvo && r3.salvo && !find('romaneios', rp.id) && exReg?.pesoFinal > 0 && novoNum === numDel + 1 && /Romaneios excluídos/.test(VIEWS.graos('moega')));
  // Ticket em PDF
  const _dl = downloadFile; let baixou = ''; downloadFile = (nome) => { baixou = nome; };
  const rt2 = db.romaneios.at(-1); const docT = gerarTicketRomaneio(rt2.id); downloadFile = _dl;
  const txtT = docT ? docT.output() : '';
  T('TKT-01', 'Ticket', 'Ticket do romaneio em PDF para o motorista: número, placa, pesagem, descontos, peso final e assinaturas', `mercaplant-romaneio-${rt2.numero}-jbc7h31.pdf com peso final ${br(rt2.calc.pesoFinal, 0)} kg`, docT ? `${baixou} • ${docT.getNumberOfPages()} página(s)` : 'não gerou',
    !!docT && baixou === `mercaplant-romaneio-${rt2.numero}-jbc7h31.pdf` && txtT.includes(`Romaneio de recebimento n${'º'} ${rt2.numero}`) && txtT.includes('JBC7H31') && txtT.includes(num(rt2.calc.pesoFinal)) && txtT.includes('Motorista'));
  // ================= VAL: erros comuns de preenchimento no secador =================
  r = await F('gr-secar', SEC, {produto: 'trigo', destino: 'racao_animal', umidadeMeta: '', massaT: '21,3', umidadeEntrada: '18'});
  T('VAL-01', 'Validação', 'Umidade final desejada em branco: pede o valor (sem ela a previsão seria "chega a 0,0%")', 'pede a umidade final', r.salvo ? 'iniciou' : r.msgs[0], !r.salvo && /umidade final desejada/.test(r.msgs[0]));
  r = await F('gr-secar', SEC, {produto: 'trigo', destino: 'racao_animal', umidadeMeta: '13', massaT: '21300', umidadeEntrada: '18'});
  T('VAL-02', 'Validação', 'Carga de 21.300 "t" (digitada em kg no campo de toneladas): avisa que 21.300 kg = 21,3 t', 'avisa antes de iniciar', r.salvo ? 'iniciou sem avisar' : r.msgs[0], !r.salvo && /TONELADAS/.test(r.msgs[0]) && /21,3 t/.test(r.msgs[0]));
  r = await F('gr-secar', SEC, {produto: 'trigo', destino: 'racao_animal', umidadeMeta: '13', massaT: '21,3', umidadeEntrada: '7,9'});
  T('VAL-03', 'Validação', 'Umidade de entrada 7,9% (abaixo da final desejada de 13%): pede para conferir a amostra', 'avisa antes de iniciar', r.salvo ? 'iniciou sem avisar' : r.msgs[0], !r.salvo && /abaixo da umidade final/.test(r.msgs[0]));
  r = await F('gr-secar', SEC, {produto: 'trigo', destino: 'racao_animal', umidadeMeta: '13', massaT: '21,3', umidadeEntrada: '17,9'});
  const LV = db.lotesSecagem.at(-1);
  T('VAL-04', 'Validação', 'Rendimento (t/h) só aparece depois de 15 min de secagem (evita "1.278.000 t/h" logo no início)', 'sem rendimento no início', `${calcSecagem(LV).tph == null ? 'sem rendimento' : br(calcSecagem(LV).tph) + ' t/h'}`, r.salvo && calcSecagem(LV).tph == null);
  r = await F('gr-leitura', LV.id, {hora: '00:30', tAr: '116', p_P1: '116', p_P2: '116', p_P3: '116', p_P4: '116'});
  T('VAL-05', 'Validação', 'Leitura com P1…P4 iguais ao ar quente (116 °C copiado do outro visor): explica que os pontos são do alarme', 'pede para conferir', r.salvo ? 'salvou sem avisar' : r.msgs[0], !r.salvo && /mesmo número do ar quente/.test(r.msgs[0]));
  r = await F('gr-lote-editar', LV.id, {massaT: '22,5', umidadeEntrada: '18,4', umidadeMeta: '13'});
  T('VAL-06', 'Validação', 'Corrigir dados de uma secagem em andamento sem excluir', 'carga 22,5 t a 18,4%', `carga ${br(LV.massaEntradaKg / 1000, 1)} t a ${br(LV.umidadeEntrada, 1)}%`, r.salvo && LV.massaEntradaKg === 22500 && LV.umidadeEntrada === 18.4);
  r = await F('gr-sensores', SEC, {temAr: 'sim', arNome: 'Entringer', alarmeNome: 'TSW', tipo_P1: 'ar', tipo_P2: 'ar', tipo_P3: 'ar', tipo_P4: 'ar'});
  T('VAL-07', 'Validação', 'Sensores com todos os pontos marcados como "ar": avisa que sem ponto de massa o sistema não compara o grão com o limite', 'avisa antes de salvar', r.salvo ? 'salvou sem avisar' : r.msgs[0], !r.salvo && /Massa de grãos/.test(r.msgs[0]) && sensoresSecador(SEC).pontos[0].tipo === 'massa');
  remove('lotesSecagem', LV.id);
  const silosChk = [S1, S2, S3, S4].map(id => { const {ent, sai} = movimentosSilo(id); const e = ent.reduce((s, x) => s + x.kg, 0), sa = sai.reduce((s, x) => s + x.kg, 0); return {id, nome: find('machines', id).name, e, sa, saldo: saldo(id).saldo, ok: perto(saldo(id).saldo, Math.max(0, e - sa))}; });
  T('VOL-04', 'Volume', 'Balanço de cada silo: entradas − saídas = saldo', '4/4 silos fechando', `${silosChk.filter(x => x.ok).length}/4 silos fechando • ${silosChk.map(s => `${s.nome.split(' —')[0]}: ${br(s.saldo / 1000, 1)} t`).join(' • ')}`, silosChk.every(x => x.ok));
  const tVol = Math.round(t1 - t0);
  T('VOL-05', 'Volume', 'Desempenho: lançar as 140 cargas pelo formulário no navegador', 'menos de 1 s por carga', `${br(tVol / 140 / 1000, 2)} s por carga (${br(tVol / 1000, 1)} s no total)`, tVol / 140 < 1000);
  // Relatório da safra de grãos e telas
  let telasOk = 0; const telas = ['', 'moega', 'secador', 'silos', 'terceiros', 'relatorio'];
  for (const a of telas) { try { const h = VIEWS.graos(a || undefined); if (h && h.length > 200) telasOk++; } catch { /* conta como falha */ } }
  T('VOL-06', 'Telas', 'Painel, Moega, Secador, Silos, Terceiros e Relatório da safra abrem com o volume da safra', `${telas.length}/${telas.length}`, `${telasOk}/${telas.length}`, telasOk === telas.length);

  showToast = _st;
  const resumoSafra = {cargas: db.romaneios.length, liquidoT: db.romaneios.reduce((s, x) => s + x.calc.liquido, 0) / 1000, finalT: db.romaneios.reduce((s, x) => s + x.calc.pesoFinal, 0) / 1000,
    lotes: db.lotesSecagem.filter(l => l.status === 'Concluída').length, secoT: db.lotesSecagem.filter(l => l.status === 'Concluída').reduce((s, l) => s + (calcSecagem(l).mf || 0), 0) / 1000,
    aguaT: db.lotesSecagem.filter(l => l.status === 'Concluída').reduce((s, l) => s + (calcSecagem(l).agua || 0), 0) / 1000,
    custoSec: db.lotesSecagem.filter(l => l.status === 'Concluída').reduce((s, l) => s + (calcSecagem(l).custo || 0), 0),
    silos: silosChk.map(s => ({nome: s.nome, saldoT: s.saldo / 1000, cap: Number(find('machines', s.id).capacidadeT), ocup: saldo(s.id).ocupacao, u: saldo(s.id).uMedia}))};
  return {casos, resumoSafra, versao: document.querySelector('.brand .versao')?.textContent};
}
