'use strict';
/* Nexus Agro — Secador e Moega: registro rápido em 4 etapas e avaliação contra referências por produto + destino + etapa + ponto. */

const LOCAIS = {secador: 'Secador', moega: 'Moega (recebimento)', armazem: 'Silo / armazém'};
const TIPO_SECADOR = [['estatico', 'Estático'], ['continuo', 'Contínuo'], ['intermitente', 'Intermitente']];
const DESTINOS = [['semente', 'Semente para plantio'], ['agroindustria', 'Grão — agroindústria / processamento'], ['armazenamento_graos', 'Grão — armazenamento'],
  ['moagem_alimentacao_humana', 'Grão — moagem / alimentação humana'], ['racao_animal', 'Grão — ração animal'], ['comercializacao', 'Grão — comercialização (classificação)']];
const ETAPAS = [['recebimento', 'Recebimento (moega)'], ['pre_limpeza', 'Pré-limpeza'], ['secagem', 'Secagem'], ['pos_secagem', 'Saída do secador / pós-secagem'], ['armazenamento', 'Armazenamento']];
const PONTOS = [['massa_graos', 'Massa de grãos / sementes'], ['ar_entrada', 'Ar de entrada (ar de secagem)'], ['ar_saida', 'Ar de saída'], ['grao_descarga', 'Grão na descarga'], ['ambiente_armazem', 'Ambiente do armazém']];
const REGIOES = [['sul', 'RS, SC e centro-sul do PR'], ['transicao', 'Norte e oeste do PR, sul do MS e SP'], ['cerrados', 'Demais regiões dos Cerrados']];
const EMBALAGENS = [['sacaria', 'Sacaria'], ['big_bag', 'Big-bag']];
const PRODUTOS_SEC = [['soja', 'Soja'], ['milho', 'Milho'], ['trigo', 'Trigo'], ['feijao', 'Feijão'], ['arroz', 'Arroz'], ['sorgo', 'Sorgo'], ['outro', 'Outro']];
const VARIAVEL = {temperatura: 'Temperatura', umidade_graos: 'Umidade dos grãos', umidade_relativa_ar: 'Umidade relativa do ar',
  graos_avariados: 'Grãos avariados', graos_quebrados_amassados: 'Partidos, quebrados e amassados', impurezas_materias_estranhas: 'Matérias estranhas e impurezas'};
// Versão 0.5.0 gravava estes defeitos como leituras simples (registros antigos continuam exibidos)
const CLASSIF = [['impureza', 'impurezas_materias_estranhas'], ['avariados', 'graos_avariados'], ['quebrados', 'graos_quebrados_amassados']];
// Tabelas oficiais de classificação (IN 11/2007 soja, IN 60/2011 milho), carregadas do banco antes da etapa 3
let TABS_CLASS = null;
const tabelasDoProduto = s => (TABS_CLASS || []).filter(t => t.produto === s.produto && t.statusValidacao !== 'suspensa'
  && (t.destino === '*' || [].concat(t.destino).includes(s.destino)) && (t.etapa === '*' || [].concat(t.etapa).includes(s.etapa)));
const camposClass = s => Object.keys(s).filter(k => k.startsWith('cl_'));
const rotulo = (lista, v) => (lista.find(x => x[0] === v) || [, v || '—'])[1];

let sc = null;
function criarSecagem(machineId) {
  const mq = machineId ? find('machines', machineId) : null;
  const local = mq?.type === 'Moega' ? 'moega' : mq?.type === 'Silo/Armazém' ? 'armazem' : mq?.type === 'Secador' ? 'secador' : '';
  return {passo: 1, machineId: machineId || '', local, tipoSecador: mq?.tipoSecador || '', produto: '', lotId: '', destino: '', etapa: local === 'moega' ? 'recebimento' : local === 'armazem' ? 'armazenamento' : '',
    ponto: '', posicao: '', regiaoArmazenamento: db.settings.regiaoArmazenamento || '', embalagem: '',
    data: today(), hora: nowTime(), responsavel: db.settings.owner || '', instrumento: '', observacoes: ''};
}
function novaSecagem(machineId) { sc = criarSecagem(machineId); go('secagem/nova'); }

