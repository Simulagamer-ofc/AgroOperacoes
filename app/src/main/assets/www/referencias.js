'use strict';
/* Nexus Agro — Referências técnicas da fazenda.
   Onde não existe norma oficial conferida no banco (MAPA, Embrapa, ISO…), o agrônomo, o supervisor ou o ADM cadastram a
   referência que a fazenda usa (recomendação técnica, contrato da cooperativa, manual do fabricante). O app passa a avaliar
   com ela, sempre identificada como “referência da fazenda, por <nome>, em <data>” e nunca no lugar de uma norma oficial:
   se houver regra oficial validada para a mesma condição, a oficial prevalece (avaliador). Operador usa, não edita. */

const ORIGEM_FAZENDA = 'Referência da fazenda';
const nomeUsuarioRef = () => (typeof nv !== 'undefined' && (nv.nomes?.[nv.sessao?.usuario] || nv.sessao?.email)) || db.settings.owner || 'usuário deste aparelho';
// Quem pode cadastrar: ADM, supervisor, função agrônomo (ou o aparelho sem nuvem, usado por uma pessoa só)
function podeEditarReferencias() {
  if (typeof nvVinculado !== 'function' || !nvVinculado() || nv.sysadm) return true;
  const papel = typeof nvPapel === 'function' ? nvPapel() : nv.papel;
  return papel === 'admin' || papel === 'supervisor' || nv.funcao === 'agronomo';
}

// ---------- Banco oficial + referências da fazenda ----------
function regraDaFazenda(ref) {
  return {...ref.regra, id: 'FAZ-' + ref.id, versao: String(ref.versao || 1), origem: 'fazenda', statusValidacao: 'validada', confianca: 'fazenda',
    titulo: `${ORIGEM_FAZENDA} — ${ref.titulo}`, acaoForaDoPadrao: ref.acao || 'Corrigir conforme a referência técnica da fazenda e medir de novo.',
    validadoPor: ref.por, dataValidacao: (ref.em || '').slice(0, 10),
    fontes: [{organizacao: `${ORIGEM_FAZENDA} — cadastrada por ${ref.por} em ${fmtDate((ref.em || '').slice(0, 10))}`, titulo: ref.fonte, tipo: 'referencia_fazenda', conferido: true, trechoLiteral: ref.obs || ref.fonte}]};
}
function tabelaDaFazenda(ref) {
  return {...ref.tabela, id: 'FAZ-' + ref.id, versao: String(ref.versao || 1), origem: 'fazenda', statusValidacao: 'validada', equipamentoFamilia: '*', etapa: ['recebimento'],
    destino: ['comercializacao', 'armazenamento_graos', 'agroindustria', 'moagem_alimentacao_humana', 'racao_animal'], titulo: `${ORIGEM_FAZENDA} — ${ref.titulo}`,
    consequencias: {}, desclassificacao: [], casasDecimais: 2,
    fontes: [{organizacao: `${ORIGEM_FAZENDA} — cadastrada por ${ref.por} em ${fmtDate((ref.em || '').slice(0, 10))}`, titulo: ref.fonte, conferido: true, trechoLiteral: ref.obs || ref.fonte}]};
}
function mesclarReferencias(b) {
  const refs = (db.referenciasFazenda || []).filter(r => r.ativa !== false);
  return {...b, regras: [...(b.regras || []), ...refs.filter(r => r.tipo === 'regra').map(regraDaFazenda)],
    tabelasClassificacao: [...(b.tabelasClassificacao || []), ...refs.filter(r => r.tipo === 'tabela').map(tabelaDaFazenda)]};
}
// Todo uso do banco de regras (aferição, secagem, grãos) passa a enxergar as referências da fazenda
if (typeof dados === 'function') {
  const dadosOficiais = dados;
  dados = async nome => { const b = await dadosOficiais(nome); return nome === 'regras' ? mesclarReferencias(b) : b; };
  dados.oficiais = dadosOficiais;
}
// Depois de cadastrar/alterar: telas que guardam o banco em memória recarregam
function recarregarReferencias() {
  if (typeof regrasGraos !== 'undefined') { regrasGraos = null; if (typeof carregarRegrasGraos === 'function') carregarRegrasGraos(); }
  if (typeof TABS_CLASS !== 'undefined') { TABS_CLASS = null; REGRAS_SEC = []; }
  if (typeof limitesBico !== 'undefined') limitesBico = null;
}

// ---------- Modelos: o que pode ser cadastrado ----------
const PONTOS_GRAO = [['massa_graos', 'Massa de grãos — temperatura (°C)', 'temperatura', '°C'], ['ar_entrada', 'Ar de entrada do secador — temperatura (°C)', 'temperatura', '°C'],
  ['grao_descarga', 'Grão na descarga — temperatura (°C)', 'temperatura', '°C'], ['ambiente_armazem', 'Ambiente do armazém — temperatura (°C)', 'temperatura', '°C'],
  ['amostra', 'Umidade do grão (%)', 'umidade_graos', '%']];
const ETAPAS_REF = [['recebimento', 'Recebimento (moega)'], ['secagem', 'Secagem'], ['pos_secagem', 'Saída do secador'], ['armazenamento', 'Armazenamento']];
const DESTINOS_REF = [['grao', 'Grão (todos os usos)'], ['semente', 'Semente para plantio'], ['comercializacao', 'Grão — venda'], ['armazenamento_graos', 'Grão — armazenagem'],
  ['racao_animal', 'Grão — ração animal'], ['moagem_alimentacao_humana', 'Grão — moagem / alimentação humana'], ['agroindustria', 'Grão — agroindústria']];
