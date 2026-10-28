'use strict';
/* MercaPlant — Revisar o cadastro das máquinas (tipo e medidor).
   Máquinas cadastradas antes dos tipos novos ficaram como “Outro”, e veículos que já tinham leitura ficaram no horímetro.
   Esta tela (ADM / supervisor) lista o que precisa conferir, sugere o tipo e o medidor pelo nome e pelo modelo,
   e aplica com a leitura atual (ao passar para km, pede o odômetro de agora). Nada muda sem o toque em Aplicar. */

// Sugestão pelo nome e pelo modelo: [expressão, tipo] — “Implemento:<tipo>” vira implemento.
// Vale a palavra que aparece primeiro no texto (“Plataforma da colheitadeira” é plataforma; “Colheitadeira com plataforma”, colheitadeira);
// no empate, a primeira da lista (as mais específicas vêm antes).
const RMQ_SUGESTOES = [
  [/preparador de calda|speed ?mix|misturador de calda|central de calda|pr[eé].?mistur|indutor de calda/i, 'Preparador de calda'],
  // Pulverização, distribuição e trato: o que é implemento e o que é autopropelido
  [/pulverizador.*(arrasto|reboc)|\barrasto\b/i, 'Implemento:Pulverizador de arrasto'],
  [/pulverizador.*(montado|3 pontos|tr[eê]s pontos)/i, 'Implemento:Pulverizador montado (3 pontos)'],
  [/atomizador|\bturbo ?pulverizador|\barbus\b/i, 'Implemento:Atomizador / turbo (pomar e café)'],
  [/pulverizador|autopropelido|\bmontana (parruda|ma ?\d)|\bparruda\b|\bpatriot\b|\bimperador\b/i, 'Pulverizador'],
  [/distribuidor.*(esterco|chorume|dejeto)|chorumeira|esterqueira/i, 'Implemento:Distribuidor de esterco / chorume'],
  [/distribuidor.*autopropel/i, 'Distribuidor autopropelido'],
  [/distribuidor de ra[cç][aã]o|tratador(?! de semente)/i, 'Implemento:Distribuidor de ração / trato'],
  [/vag[aã]o.*autopropel/i, 'Vagão misturador autopropelido'],
  [/vag[aã]o|misturador de ra[cç][aã]o|\bunimix\b/i, 'Implemento:Vagão forrageiro / misturador'],
  [/distribuidor|calc[aá]rea|adubadeira|\bh[eé]rcules\b|\baccura\b|\blan[cç]o\b/i, 'Implemento:Distribuidor de adubo/calcário'],
  // Plantio
  [/(plantadora|plantadeira) de cana/i, 'Implemento:Plantadora de cana'], [/(plantadora|plantadeira) de (batata|mandioca)/i, 'Implemento:Plantadora de batata / mandioca'],
  [/transplantador/i, 'Implemento:Transplantadora de mudas'], [/semeadeira|semeadora|air ?flow/i, 'Implemento:Semeadora'], [/plantadeira|plantadora|\bplanter\b/i, 'Implemento:Plantadeira'],
  // Colheita
  [/plataforma.*milho|\bmilheira\b|espigadeira/i, 'Implemento:Plataforma de milho'], [/plataforma|\bdraper\b/i, 'Implemento:Plataforma de colheita'],
  [/colhe(dora|deira) de forragem|forrageira autopropel/i, 'Colhedora de forragem'], [/colhe(dora|deira) de cana/i, 'Colhedora de cana'],
  [/colhe(dora|deira) de caf[eé]/i, 'Colhedora de café'], [/colhe(dora|deira) de algod[aã]o|algodoeira/i, 'Colhedora de algodão'],
  [/colheitadeira|colhedora|colhedeira|axial.?flow/i, 'Colheitadeira'],
  [/recolhedora/i, 'Implemento:Recolhedora (café, amendoim, feijão)'], [/arrancador|arrancadeira/i, 'Implemento:Arrancador (amendoim, batata, mandioca)'],
  [/ensiladeira|forrageira/i, 'Implemento:Ensiladeira'], [/segadeira|segadora|gadanha/i, 'Implemento:Segadeira'], [/ancinho|enleirador/i, 'Implemento:Ancinho enleirador'],
  [/enfardadeira|enfardadora|enroladora/i, 'Implemento:Enfardadeira'], [/embutidora|ensacadora/i, 'Implemento:Embutidora de silo bolsa'], [/extratora/i, 'Implemento:Extratora de silo bolsa'],
  // Unidade de grãos e beneficiamento
  [/pr[eé].?limpeza|m[aá]quina de limpeza/i, 'Pré-limpeza'], [/elevador|transportador|redler|esteira transportadora|rosca transportadora/i, 'Elevador / transportador'],
  [/tombador|tombadeira/i, 'Tombador'], [/balan[cç]a/i, 'Balança'], [/termometria|aera[cç][aã]o|aerador|termoflex/i, 'Termometria / aeração'],
  [/benefici|classificador|mesa (densim|gravit)|tratador de semente/i, 'Beneficiamento'], [/secador|secadora/i, 'Secador'], [/moega/i, 'Moega'],
  [/\bsilo\b|armaz[eé]m/i, 'Silo/Armazém'],
  // Pecuária e leite
  [/ordenha/i, 'Ordenhadeira'], [/resfriador|tanque de (leite|resfriamento)/i, 'Resfriador de leite'], [/f[aá]brica de ra[cç][aã]o|moinho|desintegrador/i, 'Fábrica de ração'],
  // Irrigação, energia, ferramentas
  [/carretel|hidro ?roll|irrigador de carretel/i, 'Carretel de irrigação'], [/motobomba|moto ?bomba|\bbomba\b|irriga/i, 'Motobomba / irrigação'], [/piv[oô]/i, 'Pivô central'],
  [/gerador/i, 'Gerador'], [/compressor/i, 'Compressor'], [/lavadora|lava.?jato|k[aä]rcher|\bwap\b/i, 'Lavadora de alta pressão'], [/\bsolda|inversora/i, 'Máquina de solda'],
  [/ro[cç]adeira costal|ro[cç]adeira lateral|\bfs ?\d{2,3}\b/i, 'Roçadeira costal'], [/motosserra|moto.?serra/i, 'Motosserra'],
  [/cortador(a)? de grama|aparador de grama|tratorito/i, 'Cortador de grama'],
  [/picador (de )?(madeira|florestal|galho)|\bchipper\b/i, 'Picador de madeira'], [/harvester/i, 'Harvester'], [/forwarder/i, 'Forwarder'], [/skidder/i, 'Skidder'], [/feller/i, 'Feller buncher'],
  // Veículos (van antes de caminhão: “Sprinter Mercedes”)
  [/caminhonete|pick.?up|hilux|\bs-?10\b|ranger|amarok|\bf-?(250|350|1000|4000)\b|l200|frontier|strada|saveiro|\btoro\b|montana|oroch|maverick|\bram\b/i, 'Caminhonete'],
  [/\bmoto\b|motocicleta|\bcg\b|\bbiz\b|\bbros\b|\bxre\b|titan|\bfan\b|\bpop\b|yamaha|honda (start|cg)/i, 'Moto'],
  [/\bcarro\b|\bgol\b|\buno\b|onix|palio|corolla|hb20|\bkwid\b|sandero|argo/i, 'Carro'],
  [/\bvan\b|[oô]nibus|sprinter|\bmaster\b|ducato|kombi/i, 'Van/Ônibus'],
  [/caminh[aã]o|truck|scania|volvo|atego|axor|accelo|constellation|\bcargo\b|mercedes|mercedez|iveco|daf\b/i, 'Caminhão'],
  [/quadriciclo|\butv\b|\bgator\b|\bmule\b|\brzr\b/i, 'Quadriciclo/UTV'],
  // Construção e movimentação
  [/empilhadeira|\bheli\b|hyster|\byale\b/i, 'Empilhadeira'],
  [/p[aá] carregadeira|carregadeira de rodas/i, 'Pá carregadeira'], [/retroescavadeira|\bretro\b/i, 'Retroescavadeira'], [/escavadeira/i, 'Escavadeira'],
  [/patrola|motoniveladora/i, 'Motoniveladora'], [/trator de esteira/i, 'Trator de esteira'], [/bobcat|minicarregadeira/i, 'Minicarregadeira'],
  [/rolo.?faca/i, 'Implemento:Rolo-faca'], [/rolo compactador|compactador/i, 'Rolo compactador'],
  [/telesc[oó]pic/i, 'Manipulador telescópico'], [/drone/i, 'Drone de pulverização'], [/avi[aã]o/i, 'Avião agrícola'],
  [/microtrator|micro.?trator|tobat|motocultivador/i, 'Microtrator / tobata'],
  // Implementos de solo, roçada, transporte e acessórios
  [/encanteirador|canteirador/i, 'Implemento:Encanteirador'], [/enxada rotativa|\brotativa\b/i, 'Implemento:Enxada rotativa'], [/\bgrade\b|grad[aã]o/i, 'Implemento:Grade'],
  [/subsolador/i, 'Implemento:Subsolador'], [/escarificador/i, 'Implemento:Escarificador'], [/\barado\b/i, 'Implemento:Arado'], [/cultivador/i, 'Implemento:Cultivador'],
  [/sulcador/i, 'Implemento:Sulcador'], [/terraceador|terra[cç]eador/i, 'Implemento:Terraceador'], [/valetadeira|valetador/i, 'Implemento:Valetadeira'], [/\bplaina\b|l[aâ]mina/i, 'Implemento:Lâmina / plaina'],
  [/ro[cç]adeira/i, 'Implemento:Roçadeira'], [/triturador|mulcher|trincha/i, 'Implemento:Triturador / mulcher'], [/destocador/i, 'Implemento:Destocador'],
  [/comboio|carreta de abastecimento/i, 'Implemento:Carreta de abastecimento (comboio)'], [/carreta.*(pipa|tanque)|\bpipa\b/i, 'Implemento:Carreta pipa / tanque'],
  [/(carreta )?graneleira/i, 'Implemento:Carreta graneleira'], [/transbordo/i, 'Implemento:Transbordo'], [/carreta|reboque|julieta/i, 'Implemento:Carreta / reboque'],
  [/carregador frontal|concha/i, 'Implemento:Carregador frontal / concha'], [/garfo|pin[cç]a de fardo/i, 'Implemento:Garfo / pinça de fardos'], [/guincho|\bgrua\b/i, 'Implemento:Guincho / grua'],
  [/\btrator\b|tractor/i, 'Trator']
];
// Palavra que serve para máquina e para implemento: num implemento cadastrado, fica o implemento
const RMQ_PAR_IMPL = {'Pulverizador': 'Pulverizador de arrasto', 'Plantadeira': 'Plantadeira', 'Distribuidor autopropelido': 'Distribuidor de adubo/calcário', 'Colhedora de forragem': 'Ensiladeira', 'Vagão misturador autopropelido': 'Vagão forrageiro / misturador'};
function rmqAchar(txt) {
  let melhor = null;
  for (const [re, tipo] of RMQ_SUGESTOES) { const r = re.exec(txt); if (r && (!melhor || r.index < melhor.i)) melhor = {i: r.index, tipo}; }
  return melhor?.tipo || '';
}
function rmqSugestao(m) {
  const achou = rmqAchar(`${m.name || ''} ${m.model || ''}`);
  let tipo = achou || (m.type === 'Implemento' ? `Implemento:${m.tipoImpl || 'Outro'}` : m.type === 'Outro' ? 'Outro' : m.type);
  if (m.type === 'Implemento' && RMQ_PAR_IMPL[tipo]) tipo = `Implemento:${RMQ_PAR_IMPL[tipo]}`;
  if (tipo.startsWith('Implemento:')) return {tipo: 'Implemento', tipoImpl: tipo.slice(11), medidor: 'nenhum'};
  return {tipo, medidor: tipo === 'Outro' ? (Number(m.hours) > 1 ? 'horas' : 'nenhum') : medidorPadrao(tipo)};
}
const rmqCasou = m => !!rmqAchar(`${m.name || ''} ${m.model || ''}`);
// Por que precisa conferir (vazio = está certo): sem categoria, tipo diferente do nome, implemento sem tipo
// ou veículo de estrada no horímetro. “Está certo assim” tira da lista.
function rmqMotivo(m) {
  if (!m || isInactive(m) || m.revisadoTipo) return '';
  const s = rmqSugestao(m);
  if (m.type === 'Implemento') {
    if (!m.tipoImpl || m.tipoImpl === 'Outro' || (typeof TIPOS_IMPL !== 'undefined' && !TIPOS_IMPL.includes(m.tipoImpl))) return 'Implemento sem tipo';
    return rmqCasou(m) && s.tipo !== 'Implemento' ? 'Parece máquina, não implemento' : '';
  }
  if (m.type === 'Outro') return 'Sem categoria';
  if (rmqCasou(m) && s.tipo !== 'Outro' && s.tipo !== m.type) return 'Tipo diferente do nome';
  if (TIPOS_KM.includes(m.type) && medidorDe(m) !== 'km') return 'Veículo de estrada no horímetro';
  return '';
}
const rmqPendentes = () => db.machines.filter(m => rmqMotivo(m));
const rmqGestor = () => typeof mcpGestor !== 'function' || mcpGestor();