const sSel = (k, opts, v, vazio = '—') => `<select data-sc="${k}" id="sc_${k}"><option value="">${vazio}</option>${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
const sInp = (k, v, attrs = '') => `<input data-sc="${k}" id="sc_${k}" value="${esc(v ?? '')}" ${attrs}>`;
const sCampo = (k, label, html, hint = '', full = false) => `<div class="field ${full ? 'full' : ''}"><label for="sc_${k}">${esc(label)}</label>${html}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
const sNum = (k, label, hint = '', full = false) => sCampo(k, label, sInp(k, sc[k], 'inputmode="decimal"'), hint, full);
const sNav = (voltar, avancar = 'Próximo →') => `<div class="actions">${voltar ? '<button class="secondary" data-act="sc-voltar">← Voltar</button>' : '<button class="secondary" data-act="sc-cancelar">Cancelar</button>'}<button class="primary" data-act="sc-avancar">${avancar}</button></div>`;
const SPASSOS = ['Equipamento e produto', 'Etapa e ponto', 'Medições', 'Resultado'];

VIEWS.secagem = arg => {
  if (arg === 'nova') { if (!sc) sc = criarSecagem(); return passoSecagem(); }
  if (arg) return relatorioSecagem(arg);
  const lista = db.secagem.slice().sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
  return head('Secador e moega', 'Leituras de temperatura e umidade avaliadas pelo ponto de medição, produto, destino e etapa. Funciona sem internet.', btn('+ Nova leitura', 'sc-nova')) +
    `<section class="card panel" style="margin-bottom:14px"><h3>Como o sistema avalia</h3><p class="nota" style="margin:0">Cada leitura só é comparada com uma referência técnica do <strong>mesmo ponto de medição</strong> (ex.: o limite da massa de grãos nunca é aplicado ao ar de entrada), da mesma cultura, destino e etapa. Sem referência aplicável, o resultado é <strong>“Não foi possível avaliar”</strong>, com o motivo.</p></section>` +
    `<div class="section-title"><h3>Registros (${lista.length})</h3></div><section class="card list">${lista.length ? lista.map(a => `<div class="row clickable" data-act="nav" data-id="secagem/${esc(a.id)}" style="cursor:pointer"><span class="status ${STATUS_INFO[a.resultado.status]?.cor === 'gray' ? 'blue' : STATUS_INFO[a.resultado.status]?.cor}"></span><div><strong>${esc(LOCAIS[a.local] || a.local)} — ${esc(a.equipamento?.name || 'não cadastrado')} — ${esc(rotulo(PRODUTOS_SEC, a.produto))}</strong><small>${esc([fmtDate(a.data) + ' ' + a.hora, rotulo(ETAPAS, a.etapa), rotulo(DESTINOS, a.destino), a.lote?.code ? 'lote ' + a.lote.code : '', a.responsavel].filter(Boolean).join(' • '))}</small></div>${statusChip(a.resultado.status)}</div>`).join('')
      : empty('Nenhuma leitura registrada', 'Registre a primeira leitura do secador, da moega ou do armazém.', {act: 'sc-nova', label: '+ Nova leitura'})}</section>`;
};

