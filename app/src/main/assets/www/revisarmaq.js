'use strict';
/* MercaPlant — Revisar o cadastro das máquinas (tipo e medidor).
   Máquinas cadastradas antes dos tipos novos ficaram como “Outro”, e veículos que já tinham leitura ficaram no horímetro.
   Esta tela (ADM / supervisor) lista o que precisa conferir, sugere o tipo e o medidor pelo nome e pelo modelo,
   e aplica com a leitura atual (ao passar para km, pede o odômetro de agora). Nada muda sem o toque em Aplicar. */

// Sugestão pelo nome e modelo: [expressão, tipo] — “Implemento:<tipo>” vira implemento; “Outro:nenhum” fica sem medidor
const RMQ_SUGESTOES = [
  [/preparador de calda|speed ?mix|misturador de calda|central de calda|pr[eé].?mistur|indutor de calda/i, 'Preparador de calda'],
  [/caminhonete|pick.?up|hilux|\bs-?10\b|ranger|amarok|\bf-?(250|350|1000|4000)\b|l200|frontier|strada|saveiro|\btoro\b|montana|oroch|maverick|ram\b/i, 'Caminhonete'],
  [/\bmoto\b|motocicleta|\bcg\b|\bbiz\b|\bbros\b|\bxre\b|titan|\bfan\b|\bpop\b|yamaha|honda (start|cg)/i, 'Moto'],
  [/\bcarro\b|\bgol\b|\buno\b|onix|palio|corolla|hb20|\bkwid\b|sandero|argo/i, 'Carro'],
  [/caminh[aã]o|truck|scania|volvo|atego|axor|accelo|constellation|\bcargo\b|mercedes|mercedez|iveco|daf\b/i, 'Caminhão'],
  [/\bvan\b|[oô]nibus|sprinter|\bmaster\b|ducato|kombi/i, 'Van/Ônibus'],
  [/quadriciclo|\butv\b|\bgator\b|\bmule\b|\brzr\b/i, 'Quadriciclo/UTV'],
  [/empilhadeira|\bheli\b|hyster|\byale\b/i, 'Empilhadeira'],
  [/gerador/i, 'Gerador'], [/motobomba|\bbomba\b|irriga/i, 'Motobomba / irrigação'], [/piv[oô]/i, 'Pivô central'],
  [/p[aá] carregadeira|carregadeira de rodas/i, 'Pá carregadeira'], [/retroescavadeira|\bretro\b/i, 'Retroescavadeira'], [/escavadeira/i, 'Escavadeira'],
  [/patrola|motoniveladora/i, 'Motoniveladora'], [/trator de esteira|\bd[46]\b/i, 'Trator de esteira'], [/bobcat|minicarregadeira/i, 'Minicarregadeira'],
  [/telesc[oó]pic/i, 'Manipulador telescópico'], [/drone/i, 'Drone de pulverização'], [/avi[aã]o/i, 'Avião agrícola'],
  [/balan[cç]a/i, 'Outro:nenhum'],
  [/semeadeira|semeadora/i, 'Implemento:Semeadora'], [/plantadeira/i, 'Implemento:Plantadeira'], [/\bgrade\b/i, 'Implemento:Grade'], [/subsolador/i, 'Implemento:Subsolador'],
  [/escarificador/i, 'Implemento:Escarificador'], [/ro[cç]adeira/i, 'Implemento:Roçadeira'], [/transbordo/i, 'Implemento:Transbordo'], [/carreta|reboque/i, 'Implemento:Carreta / reboque'], [/arado/i, 'Implemento:Arado']
];
function rmqSugestao(m) {
  const txt = `${m.name || ''} ${m.model || ''}`, achou = RMQ_SUGESTOES.find(([re]) => re.test(txt))?.[1];
  const tipo = achou || (m.type === 'Outro' ? 'Outro' : m.type);
  if (tipo.startsWith('Implemento:')) return {tipo: 'Implemento', tipoImpl: tipo.slice(11), medidor: 'nenhum'};
  if (tipo === 'Outro:nenhum') return {tipo: 'Outro', medidor: 'nenhum'};
  return {tipo, medidor: tipo === 'Outro' ? (Number(m.hours) > 1 ? 'horas' : 'nenhum') : medidorPadrao(tipo)};
}
// O que precisa conferir: tipo “Outro” ainda não revisado, ou veículo de estrada que ficou no horímetro sem escolha
// ou implemento que, pelo nome, é máquina ou equipamento (ex.: preparador de calda cadastrado como implemento)
const rmqCasou = m => RMQ_SUGESTOES.some(([re]) => re.test(`${m.name || ''} ${m.model || ''}`));
const rmqPendentes = () => db.machines.filter(m => !isInactive(m) && !m.revisadoTipo && (m.type === 'Implemento'
  ? rmqCasou(m) && rmqSugestao(m).tipo !== 'Implemento'
  : m.type === 'Outro' || (!m.medidor && TIPOS_KM.includes(m.type) && medidorDe(m) !== 'km')));