const DESTINOS_GRAO_TODOS = ['comercializacao', 'armazenamento_graos', 'agroindustria', 'moagem_alimentacao_humana', 'racao_animal'];
// Máquinas: as avaliações que o app já faz, tiradas do próprio banco (uma por avaliação + variável + equipamento)
const NOMES_EQUIP = {pulverizador_barra: 'Pulverizador de barra', semeadora_precisao: 'Plantadeira / semeadora de precisão', semeadora_fluxo_continuo: 'Semeadora de fluxo contínuo',
  adubadora_linha: 'Adubadora de linha', distribuidor_lanco: 'Distribuidor a lanço (calcário / adubo)', colhedora: 'Colhedora'};
const NOMES_AVAL = {vazao_bicos: 'Vazão dos bicos', taxa_aplicacao: 'Taxa de aplicação (L/ha)', sensor_controlador: 'Sensor / controlador', distribuicao_longitudinal: 'Distribuição de sementes na linha',
  distribuicao_transversal: 'Distribuição transversal (faixa)', dose_aplicada: 'Dose aplicada (sementes / adubo / calcário)', perdas_colheita: 'Perdas na colheita'};
async function modelosMaquinas() {
  const b = await (dados.oficiais || dados)('regras'), vistos = new Map();
  for (const r of b.regras || []) {
    if (['secagem_armazenagem', 'classificacao_recebimento'].includes(r.avaliacao) || r.statusValidacao === 'suspensa') continue;
    for (const eq of [].concat(r.equipamentoFamilia)) {
      const k = `${r.avaliacao}|${r.variavel}|${eq}`;
      const ofi = (b.regras || []).some(x => x.avaliacao === r.avaliacao && x.variavel === r.variavel && [].concat(x.equipamentoFamilia).includes(eq) && x.statusValidacao === 'validada' && (x.limiteMin != null || x.limiteMax != null));
      if (!vistos.has(k)) vistos.set(k, {k, avaliacao: r.avaliacao, variavel: r.variavel, eq, unidade: r.unidade, base: r, oficial: ofi,
        rotulo: `${NOMES_EQUIP[eq] || eq} — ${NOMES_AVAL[r.avaliacao] || r.avaliacao}: ${r.titulo.replace(/^.*?—\s*/, '')}`});
    }
  }
  return [...vistos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

// ---------- Formulários ----------
function salvarReferencia(ref) { upsert('referenciasFazenda', ref); recarregarReferencias(); }
function refGraoForm(ref = null) {
  if (!podeEditarReferencias()) return showToast('Só o ADM, o supervisor ou o agrônomo cadastram referências.', true);
  const r = ref?.regra || {}, d = ref?.destinoSel || 'grao';
  openForm({title: ref ? 'Editar referência de grãos' : 'Nova referência de grãos', sub: 'Use quando não houver norma oficial no app. Fica identificada como referência da fazenda; se existir norma oficial para a mesma condição, a oficial prevalece.',
    values: {produto: ref?.produtoSel || 'soja', produtoNome: ref?.produtoNome || '', destino: d, etapa: [].concat(r.etapa || ['secagem'])[0], ponto: [].concat(r.ponto || ['massa_graos'])[0], limiteMin: r.limiteMin ?? '', limiteMax: r.limiteMax ?? '', fonte: ref?.fonte || '', obs: ref?.obs || '', acao: ref?.acao || ''},
    fields: [{k: 'produto', label: 'Cultura', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true}, {k: 'produtoNome', label: 'Qual cultura (se “Outro”)'},
      {k: 'destino', label: 'Destino', type: 'select', options: DESTINOS_REF.map(([v, l]) => ({value: v, label: l})), required: true}, {k: 'etapa', label: 'Etapa', type: 'select', options: ETAPAS_REF.map(([v, l]) => ({value: v, label: l})), required: true},
      {k: 'ponto', label: 'O que é medido', type: 'select', options: PONTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true, full: true},
      {k: 'limiteMin', label: 'Mínimo (opcional)', type: 'number'}, {k: 'limiteMax', label: 'Máximo', type: 'number'},
      {k: 'fonte', label: 'Fonte da referência', required: true, full: true, placeholder: 'Ex.: Embrapa Trigo, contrato da cooperativa, manual do secador'},
      {k: 'acao', label: 'O que fazer quando passar do limite', full: true, placeholder: 'Ex.: reduzir a temperatura do ar'}, {k: 'obs', label: 'Observação / trecho da fonte', type: 'textarea'}],
    submit: 'Salvar referência',
    onSubmit: v => {
      if (v.limiteMin === '' && v.limiteMax === '') return 'Informe o limite (mínimo e/ou máximo)';
      if (v.limiteMin !== '' && v.limiteMax !== '' && v.limiteMin > v.limiteMax) return 'O mínimo não pode ser maior que o máximo';
      if (v.produto === 'outro' && !v.produtoNome) return 'Escreva qual é a cultura';
      const p = PONTOS_GRAO.find(x => x[0] === v.ponto), prod = chaveProduto(v.produto, v.produtoNome);
      const regra = {equipamentoFamilia: v.etapa === 'secagem' || v.etapa === 'pos_secagem' ? ['secador'] : '*', avaliacao: 'secagem_armazenagem', produto: [prod],
        destino: v.destino === 'grao' ? DESTINOS_GRAO_TODOS : [v.destino], etapa: [v.etapa], ponto: [v.ponto], posicao: '*', variavel: p[2], unidade: p[3],
        limiteMin: v.limiteMin === '' ? null : v.limiteMin, limiteMax: v.limiteMax === '' ? null : v.limiteMax, alvo: null, condicoes: [], excedenteComoAtencao: v.etapa === 'recebimento' && p[2] === 'umidade_graos'};
      const titulo = `${nomeProd(v.produto, v.produtoNome)} — ${p[1].replace(/ \(.*\)$/, '').toLowerCase()} (${ETAPAS_REF.find(e => e[0] === v.etapa)[1].toLowerCase()}, ${DESTINOS_REF.find(e => e[0] === v.destino)[1].toLowerCase()})`;
      salvarReferencia({...(ref || {}), id: ref?.id || uid(), tipo: 'regra', area: 'graos', titulo, regra, produtoSel: v.produto, produtoNome: v.produto === 'outro' ? v.produtoNome : '', destinoSel: v.destino,
        fonte: v.fonte, obs: v.obs, acao: v.acao, por: nomeUsuarioRef(), em: new Date().toISOString(), versao: (ref?.versao || 0) + 1, ativa: true});
      showToast('Referência da fazenda salva');
    }});
}
function refTabelaForm(ref = null) {
  if (!podeEditarReferencias()) return showToast('Só o ADM, o supervisor ou o agrônomo cadastram referências.', true);
  const t = ref?.tabela, tipos = t?.tipos || [];
  openForm({title: ref ? 'Editar tabela de classificação' : 'Nova tabela de classificação (fazenda)', sub: 'Tabela de tipos usada pela fazenda (contrato, cooperativa, recomendação) para culturas sem norma conferida no app. Os valores são o máximo de cada defeito, em %.',
    values: {produto: ref?.produtoSel || 'feijao', produtoNome: ref?.produtoNome || '', grupo: t?.grupo?.valor || '', defeitos: (t?.defeitos || []).map(d => d.rotulo).join('; '),
      t1: tipos[0] ? Object.values(tipos[0].limites).join('; ') : '', t2: tipos[1] ? Object.values(tipos[1].limites).join('; ') : '', t3: tipos[2] ? Object.values(tipos[2].limites).join('; ') : '', t4: tipos[3] ? Object.values(tipos[3].limites).join('; ') : '', fonte: ref?.fonte || '', obs: ref?.obs || ''},
    fields: [{k: 'produto', label: 'Cultura', type: 'select', options: PRODUTOS_GRAO.map(([v, l]) => ({value: v, label: l})), required: true}, {k: 'produtoNome', label: 'Qual cultura (se “Outro”)'},
      {k: 'grupo', label: 'Grupo (opcional)', placeholder: 'Ex.: II — se a norma tiver grupos e só faltar um'},
      {k: 'defeitos', label: 'Defeitos, na ordem', required: true, full: true, placeholder: 'Ex.: Impurezas; Avariados; Quebrados', hint: 'Separe por ponto e vírgula.'},
      {k: 't1', label: 'Tipo 1 — máximo de cada defeito (%)', required: true, full: true, placeholder: 'Ex.: 1; 4; 8'}, {k: 't2', label: 'Tipo 2 (opcional)', full: true}, {k: 't3', label: 'Tipo 3 (opcional)', full: true}, {k: 't4', label: 'Tipo 4 (opcional)', full: true},
      {k: 'fonte', label: 'Fonte da tabela', required: true, full: true, placeholder: 'Ex.: contrato da cooperativa 2026'}, {k: 'obs', label: 'Observação', type: 'textarea'}],
    submit: 'Salvar tabela',
    onSubmit: v => {
      if (v.produto === 'outro' && !v.produtoNome) return 'Escreva qual é a cultura';
      const nomes = v.defeitos.split(';').map(x => x.trim()).filter(Boolean); if (!nomes.length) return 'Informe os defeitos';
      const ids = nomes.map((n, i) => slugCultura(n) || 'defeito_' + (i + 1)), linhas = [v.t1, v.t2, v.t3, v.t4].map((x, i) => [i, x]).filter(([, x]) => x && x.trim());
      const tiposN = [];
      for (const [i, x] of linhas) {
        const vals = x.split(';').map(y => typeof numeroBR === 'function' ? numeroBR(y.trim()) : Number(y.trim().replace(',', '.')));
        if (vals.length !== nomes.length || vals.some(y => !(y >= 0))) return `Tipo ${i + 1}: informe ${nomes.length} ${nomes.length === 1 ? 'valor' : 'valores'} (um por defeito), separados por ponto e vírgula`;
        tiposN.push({tipo: `Tipo ${i + 1}`, limites: Object.fromEntries(ids.map((id, j) => [id, vals[j]]))});
      }
      for (let i = 1; i < tiposN.length; i++) if (ids.some(id => tiposN[i].limites[id] < tiposN[i - 1].limites[id])) return `O limite de um defeito diminui do Tipo ${i} para o Tipo ${i + 1}: confira a ordem`;
      const prod = chaveProduto(v.produto, v.produtoNome);
      const tabela = {produto: prod, ...(v.grupo ? {grupo: {campo: 'grupo', valor: v.grupo.trim(), rotulo: `Grupo ${v.grupo.trim()}`}} : {}), tipos: tiposN, foraDeTipo: 'Fora de Tipo', defeitos: nomes.map((n, j) => ({id: ids[j], rotulo: n}))};
      salvarReferencia({...(ref || {}), id: ref?.id || uid(), tipo: 'tabela', area: 'graos', titulo: `Classificação de ${nomeProd(v.produto, v.produtoNome).toLowerCase()}${v.grupo ? ' — grupo ' + v.grupo : ''}`, tabela, produtoSel: v.produto, produtoNome: v.produto === 'outro' ? v.produtoNome : '',
        fonte: v.fonte, obs: v.obs, por: nomeUsuarioRef(), em: new Date().toISOString(), versao: (ref?.versao || 0) + 1, ativa: true});
      showToast('Tabela da fazenda salva');
    }});
}
async function refMaquinaForm(ref = null) {
  if (!podeEditarReferencias()) return showToast('Só o ADM, o supervisor ou o agrônomo cadastram referências.', true);
  let ms; try { ms = await modelosMaquinas(); } catch { return showToast('Não foi possível carregar o banco de referências. Tente de novo.', true); }
  const r = ref?.regra || {};
  openForm({title: ref ? 'Editar referência de máquina' : 'Nova referência de máquina / implemento', sub: 'Para as avaliações sem norma oficial conferida (marcadas “sem norma”). Onde já existe norma oficial, ela prevalece.',
    values: {modelo: ref?.modelo || (ms.find(m => !m.oficial) || ms[0])?.k || '', limiteMin: r.limiteMin ?? '', limiteMax: r.limiteMax ?? '', fonte: ref?.fonte || '', obs: ref?.obs || '', acao: ref?.acao || ''},
    fields: [{k: 'modelo', label: 'Avaliação', type: 'select', options: ms.map(m => ({value: m.k, label: `${m.oficial ? '[norma oficial já existe] ' : '[sem norma] '}${m.rotulo} (${m.unidade})`})), required: true, full: true},
      {k: 'limiteMin', label: 'Mínimo (opcional)', type: 'number'}, {k: 'limiteMax', label: 'Máximo (opcional)', type: 'number'},
      {k: 'fonte', label: 'Fonte da referência', required: true, full: true, placeholder: 'Ex.: recomendação do agrônomo, manual do fabricante, ABNT…'},
      {k: 'acao', label: 'O que fazer quando passar do limite', full: true}, {k: 'obs', label: 'Observação', type: 'textarea'}],
    submit: 'Salvar referência',
    onSubmit: v => {
      const m = ms.find(x => x.k === v.modelo); if (!m) return 'Escolha a avaliação';
      if (v.limiteMin === '' && v.limiteMax === '') return 'Informe o limite (mínimo e/ou máximo)';
      if (v.limiteMin !== '' && v.limiteMax !== '' && v.limiteMin > v.limiteMax) return 'O mínimo não pode ser maior que o máximo';
      const b = m.base, regra = {equipamentoFamilia: [m.eq], avaliacao: m.avaliacao, produto: b.produto ?? '*', destino: b.destino ?? '*', etapa: b.etapa ?? '*', ponto: b.ponto ?? '*', posicao: b.posicao ?? '*',
        variavel: m.variavel, unidade: m.unidade, limiteMin: v.limiteMin === '' ? null : v.limiteMin, limiteMax: v.limiteMax === '' ? null : v.limiteMax, alvo: null, condicoes: b.condicoes || []};
      salvarReferencia({...(ref || {}), id: ref?.id || uid(), tipo: 'regra', area: 'maquinas', modelo: m.k, titulo: m.rotulo, regra, fonte: v.fonte, obs: v.obs, acao: v.acao, por: nomeUsuarioRef(), em: new Date().toISOString(), versao: (ref?.versao || 0) + 1, ativa: true});
      showToast(m.oficial ? 'Referência salva — atenção: há norma oficial para esta avaliação e ela prevalece' : 'Referência da fazenda salva');
    }});
}

// ---------- Tela ----------
const limiteTxt = r => [r.limiteMin != null ? 'mín. ' + num(r.limiteMin, 2) : '', r.limiteMax != null ? 'máx. ' + num(r.limiteMax, 2) : ''].filter(Boolean).join(' • ') + ' ' + (r.unidade || '');
VIEWS.referencias = () => {
  const pode = podeEditarReferencias(), refs = (db.referenciasFazenda || []).slice().sort((a, b) => (b.em || '').localeCompare(a.em || ''));
  const linha = ref => `<div class="row"><span class="status ${ref.ativa === false ? 'gray' : 'purple'}"></span><div><strong>${esc(ref.titulo)}</strong><small>${ref.tipo === 'tabela' ? `${ref.tabela.tipos.length} ${ref.tabela.tipos.length === 1 ? 'tipo' : 'tipos'} • ${ref.tabela.defeitos.map(d => d.rotulo).join(', ')}` : esc(limiteTxt(ref.regra))} • Fonte: ${esc(ref.fonte)} • ${ORIGEM_FAZENDA.toLowerCase()}, por ${esc(ref.por)} em ${fmtDate((ref.em || '').slice(0, 10))}${ref.ativa === false ? ' • <b>desativada</b>' : ''}</small></div>
    ${pode ? `<div class="row-actions">${mini('Editar', 'ref-edit', ref.id)}${mini(ref.ativa === false ? 'Ativar' : 'Desativar', 'ref-ativa', ref.id)}${mini('Excluir', 'ref-del', ref.id, 'del')}</div>` : ''}</div>`;
  const grupo = (titulo, area, botoes, vazio) => { const l = refs.filter(r => r.area === area); return `<div class="section-title"><h3>${titulo} (${l.length})</h3>${pode ? `<div class="btn-row" style="margin:0">${botoes}</div>` : ''}</div><section class="card list">${l.length ? l.map(linha).join('') : `<p class="nota" style="padding:12px 0;margin:0">${vazio}</p>`}</section>`; };
  return head('Referências técnicas', 'Normas oficiais vêm conferidas no app. Onde não há, a fazenda cadastra a referência que usa — sempre identificada como da fazenda.') +
    `<section class="card panel ref-explica"><p style="margin:0"><b>Como funciona:</b> o app avalia primeiro pela <b>norma oficial conferida</b> (MAPA, Embrapa, ISO…). Sem norma para aquela cultura ou máquina, usa a <b>referência da fazenda</b> cadastrada aqui, mostrando no resultado e no relatório quem cadastrou e a fonte. Se existir norma oficial para a mesma condição, <b>a oficial prevalece</b>.${pode ? '' : ' <br><b>Seu acesso:</b> você usa as referências; quem cadastra é o ADM, o supervisor ou o agrônomo.'}</p></section>` +
    grupo('Grãos — secagem e armazenagem', 'graos', btn('+ Limite de secagem / umidade', 'ref-grao', '', 'secondary') + btn('+ Tabela de classificação', 'ref-tabela', '', 'secondary'), 'Nenhuma. Ex.: feijão — massa até 40 °C na secagem (fonte: recomendação do agrônomo); trigo grupo II — tabela do contrato.') +
    grupo('Máquinas e implementos — aferição e calibragem', 'maquinas', btn('+ Referência de máquina', 'ref-maquina', '', 'secondary'), 'Nenhuma. Ex.: pulverizador — taxa de aplicação até ±5% da planejada; plantadeira — dose de adubo até ±5%.');
};
TITLES.referencias = 'Referências técnicas';
Object.assign(ACTIONS, {
  'ref-grao': () => refGraoForm(), 'ref-tabela': () => refTabelaForm(), 'ref-maquina': () => refMaquinaForm(),
  'ref-edit': id => { const r = find('referenciasFazenda', id); if (!r) return; r.tipo === 'tabela' ? refTabelaForm(r) : r.area === 'maquinas' ? refMaquinaForm(r) : refGraoForm(r); },
  'ref-ativa': id => { if (!podeEditarReferencias()) return; const r = find('referenciasFazenda', id); if (!r) return; r.ativa = r.ativa === false; save(); recarregarReferencias(); render(); },
  'ref-del': id => { if (!podeEditarReferencias()) return; confirmDialog('Excluir esta referência da fazenda? Avaliações já salvas continuam com o resultado da época.', () => { remove('referenciasFazenda', id); recarregarReferencias(); showToast('Referência excluída'); }); }
});

// =====================================================================================================
// “Inserir norma” no próprio fluxo: onde o app diria “Não foi possível avaliar”, quem pode (ADM, supervisor,
// agrônomo) toca em “Inserir norma”, vai para uma página com os campos que AQUELA avaliação precisa, toca em
// “Inserir” e volta exatamente para onde estava (assistente, leituras, cultura e equipamento preservados),
// com a avaliação refeita já usando a nova referência. “Cancelar” volta sem salvar.
// =====================================================================================================
let normaCtx = null; // {tipo:'grao'|'maquina'|'tabela', ...contexto, retorno:{hash, depois}}
const PONTO_NOME = {massa_graos: 'Massa de grãos', ar_entrada: 'Ar de entrada do secador', ar_saida: 'Ar de saída', grao_descarga: 'Grão na descarga', ambiente_armazem: 'Ambiente do armazém', amostra: 'Amostra do grão'};
const ETAPA_NOME = Object.fromEntries(ETAPAS_REF);
const DESTINO_NOME = {semente: 'Semente para plantio', comercializacao: 'Grão — venda', armazenamento_graos: 'Grão — armazenagem', racao_animal: 'Grão — ração animal', moagem_alimentacao_humana: 'Grão — moagem / alimentação humana', agroindustria: 'Grão — agroindústria'};
const TIPO_SEC_NOME = {estatico: 'Estático', continuo: 'Contínuo', intermitente: 'Intermitente'};
function botaoInserirNorma(ctx, depois) {
  if (!podeEditarReferencias()) return '<small class="nota">sem norma — peça ao agrônomo para inserir</small>';
  const k = 'n' + Math.random().toString(36).slice(2, 9); botaoInserirNorma.ctx[k] = {...ctx, depois};
  return `<button type="button" class="secondary btn-norma" data-act="norma-inserir" data-id="${k}">＋ Inserir norma</button>`;
}
botaoInserirNorma.ctx = {};
async function abrirNorma(k) {
  const c = botaoInserirNorma.ctx[k]; if (!c) return;
  if (c.tipo === 'maquina') { try { const b = await (dados.oficiais || dados)('regras'); c.base = (b.regras || []).find(r => r.id === c.baseId); } catch { /* sem banco */ } if (!c.base) return showToast('Não foi possível identificar a avaliação. Use Referências técnicas.', true); }
  normaCtx = {...c, retorno: {hash: location.hash, depois: c.depois}}; go('norma');
}
function voltarDaNorma(salvou) {
  const r = normaCtx?.retorno; normaCtx = null;
  if (!r) return go('referencias');
  location.hash = r.hash;
  if (salvou) setTimeout(() => refazerAvaliacao(r.depois), 60);
}
// Refaz a avaliação de onde o usuário estava, já com a nova referência
async function refazerAvaliacao(depois) {
  try {
    recarregarReferencias();
    if (depois === 'afericao' && typeof wz !== 'undefined' && wz?.passo === 3) { wz.resultado = await calcular(); render(); }
    else if (depois === 'secagem' && typeof sc !== 'undefined' && sc?.passo === 4) { sc.resultado = await calcularSecagem(); render(); }
    else if (String(depois).startsWith('lote:')) {
      regrasGraos = await dados('regras'); const l = find('lotesSecagem', depois.slice(5));
      if (l) { (l.leituras || []).forEach(le => { le.aval = avaliarLeituraSecador(l, le); }); if (l.umidadeSaida !== '' && l.umidadeSaida != null) l.avalSaida = avaliarUmidadeSaida(l, l.umidadeSaida); save(); }
      render();
    } else if (String(depois).startsWith('classif:')) { regrasGraos = await dados('regras'); render(); setTimeout(() => classificacaoForm(depois.slice(8)), 50); }
    showToast('Norma inserida — avaliação refeita com a referência da fazenda');
  } catch (e) { showToast('Norma salva. Não foi possível refazer a avaliação agora: ' + e.message, true); }
}

// Campos exatos de cada tipo de avaliação (os mesmos limites e unidades que o avaliador usa nas normas oficiais)
function camposNorma(c) {
  const campo = (k, rotulo, extra = '', hint = '') => `<div class="field"><label for="nm_${k}">${rotulo}</label><input id="nm_${k}" data-nm="${k}" inputmode="decimal" autocomplete="off" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  if (c.tipo === 'grao') {
    const umid = c.variavel === 'umidade_graos';
    return (umid ? campo('max', 'Umidade máxima (%) *', 'required', c.etapa === 'recebimento' ? 'Acima dela: atenção — encaminhar ao secador e descontar.' : 'Acima dela: voltar ao secador antes de armazenar.') + campo('atencaoMin', 'Abaixo de (%) — atenção por secagem demais', '', 'Opcional. Ex.: 12 → abaixo de 12% o app avisa que perdeu peso vendável.')
      : campo('max', `Temperatura máxima — ${PONTO_NOME[c.ponto] || c.ponto} (°C) *`, 'required') + campo('min', 'Temperatura mínima (°C)', '', 'Opcional.')) +
      `<div class="field"><label for="nm_destinos">Vale para</label><select id="nm_destinos" data-nm="destinos"><option value="este">Só ${esc(DESTINO_NOME[c.destino] || c.destino).toLowerCase()}</option>${c.destino !== 'semente' ? '<option value="grao">Todos os usos de grão (venda, armazenagem, ração, moagem, agroindústria)</option>' : ''}</select></div>` +
      (c.etapa === 'secagem' && c.tipoSecador ? `<div class="field"><label for="nm_secador">Tipo de secador</label><select id="nm_secador" data-nm="secador"><option value="">Qualquer secador</option><option value="${esc(c.tipoSecador)}">Só secador ${esc(TIPO_SEC_NOME[c.tipoSecador] || c.tipoSecador).toLowerCase()}</option></select></div>` : '');
  }
  if (c.tipo === 'tabela') {
    return `<div class="field full"><label for="nm_defeitos">Defeitos, na ordem *</label><input id="nm_defeitos" data-nm="defeitos" required placeholder="Ex.: Impurezas; Avariados; Quebrados"><span class="hint">Separe por ponto e vírgula. Valores: máximo de cada defeito, em % do peso.</span></div>` +
      [1, 2, 3, 4].map(i => `<div class="field full"><label for="nm_t${i}">Tipo ${i}${i === 1 ? ' *' : ' (opcional)'}</label><input id="nm_t${i}" data-nm="t${i}" ${i === 1 ? 'required' : ''} placeholder="${i === 1 ? 'Ex.: 1; 4; 8' : ''}"></div>`).join('') +
      `<div class="field"><label for="nm_grupo">Grupo (opcional)</label><input id="nm_grupo" data-nm="grupo" placeholder="Se a norma tiver grupos"></div>`;
  }
  // Máquinas: conforme a variável da avaliação
  const v = c.base.variavel, un = c.base.unidade;
  if (/^desvio_|^erro_relativo/.test(v)) return campo('abaixo', `Aceita até quantos % ABAIXO do alvo *`, 'required', 'Ex.: 5 → aceita até −5%.') + campo('acima', `Aceita até quantos % ACIMA do alvo *`, 'required', 'Ex.: 5 → aceita até +5%. O alvo é o valor informado na aferição.');
  if (v === 'percentual_espacamentos_aceitaveis') return campo('min', 'Mínimo de espaçamentos aceitáveis (%) *', 'required', 'Ex.: 90 → pelo menos 90% das sementes no espaçamento aceitável.');
  if (v === 'cv_transversal') return campo('max', 'Coeficiente de variação máximo (%) *', 'required', 'Quanto menor, mais uniforme a faixa.');
  if (v === 'perda_total') return campo('max', `Perda máxima aceitável (${un}) *`, 'required');
  return campo('min', `Mínimo (${un})`) + campo('max', `Máximo (${un})`);
}
function contextoNormaHTML(c) {
  const linha = (k, v) => v ? `<div><small>${k}</small><b>${esc(v)}</b></div>` : '';
  if (c.tipo === 'grao') return linha('Cultura', c.produtoNomeExib) + linha('Destino', DESTINO_NOME[c.destino] || c.destino) + linha('Etapa', ETAPA_NOME[c.etapa] || c.etapa) + linha('O que é medido', `${PONTO_NOME[c.ponto] || c.ponto} — ${c.variavel === 'umidade_graos' ? 'umidade (%)' : 'temperatura (°C)'}`) + linha('Valor medido agora', c.valor != null ? `${num(c.valor, 1)} ${c.variavel === 'umidade_graos' ? '%' : '°C'}` : '');
  if (c.tipo === 'tabela') return linha('Cultura', c.produtoNomeExib) + linha('Uso', 'Classificação da carga no recebimento');
  const b = c.base;
  return linha('Equipamento', [].concat(b.equipamentoFamilia).map(e => NOMES_EQUIP[e] || e).join(', ')) + linha('Avaliação', `${NOMES_AVAL[b.avaliacao] || b.avaliacao} — ${b.titulo.replace(/^.*?—\s*/, '')}`) + linha('Unidade', b.unidade) +
    ((b.condicoes || []).length ? `<div class="full"><small>Condições da medição (as mesmas da norma)</small><ul class="pend">${b.condicoes.map(x => `<li>${esc(x.descricao || x.campo)}</li>`).join('')}</ul></div>` : '') +
    (c.alvos ? Object.entries(c.alvos).filter(([, x]) => x !== '' && x != null).map(([k, x]) => linha(k, String(x))).join('') : '');
}
VIEWS.norma = () => {
  const c = normaCtx;
  if (!c) return head('Inserir norma', '') + `<section class="card">${empty('Nada para inserir', 'Abra pelo botão “Inserir norma” na avaliação.', {act: 'nav', id: 'referencias', label: 'Referências técnicas'})}</section>`;
  if (!podeEditarReferencias()) return head('Inserir norma', '') + `<section class="card">${empty('Sem permissão', 'Só o ADM, o supervisor ou o agrônomo inserem normas.', {act: 'norma-cancelar', label: 'Voltar'})}</section>`;
  return head('Inserir norma', c.tipo === 'tabela' ? 'Tabela de classificação usada pela fazenda' : 'Referência técnica para esta avaliação') +
    `<section class="card panel norma-ctx"><div class="norma-grade">${contextoNormaHTML(c)}</div><p class="nota" style="margin:8px 0 0">Não há norma oficial conferida para esta condição. A referência fica marcada como <b>referência da fazenda, por ${esc(nomeUsuarioRef())}, em ${fmtDate(today())}</b>, separada das normas oficiais — se uma norma oficial for carregada depois, ela prevalece.</p></section>
    <section class="card panel"><div class="form" id="normaForm">${camposNorma(c)}
      <div class="field full"><label for="nm_fonte">Fonte *</label><input id="nm_fonte" data-nm="fonte" required placeholder="Ex.: recomendação do agrônomo, Embrapa, manual do fabricante, contrato da cooperativa"></div>
      ${c.tipo !== 'tabela' ? '<div class="field full"><label for="nm_acao">O que fazer quando passar do limite</label><input id="nm_acao" data-nm="acao" placeholder="Opcional. Ex.: reduzir a temperatura do ar"></div>' : ''}
      <div class="field full"><label for="nm_obs">Observação / trecho da fonte</label><textarea id="nm_obs" data-nm="obs" rows="2"></textarea></div></div>
      <div class="actions"><button class="secondary" data-act="norma-cancelar">Cancelar</button><button class="primary" data-act="norma-salvar">Inserir</button></div></section>`;
};
TITLES.norma = 'Inserir norma';
function lerNorma() { const v = {}; document.querySelectorAll('[data-nm]').forEach(el => { v[el.dataset.nm] = el.value.trim(); }); return v; }
const numN = x => x === '' || x == null ? null : (typeof numeroBR === 'function' ? numeroBR(x) : Number(String(x).replace(',', '.')));
function salvarNorma() {
  const c = normaCtx; if (!c || !podeEditarReferencias()) return;
  const v = lerNorma(), base = {fonte: v.fonte, obs: v.obs, acao: v.acao, por: nomeUsuarioRef(), em: new Date().toISOString(), versao: 1, ativa: true, id: uid()};
  if (!v.fonte) return showToast('Informe a fonte da norma', true);
  if (c.tipo === 'grao') {
    const max = numN(v.max), min = numN(v.min), at = numN(v.atencaoMin);
    if (max == null || Number.isNaN(max) || max === undefined) return showToast('Informe o limite máximo', true);
    if (min != null && min > max) return showToast('O mínimo não pode ser maior que o máximo', true);
    const umid = c.variavel === 'umidade_graos', destinos = v.destinos === 'grao' ? DESTINOS_GRAO_TODOS : [c.destino];
    const regra = {equipamentoFamilia: ['secagem', 'pos_secagem'].includes(c.etapa) ? ['secador'] : '*', avaliacao: 'secagem_armazenagem', produto: [c.produto], destino: destinos, etapa: [c.etapa], ponto: [c.ponto], posicao: '*',
      variavel: c.variavel, unidade: umid ? '%' : '°C', limiteMin: min ?? null, limiteMax: max, alvo: null, ...(at != null ? {faixaAtencao: {min: at}, acaoAtencao: `Abaixo de ${num(at, 1)}%: secagem além do necessário (perde peso vendável). Ajuste o ponto de saída.`} : {}),
      excedenteComoAtencao: c.etapa === 'recebimento' && umid, condicoes: v.secador ? [{campo: 'tipoSecador', operador: 'igual', valor: v.secador, descricao: `Secador do tipo ${TIPO_SEC_NOME[v.secador] || v.secador}.`}] : []};
    salvarReferencia({...base, tipo: 'regra', area: 'graos', regra, produtoSel: c.produtoSel, produtoNome: c.produtoNome || '', destinoSel: v.destinos === 'grao' ? 'grao' : c.destino,
      titulo: `${c.produtoNomeExib} — ${PONTO_NOME[c.ponto].toLowerCase()} (${(ETAPA_NOME[c.etapa] || c.etapa).toLowerCase()}, ${v.destinos === 'grao' ? 'todos os usos de grão' : (DESTINO_NOME[c.destino] || c.destino).toLowerCase()})`});
  } else if (c.tipo === 'tabela') {
    const nomes = (v.defeitos || '').split(';').map(x => x.trim()).filter(Boolean); if (!nomes.length) return showToast('Informe os defeitos', true);
    const ids = nomes.map((n, i) => slugCultura(n) || 'defeito_' + (i + 1)), tipos = [];
    for (const i of [1, 2, 3, 4]) {
      const x = v['t' + i]; if (!x) { if (i === 1) return showToast('Informe os limites do Tipo 1', true); continue; }
      const vals = x.split(';').map(y => numN(y.trim()));
      if (vals.length !== nomes.length || vals.some(y => !(y >= 0))) return showToast(`Tipo ${i}: informe ${nomes.length} ${nomes.length === 1 ? 'valor' : 'valores'}, um por defeito, separados por ponto e vírgula`, true);
      tipos.push({tipo: `Tipo ${i}`, limites: Object.fromEntries(ids.map((id, j) => [id, vals[j]]))});
    }
    for (let i = 1; i < tipos.length; i++) if (ids.some(id => tipos[i].limites[id] < tipos[i - 1].limites[id])) return showToast(`Um limite diminui do ${tipos[i - 1].tipo} para o ${tipos[i].tipo}: confira a ordem`, true);
    const tabela = {produto: c.produto, ...(v.grupo ? {grupo: {campo: 'grupo', valor: v.grupo, rotulo: `Grupo ${v.grupo}`}} : {}), tipos, foraDeTipo: 'Fora de Tipo', defeitos: nomes.map((n, j) => ({id: ids[j], rotulo: n}))};
    salvarReferencia({...base, tipo: 'tabela', area: 'graos', tabela, produtoSel: c.produtoSel, produtoNome: c.produtoNome || '', titulo: `Classificação de ${c.produtoNomeExib.toLowerCase()}${v.grupo ? ' — grupo ' + v.grupo : ''}`});
  } else {
    const b = c.base, vv = b.variavel; let min = null, max = null;
    if (/^desvio_|^erro_relativo/.test(vv)) { const ab = numN(v.abaixo), ac = numN(v.acima); if (!(ab >= 0) || !(ac >= 0)) return showToast('Informe quanto aceita abaixo e acima do alvo (em %)', true); min = -ab; max = ac; }
    else if (vv === 'percentual_espacamentos_aceitaveis') { min = numN(v.min); if (!(min >= 0 && min <= 100)) return showToast('Informe o mínimo entre 0 e 100%', true); max = 100; }
    else if (vv === 'cv_transversal' || vv === 'perda_total') { max = numN(v.max); if (!(max >= 0)) return showToast('Informe o máximo', true); }
    else { min = numN(v.min); max = numN(v.max); if (min == null && max == null) return showToast('Informe o limite', true); }
    const regra = {equipamentoFamilia: b.equipamentoFamilia, avaliacao: b.avaliacao, produto: b.produto ?? '*', destino: b.destino ?? '*', etapa: b.etapa ?? '*', ponto: b.ponto ?? '*', posicao: b.posicao ?? '*',
      variavel: vv, unidade: b.unidade, limiteMin: min, limiteMax: max, alvo: null, condicoes: b.condicoes || []};
    salvarReferencia({...base, tipo: 'regra', area: 'maquinas', modelo: b.id, regra, titulo: `${[].concat(b.equipamentoFamilia).map(e => NOMES_EQUIP[e] || e).join(', ')} — ${NOMES_AVAL[b.avaliacao] || b.avaliacao}: ${b.titulo.replace(/^.*?—\s*/, '')}`});
  }
  voltarDaNorma(true);
}
Object.assign(ACTIONS, {'norma-inserir': abrirNorma, 'norma-cancelar': () => voltarDaNorma(false), 'norma-salvar': salvarNorma});

// ---------- Botões “Inserir norma” nos fluxos ----------
// Aferição e calibragem (passo de resultado do assistente)
if (typeof blocoResultado === 'function') {
  const blocoSemNorma = blocoResultado;
  blocoResultado = function (r, w) {
    const html = blocoSemNorma(r, w);
    if (typeof wz === 'undefined' || !wz || w !== wz) return html;
    const p = typeof principal === 'function' ? principal(r) : null, cand = p?.referenciasCandidatas?.[0];
    if (!p || p.status !== 'SEM_REFERENCIA' || !cand) return html;
    const alvos = {'Taxa planejada (L/ha)': w.taxaPlanejada, 'Vazão de catálogo (L/min)': w.vazaoCatalogo, 'Sementes por metro planejadas': w.sementesPorMetro, 'Dose planejada': w.dosePlanejada};
    return html + `<section class="card panel norma-chamada"><b>Sem norma oficial conferida para concluir esta avaliação.</b><p class="nota" style="margin:4px 0 8px">Insira a referência que a fazenda usa: o app volta para cá e conclui a avaliação com ela.</p>${botaoInserirNorma({tipo: 'maquina', baseId: cand.regraId, alvos}, 'afericao')}</section>`;
  };
}
// Leituras avulsas de secador/moega/silo (resultado do assistente)
if (typeof resultadoSecagem === 'function') {
  const resultadoSemNorma = resultadoSecagem;
  resultadoSecagem = function (r, s) {
    const html = resultadoSemNorma(r, s);
    if (typeof sc === 'undefined' || !sc || s !== sc) return html;
    const sem = (r.leituras || []).filter(l => l.avaliacao.status === 'SEM_REFERENCIA');
    if (!sem.length) return html;
    const prodNome = (PRODUTOS_GRAO.find(x => x[0] === s.produto) || [, s.produto])[1];
    return html + `<section class="card panel norma-chamada"><b>Sem norma conferida para ${sem.length === 1 ? 'esta leitura' : 'estas leituras'}.</b><div class="btn-row" style="margin-top:8px">${sem.map(l => `<span class="nota">${esc(VARIAVEL[l.variavel] || l.variavel)} — ${esc(PONTO_NOME[l.ponto] || l.ponto)}:</span> ${botaoInserirNorma({tipo: 'grao', produto: s.produto, produtoSel: s.produto, produtoNomeExib: prodNome, destino: s.destino, etapa: s.etapa, ponto: l.ponto, variavel: l.variavel, valor: l.valor, tipoSecador: s.tipoSecador || ''}, 'secagem')}`).join('<br>')}</div></section>`;
  };
}

// Menu: “Referências técnicas” só para quem cadastra (ADM, supervisor, agrônomo); os demais usam as referências sem ver a tela
if (typeof nvAplicarMenu === 'function') {
  const menuSemRef = nvAplicarMenu;
  nvAplicarMenu = function (...a) { const r = menuSemRef.apply(this, a); document.querySelectorAll('[data-route="referencias"]').forEach(b => { if (!podeEditarReferencias()) b.hidden = true; }); return r; };
}