function passoSecagem() {
  const s = sc;
  const topo = head('Nova leitura — secador e moega', 'Informe só o que foi medido agora. Dados fixos do equipamento e do lote são reaproveitados.') +
    `<div class="steps">${SPASSOS.map((t, i) => `<span class="${i + 1 === s.passo ? 'on' : i + 1 < s.passo ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
  if (s.passo === 1) {
    const equips = db.machines.filter(m => ['Secador', 'Moega', 'Silo/Armazém', 'Beneficiamento'].includes(m.type)).map(m => [m.id, `${m.name} (${m.type})`]);
    return topo + `<section class="card panel"><div class="form">
      ${sCampo('local', 'Local da leitura', sSel('local', Object.entries(LOCAIS), s.local, 'Selecione'), '', true)}
      ${sCampo('machineId', 'Equipamento', sSel('machineId', equips, s.machineId, 'Não cadastrado'), equips.length ? '' : 'Cadastre secadores, moegas e silos em Máquinas (tipo Secador, Moega ou Silo/Armazém).', true)}
      ${s.local === 'secador' ? sCampo('tipoSecador', 'Tipo de secador', sSel('tipoSecador', TIPO_SECADOR, s.tipoSecador, 'Não informado'), 'Algumas referências valem só para um tipo (ex.: secador estático).', true) : ''}
      ${sCampo('lotId', 'Lote', sSel('lotId', db.lots.map(l => [l.id, `${l.code} — ${[l.species, l.cultivar].filter(Boolean).join(' ')}`]), s.lotId, 'Sem lote'), 'Ao escolher um lote de sementes, cultura e destino são sugeridos.', true)}
      ${sCampo('produto', 'Produto / grão', sSel('produto', PRODUTOS_SEC, s.produto, 'Selecione'))}
      ${sCampo('destino', 'Destino do produto', sSel('destino', DESTINOS, s.destino, 'Selecione'), s.local === 'moega' ? 'Soja e milho com destino de grão são enquadrados em tipo pelas normas do MAPA (IN 11/2007 e IN 60/2011).' : 'Define a referência: semente e grão têm limites diferentes.')}
    </div>${sNav(false)}</section>`;
  }
  if (s.passo === 2) {
    const etapas = s.local === 'moega' ? ETAPAS.filter(e => ['recebimento', 'pre_limpeza'].includes(e[0])) : s.local === 'armazem' ? ETAPAS.filter(e => e[0] === 'armazenamento') : ETAPAS.filter(e => ['secagem', 'pos_secagem'].includes(e[0]));
    const pontos = s.local === 'armazem' ? PONTOS.filter(p => ['massa_graos', 'ambiente_armazem'].includes(p[0])) : s.local === 'moega' ? PONTOS.filter(p => ['massa_graos', 'grao_descarga'].includes(p[0])) : PONTOS.filter(p => p[0] !== 'ambiente_armazem');
    const armSemente = s.etapa === 'armazenamento' && s.destino === 'semente';
    return topo + `<section class="card panel"><div class="form">
      ${sCampo('etapa', 'Etapa', sSel('etapa', etapas, s.etapa, 'Selecione'), '', true)}
      ${sCampo('ponto', 'Onde a temperatura foi medida', sSel('ponto', pontos, s.ponto, 'Sem leitura de temperatura'), 'Fundamental: ar de entrada, massa de grãos e ar de saída têm referências diferentes.', true)}
      ${sCampo('posicao', 'Sensor / posição', sInp('posicao', s.posicao, 'placeholder="Ex.: superior, meio, inferior, termopar 3"'), '', true)}
      ${armSemente ? sCampo('regiaoArmazenamento', 'Região do armazenamento', sSel('regiaoArmazenamento', REGIOES, s.regiaoArmazenamento, 'Não informada'), 'A umidade recomendada para semente armazenada depende da região (Embrapa Soja).', true) + sCampo('embalagem', 'Embalagem', sSel('embalagem', EMBALAGENS, s.embalagem, 'Não informada'), '', true) : ''}
    </div>${sNav(true)}</section>`;
  }
  if (s.passo === 3) {
    const comUR = ['ar_entrada', 'ambiente_armazem'].includes(s.ponto);
    const moega = s.etapa === 'recebimento';
    return topo + `<section class="card panel"><div class="form">
      ${s.ponto ? sNum('temperatura', `Temperatura — ${rotulo(PONTOS, s.ponto)} (°C)`, '', true) : ''}
      ${comUR ? sNum('urAr', `Umidade relativa do ar — ${rotulo(PONTOS, s.ponto)} (%)`, 'Opcional.', true) : ''}
      ${moega ? sNum('umidadeFinal', 'Umidade do produto recebido (%)', 'Determinada na amostra da carga.', true) + camposClassificacao(s)
        : sNum('umidadeFinal', s.etapa === 'secagem' ? 'Umidade atual da amostra (%)' : 'Umidade da amostra (%)', 'Usada na comparação com a referência de armazenamento.') +
          (s.etapa !== 'armazenamento' ? sNum('umidadeInicial', 'Umidade inicial / na entrada (%)', 'Opcional — calcula a redução.') + sNum('umidadeMeta', 'Meta de umidade (%)', 'Opcional — sua meta operacional.') + sNum('massaInicial', 'Massa inicial (t)', 'Opcional — estima a quebra de peso pela secagem.') : '')}
      ${sCampo('data', 'Data', sInp('data', s.data, 'type="date"'))}${sCampo('hora', 'Hora', sInp('hora', s.hora, 'type="time"'))}
      ${sCampo('responsavel', 'Responsável', sInp('responsavel', s.responsavel), '', true)}
      ${sCampo('instrumento', 'Instrumento (opcional)', sInp('instrumento', s.instrumento, 'placeholder="Ex.: termômetro do secador, determinador de umidade…"'), '', true)}
      <div class="field full"><label for="sc_observacoes">Observações</label><textarea data-sc="observacoes" id="sc_observacoes" rows="2">${esc(s.observacoes || '')}</textarea></div>
    </div>${sNav(true, 'Avaliar →')}</section>`;
  }
  return topo + `<section class="card panel">${resultadoSecagem(s.resultado, s)}<div class="actions"><button class="secondary" data-act="sc-voltar">← Corrigir</button><button class="primary" data-act="sc-salvar">Salvar registro</button></div></section>`;
}