const rmqGestor = () => typeof mcpGestor !== 'function' || mcpGestor();

VIEWS.revisarmaq = () => {
  if (!rmqGestor()) return head('Revisar cadastro', 'Só para o ADM e o supervisor.', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.', {act: 'nav', id: 'maquinas', label: '← Máquinas'})}</section>`;
  const lista = rmqPendentes();
  const opTipos = (sel, impl) => GRUPOS_TIPO_MAQ.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(t => `<option value="${esc(t)}" ${!impl && t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')
    + `<optgroup label="Implementos (sem motor)">${(typeof TIPOS_IMPL !== 'undefined' ? TIPOS_IMPL : ['Outro']).map(t => `<option value="Implemento:${esc(t)}" ${impl === t ? 'selected' : ''}>Implemento — ${esc(t)}</option>`).join('')}</optgroup>`;
  const linha = m => {
    const s = rmqSugestao(m), uAtual = unidMed(m);
    return `<div class="rmq-it" data-rmq="${esc(m.id)}">
      <div class="rmq-cab"><div><strong>${esc(m.name)}</strong><small>${esc([m.model, `hoje: ${m.type}`, temMedidor(m) ? `${num(m.hours)} ${uAtual} (${nomeMed(m)})` : 'sem medidor'].filter(Boolean).join(' • '))}</small></div>${s.tipo !== m.type || s.medidor !== medidorDe(m) ? chip('sugestão', 'blue') : ''}</div>
      <div class="rmq-campos">
        <label>Tipo<select data-rmq-tipo>${opTipos(s.tipo, s.tipoImpl)}</select></label>
        <label>Medidor<select data-rmq-med><option value="km" ${s.medidor === 'km' ? 'selected' : ''}>Odômetro (km)</option><option value="horas" ${s.medidor === 'horas' ? 'selected' : ''}>Horímetro (horas)</option><option value="nenhum" ${s.medidor === 'nenhum' ? 'selected' : ''}>Sem medidor</option></select></label>
        <label data-rmq-leit-campo>Leitura atual<input data-rmq-leit inputmode="decimal" value="${s.medidor === medidorDe(m) && Number(m.hours) > 1 ? esc(String(m.hours).replace('.', ',')) : ''}" placeholder="${s.medidor === 'km' ? 'odômetro de agora (km)' : 'horímetro de agora (h)'}"></label>
      </div>
      <div class="btn-row">${btn('Aplicar', 'rmq-aplicar', m.id)}${btn('Está certo assim', 'rmq-ok', m.id, 'secondary')}</div></div>`;
  };
  return head('Revisar cadastro das máquinas', 'Tipo e medidor (km ou horas) das máquinas cadastradas antes dos tipos novos.', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) +
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
  if (n) l.push({color: 'orange', icon: '⚙', title: `Revisar cadastro: ${n} ${n === 1 ? 'máquina' : 'máquinas'}`, text: 'Tipo ou medidor (km ou horas) a conferir — ex.: caminhonete, moto ou caminhão que ficou no horímetro.', route: 'revisarmaq', acao: {act: 'nav', id: 'revisarmaq', label: 'Revisar'}});
  return l;
};