VIEWS.revisarmaq = () => {
  if (!rmqGestor()) return head('Revisar cadastro', 'Só para o ADM e o supervisor.', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.', {act: 'nav', id: 'maquinas', label: '← Máquinas'})}</section>`;
  const lista = rmqPendentes();
  const opTipos = (sel, impl) => GRUPOS_TIPO_MAQ.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(t => `<option value="${esc(t)}" ${!impl && t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')
    + (typeof GRUPOS_TIPO_IMPL !== 'undefined' ? GRUPOS_TIPO_IMPL : [['Outros', ['Outro']]]).map(([g, l]) => `<optgroup label="Implemento — ${esc(g)}">${l.map(t => `<option value="Implemento:${esc(t)}" ${impl === t ? 'selected' : ''}>${esc(t === 'Outro' ? 'Outro implemento' : t)}</option>`).join('')}</optgroup>`).join('');
  const linha = m => {
    const s = rmqSugestao(m), uAtual = unidMed(m);
    return `<div class="rmq-it" data-rmq="${esc(m.id)}">
      <div class="rmq-cab"><div><strong>${esc(m.name)}</strong><small>${esc([m.model, `hoje: ${m.type === 'Implemento' ? `implemento (${m.tipoImpl || 'sem tipo'})` : m.type}`, temMedidor(m) ? `${num(m.hours)} ${uAtual} (${nomeMed(m)})` : 'sem medidor'].filter(Boolean).join(' • '))}</small></div>${chip(rmqMotivo(m) || 'conferir', rmqMotivo(m) === 'Tipo diferente do nome' || rmqMotivo(m) === 'Parece máquina, não implemento' ? 'orange' : 'blue')}</div>
      <div class="rmq-campos">
        <label>Tipo<select data-rmq-tipo>${opTipos(s.tipo, s.tipoImpl)}</select></label>
        <label>Medidor<select data-rmq-med><option value="km" ${s.medidor === 'km' ? 'selected' : ''}>Odômetro (km)</option><option value="horas" ${s.medidor === 'horas' ? 'selected' : ''}>Horímetro (horas)</option><option value="nenhum" ${s.medidor === 'nenhum' ? 'selected' : ''}>Sem medidor</option></select></label>
        <label data-rmq-leit-campo>Leitura atual<input data-rmq-leit inputmode="decimal" value="${s.medidor === medidorDe(m) && Number(m.hours) > 1 ? esc(String(m.hours).replace('.', ',')) : ''}" placeholder="${s.medidor === 'km' ? 'odômetro de agora (km)' : 'horímetro de agora (h)'}"></label>
      </div>
      <div class="btn-row">${btn('Aplicar', 'rmq-aplicar', m.id)}${btn('Está certo assim', 'rmq-ok', m.id, 'secondary')}</div></div>`;
  };
  return head('Revisar cadastro das máquinas', 'Categoria, tipo e medidor (km ou horas) de máquinas e implementos.', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) +
    (lista.length ? `<section class="card panel"><p class="nota" style="margin:0 0 6px">O app sugere pelo nome e pelo modelo. Confira, informe a leitura de agora e toque em <b>Aplicar</b>. Veículo que passa para km precisa do <b>odômetro atual</b> — a leitura antiga era em horas.</p>${lista.map(linha).join('')}</section>`
      : `<section class="card">${empty('Tudo revisado', 'Todas as máquinas estão com o tipo e o medidor conferidos.', {act: 'nav', id: 'maquinas', label: '← Máquinas'})}</section>`);
};
VIEWS.revisarmaq.after = () => {
  $$('[data-rmq]').forEach(box => {
    const med = $('[data-rmq-med]', box), tipo = $('[data-rmq-tipo]', box), leit = $('[data-rmq-leit]', box), campo = $('[data-rmq-leit-campo]', box);
    const ajustar = () => { campo.hidden = med.value === 'nenhum'; leit.placeholder = med.value === 'km' ? 'odômetro de agora (km)' : 'horímetro de agora (h)'; };
    tipo.addEventListener('change', () => { med.value = tipo.value.startsWith('Implemento:') ? 'nenhum' : tipo.value === 'Outro' ? med.value : medidorPadrao(tipo.value); ajustar(); });
    med.addEventListener('change', ajustar); ajustar();
  });
};
TITLES.revisarmaq = 'Revisar cadastro';
if (typeof GRUPO_DA_ROTA === 'object') GRUPO_DA_ROTA.revisarmaq = 'maquinas';

Object.assign(ACTIONS, {
  'rmq-aplicar': id => {
    if (!rmqGestor()) return;
    const m = find('machines', id), box = $(`[data-rmq="${id}"]`); if (!m || !box) return;
    const tipo = $('[data-rmq-tipo]', box).value, med = tipo.startsWith('Implemento:') ? 'nenhum' : $('[data-rmq-med]', box).value, txt = $('[data-rmq-leit]', box).value.trim();
    const leit = txt === '' ? null : numeroBR(txt);
    if (med !== 'nenhum' && (leit == null || !(leit >= 0))) { showToast(`Informe ${med === 'km' ? 'o odômetro' : 'o horímetro'} atual de ${m.name}`, true); $('[data-rmq-leit]', box).focus(); return; }
    const antes = {type: m.type, medidor: medidorDe(m), hours: m.hours};
    if (tipo.startsWith('Implemento:')) Object.assign(m, {type: 'Implemento', tipoImpl: tipo.slice(11), medidor: 'nenhum', interval: '', nextService: ''});
    else {
      if (m.type === 'Implemento') { delete m.tipoImpl; delete m.revisaoHa; delete m.revisaoDias; } // deixa de ser implemento
      m.type = tipo; m.medidor = med;
      if (med === 'nenhum') { m.interval = ''; m.nextService = ''; }
      else {
        const trocou = antes.medidor !== med;
        // Leitura de agora vira o ponto de partida (sem contar como horas ou km trabalhados)
        m.hours = leit; db.hourLogs.push({id: uid(), machineId: m.id, date: today(), hours: leit, previous: leit, notes: trocou ? `Medidor passou para ${med === 'km' ? 'odômetro (km)' : 'horímetro (h)'}` : 'Revisão do cadastro'});
        if (trocou || !(Number(m.interval) > 0)) m.interval = med === 'km' ? 10000 : 250;
        if (trocou || !(Number(m.nextService) > 0)) m.nextService = leit + Number(m.interval);
      }
    }
    m.revisadoTipo = true; m.revisadoAntes = antes; upsert('machines', m);
    showToast(`${m.name}: ${m.type === 'Implemento' ? `implemento (${m.tipoImpl})` : `${m.type}, ${m.medidor === 'km' ? 'km' : m.medidor === 'horas' ? 'horas' : 'sem medidor'}`}`); render();
  },
  'rmq-ok': id => { if (!rmqGestor()) return; const m = find('machines', id); if (!m) return; m.revisadoTipo = true; m.medidor = medidorDe(m); upsert('machines', m); showToast(`${m.name}: mantido como está`); render(); }
});

// Aviso para quem gerencia enquanto houver cadastro a conferir
const alertasSemRevisar = alerts;
alerts = function () {
  const l = alertasSemRevisar(), n = rmqGestor() ? rmqPendentes().length : 0;
  if (n) l.push({color: 'orange', icon: '⚙', title: `Revisar cadastro: ${n} ${n === 1 ? 'item' : 'itens'}`, text: 'Sem categoria, tipo diferente do nome, implemento sem tipo ou veículo no horímetro — o app sugere, você confere.', route: 'revisarmaq', acao: {act: 'nav', id: 'revisarmaq', label: 'Revisar'}});
  return l;
};