const ETAPAS_DO_LOCAL = {moega: ['recebimento', 'pre_limpeza'], armazem: ['armazenamento'], secador: ['secagem', 'pos_secagem']};
function ajustarEtapa() {
  const ok = ETAPAS_DO_LOCAL[sc.local] || [];
  if (!ok.includes(sc.etapa)) sc.etapa = ok.length === 1 || sc.local === 'moega' ? ok[0] : '';
}
VIEWS.secagem.after = () => {
  const re = () => { coletarSecagem(); ajustarEtapa(); render(); };
  for (const k of ['local', 'etapa', 'destino']) { const el = $('#sc_' + k); if (el) el.onchange = re; }
  const lote = $('#sc_lotId');
  if (lote) lote.onchange = () => {
    coletarSecagem();
    const l = find('lots', sc.lotId);
    if (l) {
      const sp = semAcento(l.species || '');
      const p = PRODUTOS_SEC.find(([k]) => k !== 'outro' && sp.includes(k));
      if (p) sc.produto = p[0];
      sc.destino = 'semente'; // lotes deste módulo são lotes de semente
    }
    render();
  };
  const maq = $('#sc_machineId');
  if (maq) maq.onchange = () => {
    coletarSecagem();
    const m = find('machines', sc.machineId);
    if (m?.type === 'Moega') sc.local = 'moega'; else if (m?.type === 'Silo/Armazém') sc.local = 'armazem'; else if (m?.type === 'Secador') sc.local = 'secador';
    if (m?.tipoSecador) sc.tipoSecador = m.tipoSecador;
    ajustarEtapa();
    render();
  };
};

function coletarSecagem() { $$('[data-sc]').forEach(el => { sc[el.dataset.sc] = el.value; }); }

function validarSecagem() {
  const s = sc;
  if (s.passo === 1) { if (!s.local) return 'Selecione o local da leitura'; if (!s.produto) return 'Selecione o produto'; if (!s.destino) return 'Selecione o destino — a referência depende dele'; }
  if (s.passo === 2 && !s.etapa) return 'Selecione a etapa';
  if (s.passo === 3) {
    const algum = ['temperatura', 'urAr', 'umidadeFinal', ...camposClass(s)].some(k => umNum(s[k]) !== undefined);
    if (!algum) return 'Informe pelo menos uma medição';
    for (const k of ['temperatura', 'urAr', 'umidadeFinal', 'umidadeInicial', 'umidadeMeta', 'massaInicial', 'impureza', ...camposClass(s)])
      if (s[k] !== undefined && s[k] !== '' && umNum(s[k]) === undefined) return `Valor inválido: ${s[k]}`;
  }
  return '';
}

async function calcularSecagem() {
  const s = sc, banco = await dados('regras');
  const leituras = [];
  if (s.ponto && umNum(s.temperatura) !== undefined) leituras.push({ponto: s.ponto, posicao: s.posicao || undefined, variavel: 'temperatura', valor: umNum(s.temperatura)});
  if (umNum(s.urAr) !== undefined) leituras.push({ponto: s.ponto, posicao: s.posicao || undefined, variavel: 'umidade_relativa_ar', valor: umNum(s.urAr)});
  if (umNum(s.umidadeFinal) !== undefined) leituras.push({ponto: 'amostra', variavel: 'umidade_graos', valor: umNum(s.umidadeFinal)});
  const r = AV().avaliarSecagem({equipamentoFamilia: s.local, produto: s.produto, destino: s.destino, etapa: s.etapa,
    condicoes: {tipoSecador: s.tipoSecador || undefined, regiaoArmazenamento: s.regiaoArmazenamento || undefined, embalagem: s.embalagem || undefined},
    classificacao: s.etapa === 'recebimento' ? {grupo: s.grupoSoja || undefined, valores: Object.fromEntries(camposClass(s).map(k => [k.slice(3), umNum(s[k])]).filter(([, v]) => v !== undefined))} : undefined,
    leituras, umidadeInicial: umNum(s.umidadeInicial), umidadeFinal: umNum(s.umidadeFinal), umidadeMeta: umNum(s.umidadeMeta), massaInicial: umNum(s.massaInicial)}, banco);
  // A meta é do operador; avisa se ela estiver acima da referência aplicável
  const ru = r.leituras.find(l => l.variavel === 'umidade_graos')?.avaliacao;
  const meta = umNum(s.umidadeMeta);
  if (meta !== undefined && ru?.limiteMax != null && (ru.limiteMaxExclusivo ? meta >= ru.limiteMax : meta > ru.limiteMax))
    r.pendencias.push(`A meta informada (${num(meta, 1)}%) não atende a referência ${ru.regraId} (${ru.limiteMaxExclusivo ? 'abaixo de' : 'até'} ${num(ru.limiteMax, 1)}%).`);
  return r;
}

function resultadoSecagem(r, s) {
  const info = STATUS_INFO[r.status] || {rotulo: r.status, cor: 'gray'};
  const fora = r.leituras.find(l => l.avaliacao.status === 'FORA_DO_PADRAO');
  const cl = r.classificacao;
  const acao = fora ? (fora.avaliacao.acaoRecomendada || 'Corrigir a operação e registrar nova leitura.')
    : cl?.status === 'FORA_DO_PADRAO' ? cl.consequencias.join(' ')
    : r.status === 'SEM_REFERENCIA' ? 'Obter uma referência aplicável antes de concluir a avaliação.'
    : r.status === 'DADOS_INSUFICIENTES' ? 'Completar os dados indicados nas pendências e avaliar novamente.'
    : r.status === 'OK' ? 'Nenhuma correção necessária para as leituras avaliadas.' : '';
  const lim = a => a.regraId ? `${a.limiteMin != null ? (a.limiteMinExclusivo ? 'acima de ' : 'mín. ') + num(a.limiteMin, 1) : ''}${a.limiteMin != null && a.limiteMax != null ? ' • ' : ''}${a.limiteMax != null ? (a.limiteMaxExclusivo ? 'abaixo de ' : 'até ') + num(a.limiteMax, 1) : ''} ${esc(a.unidade || '')}` : '—';
  const c = r.calculos || {};
  const calc = [
    c.reducaoUmidadePP != null && ['Redução de umidade', `${num(c.reducaoUmidadePP, 1)} p.p.`],
    c.diferencaMetaPP != null && ['Diferença para a meta', `${c.diferencaMetaPP > 0 ? '+' : ''}${num(c.diferencaMetaPP, 1)} p.p.`],
    c.massaFinalEstimada != null && ['Massa final estimada', `${num(c.massaFinalEstimada, 2)} t (quebra de ${num(c.quebraMassa, 2)} t = ${num(c.quebraPct, 2)}%)`],
    // registros antigos guardavam a impureza só como anotação
    s?.impureza && !r.leituras.some(l => l.variavel === 'impurezas_materias_estranhas') && ['Impureza registrada', `${s.impureza}%`],
    ...r.leituras.filter(l => CLASSIF.some(c => c[1] === l.variavel) && l.avaliacao.status === 'FORA_DO_PADRAO' && l.avaliacao.diferenca > 0)
      .map(l => [`Acima do limite — ${VARIAVEL[l.variavel].toLowerCase()}`, `${num(l.avaliacao.diferenca, 2)} p.p.`])
  ].filter(Boolean);
  return `<div class="resultado ${info.cor}"><small>RESULTADO</small><strong>${esc(info.rotulo)}</strong>${cl?.enquadramento ? `<small>CLASSIFICAÇÃO</small><strong>${esc(cl.enquadramento)}</strong>` : ''}<small>AÇÃO RECOMENDADA</small><span>${esc(acao)}</span></div>
    ${cl ? blocoClassificacao(cl) : ''}
    ${r.leituras.length ? `<h3 style="margin-top:16px">Leituras</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Leitura</th><th>Ponto</th><th class="num">Valor</th><th>Referência</th><th>Resultado</th></tr></thead><tbody>
    ${r.leituras.map(l => `<tr><td>${esc(VARIAVEL[l.variavel])}</td><td>${esc(l.ponto === 'amostra' ? 'Amostra do produto' : rotulo(PONTOS, l.ponto))}${l.posicao ? ' — ' + esc(l.posicao) : ''}</td><td class="num">${num(l.valor, 1)} ${l.variavel === 'temperatura' ? '°C' : '%'}</td><td>${lim(l.avaliacao)}${l.avaliacao.regraId ? `<br><small style="color:var(--muted)">${esc(l.avaliacao.regraId)} v${esc(l.avaliacao.regraVersao)}</small>` : ''}</td><td>${statusChip(l.avaliacao.status)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${calc.length ? `<h3 style="margin-top:16px">Valores calculados</h3><table class="tbl"><tbody>${calc.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.leituras.filter(l => l.avaliacao.regraId).map(l => { const f = (l.avaliacao.fontes || []).find(x => x.conferido !== false) || {}; return `<p class="nota"><strong>${esc(l.avaliacao.regraId)}</strong> — ${esc([f.organizacao, f.titulo].filter(Boolean).join(' — '))}${f.pagina ? ', ' + esc(f.pagina) : ''}${f.trechoLiteral ? `: <em>“${esc(f.trechoLiteral.slice(0, 300))}${f.trechoLiteral.length > 300 ? '…' : ''}”</em>` : ''}</p>`; }).join('')}
    ${resumoPendencias(r, s)}`;
}

// Campos de defeitos gerados a partir da tabela oficial do produto (mesmos rótulos da norma)
function camposClassificacao(s) {
  const tabs = tabelasDoProduto(s);
  if (!tabs.length) return sNum('impureza', 'Impureza / matérias estranhas (%)', 'Registro (sem tabela oficial de classificação no banco para este produto/destino).');
  const grupos = tabs.filter(t => t.grupo).map(t => [t.grupo.valor, t.grupo.rotulo]);
  const t = tabs.find(x => !x.grupo || x.grupo.valor === s.grupoSoja) || tabs[0];
  return `<p class="nota field full" style="margin:0"><strong>Classificação da amostra</strong> — % em peso, como no laudo do classificador. Deixe em branco o que não foi determinado.</p>` +
    (grupos.length ? sCampo('grupoSoja', 'Grupo (uso proposto)', sSel('grupoSoja', grupos, s.grupoSoja, 'Selecione'), 'Informação do interessado (IN 11/2007, Art. 4º, § 1º). Define a tabela de tolerâncias.', true) : '') +
    t.defeitos.map(d => sNum('cl_' + d.id, `${d.rotulo} (%)`, d.ajuda)).join('');
}

function blocoClassificacao(cl) {
  const f = (cl.fontes || [])[0] || {};
  return `<h3 style="margin-top:16px">Classificação${cl.grupoRotulo ? ' — ' + esc(cl.grupoRotulo) : ''}</h3>
    ${cl.defeitos.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Defeito</th><th class="num">Valor (norma)</th><th>Enquadra em</th></tr></thead><tbody>
    ${cl.defeitos.map(d => `<tr><td>${esc(d.rotulo)}</td><td class="num">${num(d.valor, cl.casasDecimais)}%${d.valorInformado !== d.valor ? `<br><small style="color:var(--muted)">informado ${num(d.valorInformado, 3)}</small>` : ''}</td><td>${esc(d.tipo)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${cl.motivos.length ? `<ul class="pend">${cl.motivos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${cl.tabelaId ? `<p class="nota"><strong>${esc(cl.tabelaId)} v${esc(cl.tabelaVersao)}</strong> — ${esc([f.organizacao, f.titulo].filter(Boolean).join(' — '))}${f.pagina ? ', ' + esc(f.pagina) : ''}. Enquadramento pelo pior tipo entre os defeitos; valores arredondados com ${cl.casasDecimais} casa(s) decimal(is), como a norma determina. A norma não estabelece desconto: descontos dependem do contrato ou da tabela do comprador.</p>` : ''}`;
}

// Explica em linguagem simples por que cada leitura não foi concluída; a lista técnica fica recolhida.
function resumoPendencias(r, s) {
  const ctx = [rotulo(PRODUTOS_SEC, s?.produto), rotulo(DESTINOS, s?.destino), rotulo(ETAPAS, s?.etapa)].filter(Boolean).join(' • ');
  const msgs = r.leituras.filter(l => l.avaliacao.status !== 'OK' && l.avaliacao.status !== 'FORA_DO_PADRAO' && l.avaliacao.status !== 'ATENCAO').map(l => {
    const onde = l.ponto === 'amostra' ? 'na amostra do produto' : 'em ' + rotulo(PONTOS, l.ponto).toLowerCase();
    if (l.avaliacao.status === 'DADOS_INSUFICIENTES') return `${VARIAVEL[l.variavel]} ${onde}: falta informar — ${l.avaliacao.pendencias.map(x => x.replace(/^Confirmar: /, '')).join('; ')}`;
    const cand = (l.avaliacao.referenciasCandidatas || []).filter(c => c.statusValidacao === 'pendente_conferencia' && c.limiteMax != null);
    return `${VARIAVEL[l.variavel]} ${onde}: não há referência validada para esta condição (${ctx}).` + (cand.length ? ` Existe referência ainda não conferida: ${cand.map(c => c.regraId).join(', ')}.` : '');
  });
  const extras = (r.pendencias || []).filter(x => !x.startsWith('['));
  const tecnicas = (r.pendencias || []).filter(x => x.startsWith('['));
  if (!msgs.length && !extras.length && !tecnicas.length) return '';
  return `<h3 style="margin-top:16px">Pendências</h3><ul class="pend">${[...msgs, ...extras].map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
    (tecnicas.length ? `<details class="tecnico"><summary>Detalhes técnicos (${tecnicas.length} verificações de escopo)</summary><ul class="pend">${tecnicas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '');
}

Object.assign(ACTIONS, {
  'sc-nova': id => novaSecagem(id),
  'sc-cancelar': () => { sc = null; go('secagem'); },
  'sc-voltar': () => { coletarSecagem(); sc.passo = Math.max(1, sc.passo - 1); render(); },
  'sc-avancar': async () => {
    coletarSecagem();
    const e = validarSecagem(); if (e) { showToast(e); return; }
    if (!TABS_CLASS) { try { TABS_CLASS = (await dados('regras')).tabelasClassificacao || []; } catch { TABS_CLASS = []; } }
    if (sc.passo === 3) { try { sc.resultado = await calcularSecagem(); } catch (x) { showToast('Não foi possível calcular: ' + x.message); return; } }
    sc.passo++; render(); scrollTo(0, 0);
  },
  'sc-salvar': () => {
    const s = sc, mq = s.machineId ? find('machines', s.machineId) : null, l = s.lotId ? find('lots', s.lotId) : null;
    if (s.regiaoArmazenamento) db.settings.regiaoArmazenamento = s.regiaoArmazenamento; // dado fixo da propriedade
    const reg = {id: uid(), data: s.data, hora: s.hora, responsavel: s.responsavel, local: s.local, produto: s.produto, destino: s.destino, etapa: s.etapa,
      equipamento: mq ? {id: mq.id, name: mq.name, type: mq.type, model: mq.model, tipoSecador: s.tipoSecador || null} : (s.tipoSecador ? {tipoSecador: s.tipoSecador} : null),
      lote: l ? {id: l.id, code: l.code, cultivar: l.cultivar, species: l.species} : null,
      entradas: Object.fromEntries(Object.entries(s).filter(([k]) => !['passo', 'resultado'].includes(k))),
      resultado: AV().congelar(s.resultado), criadoEm: new Date().toISOString()};
    if (mq && s.tipoSecador && !mq.tipoSecador) mq.tipoSecador = s.tipoSecador;
    db.secagem.push(reg);
    if (l) db.lotEvents.push({id: uid(), lotId: l.id, date: s.data, title: `${LOCAIS[s.local]}: ${rotulo(ETAPAS, s.etapa)}`, text: reg.resultado.leituras.map(x => `${VARIAVEL[x.variavel]} ${num(x.valor, 1)}${x.variavel === 'temperatura' ? ' °C' : '%'}`).join(' • ') + (reg.resultado.classificacao?.enquadramento ? `${reg.resultado.leituras.length ? ' • ' : ''}Classificação: ${reg.resultado.classificacao.enquadramento}` : '') + ` — ${STATUS_INFO[reg.resultado.status]?.rotulo}`});
    save(); sc = null; showToast('Leitura registrada'); go('secagem/' + reg.id);
  },
  'sc-excluir': id => confirmDialog('Excluir este registro?', () => { remove('secagem', id); go('secagem'); })
});

function relatorioSecagem(id) {
  const a = find('secagem', id);
  if (!a) return empty('Registro não encontrado', '');
  const e = a.entradas || {}, r = a.resultado;
  const linha = (k, v) => v ? `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>` : '';
  const regras = r.leituras.filter(l => l.avaliacao.regraId);
  return `<div class="no-print">${head('Relatório — secador e moega', `${LOCAIS[a.local]} • ${fmtDate(a.data)} ${a.hora}`, btn('← Registros', 'nav', 'secagem', 'secondary') + btn('Imprimir / PDF', 'af-imprimir', '', 'secondary') + `<button class="danger" data-act="sc-excluir" data-id="${esc(a.id)}">Excluir</button>`)}</div>
  <article class="card panel relatorio">
    <header class="rel-head"><div><strong>${esc(db.settings.farm || 'Nexus Agro')}</strong><br><small>Medição e comparação com referência técnica — secagem e armazenagem</small></div><small>Registro ${esc(a.id)}</small></header>
    <h3>1. Resultado e ação recomendada</h3>${resultadoSecagem(r, e)}
    <h3>2. Identificação e rastreabilidade</h3><table class="tbl"><tbody>
      ${linha('Local', LOCAIS[a.local])}${linha('Equipamento', a.equipamento?.name ? `${a.equipamento.name}${a.equipamento.model ? ' — ' + a.equipamento.model : ''}` : 'Não cadastrado')}
      ${linha('Tipo de secador', rotulo(TIPO_SECADOR, a.equipamento?.tipoSecador))}${linha('Propriedade / unidade', db.settings.farm)}
      ${linha('Lote', a.lote ? `${a.lote.code} — ${[a.lote.species, a.lote.cultivar].filter(Boolean).join(' ')}` : '')}
      ${linha('Produto', rotulo(PRODUTOS_SEC, a.produto))}${linha('Destino', rotulo(DESTINOS, a.destino))}
      ${linha('Data / hora', `${fmtDate(a.data)} ${a.hora}`)}${linha('Responsável', a.responsavel)}
    </tbody></table>
    <h3>3. Condições da leitura</h3><table class="tbl"><tbody>
      ${linha('Etapa', rotulo(ETAPAS, a.etapa))}${linha('Ponto de temperatura', e.ponto ? rotulo(PONTOS, e.ponto) : 'Sem leitura de temperatura')}${linha('Sensor / posição', e.posicao)}
      ${linha('Região de armazenamento', e.regiaoArmazenamento ? rotulo(REGIOES, e.regiaoArmazenamento) : '')}${linha('Embalagem', e.embalagem ? rotulo(EMBALAGENS, e.embalagem) : '')}
      ${linha('Umidade inicial (%)', e.umidadeInicial)}${linha('Umidade medida (%)', e.umidadeFinal)}${linha('Meta de umidade (%)', e.umidadeMeta)}${linha('Massa inicial (t)', e.massaInicial)}${linha('Impureza (%)', e.impureza)}${linha('Grãos avariados (%)', e.avariados)}${linha('Partidos, quebrados e amassados (%)', e.quebrados)}
      ${r.classificacao ? linha('Grupo', r.classificacao.grupoRotulo) + r.classificacao.defeitos.map(d => linha(`${d.rotulo} (%)`, num(d.valorInformado, 3))).join('') : ''}
    </tbody></table>
    <h3>4. Referência e condições de aplicação</h3><table class="tbl"><tbody>${regras.length ? regras.map(l => linha(`${VARIAVEL[l.variavel]} (${l.ponto === 'amostra' ? 'amostra' : rotulo(PONTOS, l.ponto)})`, `${l.avaliacao.regraId} v${l.avaliacao.regraVersao} — ${l.avaliacao.regraTitulo}. Condições: ${(l.avaliacao.condicoesAplicadas || []).join('; ') || 'escopo da regra (produto, destino, etapa, ponto)'}. Análise em ${new Date(l.avaliacao.dataAnalise).toLocaleString('pt-BR')} (banco ${l.avaliacao.bancoVersao}).`)).join('') : (r.classificacao ? '' : linha('Referência', 'Nenhuma referência validada aplicável às condições desta leitura.'))}
      ${r.classificacao?.tabelaId ? linha('Classificação', `${r.classificacao.tabelaId} v${r.classificacao.tabelaVersao} — ${r.classificacao.titulo}. Análise em ${new Date(r.classificacao.dataAnalise).toLocaleString('pt-BR')} (banco ${r.classificacao.bancoVersao}).`) : ''}</tbody></table>
    <h3>5. Instrumentos e observações</h3><table class="tbl"><tbody>${linha('Instrumento', e.instrumento || 'Não informado')}${linha('Rastreabilidade metrológica do instrumento', 'Não informada')}${linha('Observações', e.observacoes)}</tbody></table>
    <h3>6. Pendências e alcance do documento</h3>
    ${(r.pendencias || []).length ? `<ul class="pend">${r.pendencias.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Sem pendências registradas.</p>'}
    <p class="nota">Este documento registra uma <strong>medição e comparação</strong> com referência técnica operacional. <strong>Não é certificado de calibração, laudo laboratorial nem certificação de conformidade.</strong> Resultado, regras, versões e limites foram gravados no momento da análise e não mudam se as referências forem atualizadas.</p>
  </article>`;
}

// ---------- Integração ----------
TITLES.secagem = 'Secador e Moega';
const alertasComAfericao = alerts;
alerts = function () {
  const lista = alertasComAfericao();
  const limite = daysAgo(7);
  db.secagem.filter(a => a.data >= limite && a.resultado?.status === 'FORA_DO_PADRAO').forEach(a => lista.push({color: 'red', icon: '♨', title: `${LOCAIS[a.local]} fora da referência: ${a.equipamento?.name || rotulo(PRODUTOS_SEC, a.produto)}`, text: `${rotulo(ETAPAS, a.etapa)} em ${fmtDate(a.data)} ${a.hora}${a.lote?.code ? ' — lote ' + a.lote.code : ''}.`, route: 'secagem/' + a.id}));
  return lista;
};
