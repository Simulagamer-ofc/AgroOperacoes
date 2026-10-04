/*
 * Nexus Agro — avaliador de aferição e calibragem.
 *
 * Princípio: só conclui (OK / ATENCAO / FORA_DO_PADRAO) quando existe uma regra
 * VALIDADA cujo escopo (equipamento, produto, destino, etapa, ponto, posição,
 * variável, unidade) e condições coincidem com a leitura. Em qualquer outro caso
 * devolve SEM_REFERENCIA ou DADOS_INSUFICIENTES, explicando o que falta.
 *
 * Funciona no navegador (window.NexusAvaliador) e no Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusAvaliador = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUS = Object.freeze({
    OK: 'OK', ATENCAO: 'ATENCAO', FORA_DO_PADRAO: 'FORA_DO_PADRAO',
    SEM_REFERENCIA: 'SEM_REFERENCIA', DADOS_INSUFICIENTES: 'DADOS_INSUFICIENTES'
  });
  // Campos de escopo verificados, na ordem das perguntas 2–7 (variável é filtrada antes).
  const ESCOPO = [
    ['equipamentoFamilia', 'equipamento/família'], ['produto', 'cultura/produto'], ['destino', 'destino'],
    ['etapa', 'etapa'], ['ponto', 'ponto medido'], ['posicao', 'sensor/posição'], ['unidade', 'unidade']
  ];

  const finito = v => typeof v === 'number' && Number.isFinite(v);
  const vazio = v => v === undefined || v === null || v === '';
  const lista = v => Array.isArray(v) ? v : [v];
  const arred = (v, casas = 4) => finito(v) ? Math.round(v * 10 ** casas) / 10 ** casas : null;

  // ---------------- Cálculos (fórmulas do banco, seção "formulas") ----------------
  const calculos = {
    media(valores) { exigirNumeros(valores, 1); return valores.reduce((s, v) => s + v, 0) / valores.length; },
    desvioPadrao(valores) {
      exigirNumeros(valores, 2);
      const m = calculos.media(valores);
      return Math.sqrt(valores.reduce((s, v) => s + (v - m) ** 2, 0) / (valores.length - 1));
    },
    /** F-CV */
    cv(valores) { const m = calculos.media(valores); if (m === 0) throw new Error('Média zero: CV indefinido'); return calculos.desvioPadrao(valores) / m * 100; },
    /** F-DESVIO */
    desvio(medido, referencia) { exigirPositivo(referencia, 'referência'); exigirNumero(medido, 'valor medido'); return (medido - referencia) / referencia * 100; },
    /** F-TAXA-LHA: q em L/min por bico, v em km/h, e em m */
    taxaAplicacao(q, v, e) { exigirPositivo(q, 'vazão'); exigirPositivo(v, 'velocidade'); exigirPositivo(e, 'espaçamento'); return 600 * q / (v * e); },
    /** F-VAZAO-BICO */
    vazaoNecessaria(taxa, v, e) { exigirPositivo(taxa, 'taxa'); exigirPositivo(v, 'velocidade'); exigirPositivo(e, 'espaçamento'); return taxa * v * e / 600; },
    /** F-VAZAO-PRESSAO (estimativa; ver ressalva no banco) */
    vazaoNaPressao(q1, p1, p2) { exigirPositivo(q1, 'vazão'); exigirPositivo(p1, 'pressão de referência'); exigirPositivo(p2, 'pressão desejada'); return q1 * Math.sqrt(p2 / p1); },
    /** F-VELOCIDADE */
    velocidade(distanciaM, tempoS) { exigirPositivo(distanciaM, 'distância'); exigirPositivo(tempoS, 'tempo'); return 3.6 * distanciaM / tempoS; },
    /** F-POPULACAO */
    populacao(porMetro, espacamentoLinhasM) { exigirPositivo(porMetro, 'quantidade por metro'); exigirPositivo(espacamentoLinhasM, 'espaçamento entre linhas'); return porMetro * 10000 / espacamentoLinhasM; },
    /** F-XREF (cm) */
    xref(sementesPorMetro) { exigirPositivo(sementesPorMetro, 'sementes por metro'); return 100 / sementesPorMetro; },
    /** F-DOSE-KGHA */
    doseKgHa(massaKg, distanciaM, larguraM) { exigirNumero(massaKg, 'massa'); if (massaKg < 0) throw new Error('massa negativa'); exigirPositivo(distanciaM, 'distância'); exigirPositivo(larguraM, 'largura'); return massaKg * 10000 / (distanciaM * larguraM); },
    /** F-PERDA: retorna kg/ha e sacas de 60 kg/ha */
    perda(massaG, areaM2) { exigirNumero(massaG, 'massa'); if (massaG < 0) throw new Error('massa negativa'); exigirPositivo(areaM2, 'área'); const kg = massaG * 10 / areaM2; return {kgHa: kg, sc60Ha: kg / 60}; },
    /** Classificação de espaçamentos: duplos < 0,5·Xref ≤ aceitáveis ≤ 1,5·Xref < falhos */
    classificarEspacamentos(espacamentosCm, xrefCm) {
      exigirNumeros(espacamentosCm, 1); exigirPositivo(xrefCm, 'Xref');
      let duplos = 0, aceitaveis = 0, falhos = 0;
      for (const x of espacamentosCm) { if (x < 0.5 * xrefCm) duplos++; else if (x > 1.5 * xrefCm) falhos++; else aceitaveis++; }
      const n = espacamentosCm.length;
      return {n, duplos, aceitaveis, falhos, pctDuplos: duplos / n * 100, pctAceitaveis: aceitaveis / n * 100, pctFalhos: falhos / n * 100};
    }
  };
  function exigirNumero(v, nome) { if (!finito(v)) throw new Error(`${nome}: valor numérico obrigatório`); }
  function exigirPositivo(v, nome) { exigirNumero(v, nome); if (v <= 0) throw new Error(`${nome}: deve ser maior que zero`); }
  function exigirNumeros(vs, min) { if (!Array.isArray(vs) || vs.length < min || !vs.every(finito)) throw new Error(`Informe pelo menos ${min} valor(es) numérico(s)`); }

  // ---------------- Verificação de escopo e condições ----------------
  function verificarEscopo(regra, leitura) {
    const faltando = [], divergente = [];
    for (const [campo, nome] of ESCOPO) {
      const r = regra[campo];
      if (vazio(r)) { divergente.push(`regra ${regra.id} não declara ${nome} (regra incompleta)`); continue; }
      if (r === '*') continue;
      const v = leitura[campo];
      if (vazio(v)) { faltando.push(`${nome} não informado (a regra ${regra.id} exige ${lista(r).join(' ou ')})`); continue; }
      if (!lista(r).includes(v)) divergente.push(`${nome} "${v}" não coincide com a regra ${regra.id} (${lista(r).join(' ou ')})`);
    }
    return {faltando, divergente};
  }

  function verificarCondicoes(regra, condicoesLeitura = {}) {
    const faltando = [], divergente = [], aplicadas = [];
    for (const c of regra.condicoes || []) {
      const v = condicoesLeitura[c.campo];
      if (vazio(v)) { faltando.push(`Confirmar: ${c.descricao}`); continue; }
      let ok;
      switch (c.operador) {
        case 'igual': ok = v === c.valor; break;
        case 'em': ok = lista(c.valor).includes(v); break;
        case 'maior_igual': ok = finito(v) && v >= c.valor; break;
        case 'menor_igual': ok = finito(v) && v <= c.valor; break;
        default: ok = false; divergente.push(`operador desconhecido "${c.operador}" na regra ${regra.id}`); continue;
      }
      if (ok) aplicadas.push(c.descricao); else divergente.push(`Condição não satisfeita: ${c.descricao}`);
    }
    return {faltando, divergente, aplicadas};
  }

  const temLimite = r => finito(r.limiteMin) || finito(r.limiteMax);
  const mesmaFaixa = (a, b) => a.limiteMin === b.limiteMin && a.limiteMax === b.limiteMax;
  const fonteTexto = r => (r.fontes || []).map(f => [f.organizacao, f.titulo].filter(Boolean).join(' — ')).join('; ');

  function resultadoBase(leitura, banco, dataAnalise) {
    return {
      status: null, valorMedido: finito(leitura.valor) ? leitura.valor : null, unidade: leitura.unidade || '',
      limiteMin: null, limiteMax: null, alvo: null, diferenca: null, acaoRecomendada: '',
      regraId: '', regraVersao: '', regraTitulo: '', fonte: '', fontes: [],
      condicoesAplicadas: [], pendencias: [], referenciasCandidatas: [],
      bancoVersao: banco.versaoBanco || '', dataAnalise
    };
  }

  /**
   * Avalia uma leitura contra o banco de regras.
   * leitura: {equipamentoFamilia, produto, destino, etapa, ponto, posicao, variavel, unidade, valor, condicoes:{...}}
   */
  function avaliar(leitura, banco, opcoes = {}) {
    const dataAnalise = opcoes.dataAnalise || new Date().toISOString();
    const res = resultadoBase(leitura, banco, dataAnalise);
    const semConclusao = (status, acao) => Object.assign(res, {status, acaoRecomendada: acao});

    if (vazio(leitura.variavel)) { res.pendencias.push('Variável avaliada não informada.'); return semConclusao(STATUS.DADOS_INSUFICIENTES, 'Informar qual variável foi medida.'); }
    if (!finito(leitura.valor)) { res.pendencias.push('Valor medido não informado ou inválido.'); return semConclusao(STATUS.DADOS_INSUFICIENTES, 'Informar o valor medido.'); }

    // 1 e 6: existe referência para a variável?
    const candidatas = (banco.regras || []).filter(r => r.variavel === leitura.variavel && r.statusValidacao !== 'suspensa');
    if (!candidatas.length) {
      res.pendencias.push(`Nenhuma referência cadastrada para a variável "${leitura.variavel}".`);
      return semConclusao(STATUS.SEM_REFERENCIA, 'Obter uma referência técnica aplicável antes de concluir a avaliação.');
    }

    // 2–9: escopo, unidade e condições de cada candidata
    const aplicaveis = [], faltandoValidadas = [], faltandoOutras = [], divergenteGeral = [];
    for (const r of candidatas) {
      const esc = verificarEscopo(r, leitura);
      if (esc.divergente.length) { divergenteGeral.push(...esc.divergente); continue; }
      const cond = verificarCondicoes(r, leitura.condicoes);
      if (cond.divergente.length) { divergenteGeral.push(...cond.divergente); continue; }
      const faltando = [...esc.faltando, ...cond.faltando];
      if (faltando.length) { (r.statusValidacao === 'validada' && temLimite(r) ? faltandoValidadas : faltandoOutras).push(...faltando); continue; }
      aplicaveis.push({regra: r, aplicadas: cond.aplicadas});
    }

    const validadas = aplicaveis.filter(a => a.regra.statusValidacao === 'validada' && temLimite(a.regra));
    res.referenciasCandidatas = candidatas.filter(r => !(r.statusValidacao === 'validada' && temLimite(r))).map(regra => ({
      regraId: regra.id, regraVersao: regra.versao, titulo: regra.titulo, statusValidacao: regra.statusValidacao,
      limiteMin: regra.limiteMin ?? null, limiteMax: regra.limiteMax ?? null, fonte: fonteTexto(regra),
      motivo: temLimite(regra) ? 'Referência ainda não conferida no documento original — não usada para concluir.' : 'Regra sem limite definido por fonte técnica.'
    }));

    if (!validadas.length) {
      const dedup = a => [...new Set(a)];
      // Só pede dados quando uma regra VALIDADA passaria a valer com eles.
      if (faltandoValidadas.length) {
        res.pendencias.push(...dedup(faltandoValidadas));
        return semConclusao(STATUS.DADOS_INSUFICIENTES, 'Completar os dados indicados nas pendências e avaliar novamente.');
      }
      res.pendencias.push(...dedup([...divergenteGeral, ...faltandoOutras]));
      res.referenciasCandidatas.forEach(c => res.pendencias.push(`${c.regraId}: ${c.motivo}`));
      if (!res.pendencias.length) res.pendencias.push('Nenhuma referência aplicável às condições informadas.');
      return semConclusao(STATUS.SEM_REFERENCIA, 'Obter uma referência aplicável antes de concluir a avaliação.');
    }

    if (validadas.some(a => !mesmaFaixa(a.regra, validadas[0].regra))) {
      res.pendencias.push(`Referências validadas conflitantes: ${validadas.map(a => a.regra.id).join(', ')}.`);
      return semConclusao(STATUS.SEM_REFERENCIA, 'Revisar o banco de referências: há regras validadas com limites diferentes para a mesma condição.');
    }

    // Cálculo do resultado com a regra aplicável
    const {regra, aplicadas} = validadas[0];
    const v = leitura.valor, min = finito(regra.limiteMin) ? regra.limiteMin : null, max = finito(regra.limiteMax) ? regra.limiteMax : null;
    Object.assign(res, {
      limiteMin: min, limiteMax: max, alvo: finito(regra.alvo) ? regra.alvo : null,
      regraId: regra.id, regraVersao: regra.versao, regraTitulo: regra.titulo,
      fonte: fonteTexto(regra), fontes: (regra.fontes || []).map(f => ({...f})), condicoesAplicadas: aplicadas
    });
    if (min !== null && v < min) { res.status = STATUS.FORA_DO_PADRAO; res.diferenca = arred(v - min); }
    else if (max !== null && v > max) { res.status = STATUS.FORA_DO_PADRAO; res.diferenca = arred(v - max); }
    else {
      const fa = regra.faixaAtencao;
      const atencao = fa && ((finito(fa.min) && v < fa.min) || (finito(fa.max) && v > fa.max));
      res.status = atencao ? STATUS.ATENCAO : STATUS.OK;
      res.diferenca = res.alvo !== null ? arred(v - res.alvo) : 0;
    }
    res.acaoRecomendada = res.status === STATUS.FORA_DO_PADRAO ? (regra.acaoForaDoPadrao || 'Corrigir a regulagem e repetir a medição.')
      : res.status === STATUS.ATENCAO ? (regra.acaoAtencao || 'Acompanhar: valor dentro do limite, porém próximo dele.')
      : 'Nenhuma correção necessária para esta variável.';
    return res;
  }

  /** Cópia imutável do resultado para gravar no registro (o resultado antigo não muda se a regra mudar). */
  function congelar(resultado) {
    const copia = JSON.parse(JSON.stringify(resultado));
    const profundo = o => { Object.values(o).forEach(x => { if (x && typeof x === 'object') profundo(x); }); return Object.freeze(o); };
    return profundo(copia);
  }

  // Ordem de gravidade para resumir várias avaliações
  const GRAVIDADE = [STATUS.FORA_DO_PADRAO, STATUS.DADOS_INSUFICIENTES, STATUS.SEM_REFERENCIA, STATUS.ATENCAO, STATUS.OK];
  function resumir(statuses) {
    if (!statuses.length) return STATUS.DADOS_INSUFICIENTES;
    return GRAVIDADE.find(s => statuses.includes(s));
  }

  // ---------------- Avaliações compostas (fluxos do operador) ----------------

  /**
   * Pulverizador: vazão de cada bico.
   * dados: {vazoes:[L/min], vazaoCatalogo (L/min, modelo exato) | null, pressaoColetaIgualCatalogo, mesmoTempoColeta, pontasMesmoModelo}
   */
  function avaliarBicos(dados, banco, opcoes = {}) {
    const vazoes = dados.vazoes || [];
    if (vazoes.length < 2 || !vazoes.every(v => finito(v) && v > 0)) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informe a vazão (L/min) de pelo menos 2 bicos.'], bicos: []};
    }
    const media = calculos.media(vazoes), cv = calculos.cv(vazoes);
    const base = {equipamentoFamilia: 'pulverizador_barra', produto: dados.produto, destino: dados.destino, etapa: 'afericao', ponto: 'bico', posicao: dados.posicao, unidade: '%'};
    const temCatalogo = finito(dados.vazaoCatalogo) && dados.vazaoCatalogo > 0;
    const bicos = vazoes.map((q, i) => {
      const dm = calculos.desvio(q, media);
      const aMedia = avaliar({...base, variavel: 'desvio_vazao_media', valor: arred(dm, 2), condicoes: {mesmoTempoColeta: dados.mesmoTempoColeta, pontasMesmoModelo: dados.pontasMesmoModelo}}, banco, opcoes);
      let aCat;
      if (temCatalogo) {
        const dc = calculos.desvio(q, dados.vazaoCatalogo);
        aCat = avaliar({...base, variavel: 'desvio_vazao_catalogo', valor: arred(dc, 2), condicoes: {pressaoColetaIgualCatalogo: dados.pressaoColetaIgualCatalogo, vazaoCatalogoInformada: true}}, banco, opcoes);
      } else {
        aCat = {...resultadoBase({unidade: '%'}, banco, opcoes.dataAnalise || new Date().toISOString()), status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Vazão de catálogo do modelo exato da ponta não informada.'], acaoRecomendada: 'Informar a vazão de catálogo da ponta na pressão de coleta.'};
      }
      return {bico: i + 1, vazao: q, desvioMedia: arred(dm, 2), desvioCatalogo: temCatalogo ? arred(calculos.desvio(q, dados.vazaoCatalogo), 2) : null, avaliacaoMedia: aMedia, avaliacaoCatalogo: aCat, status: resumir([aMedia.status, aCat.status])};
    });
    return {status: resumir(bicos.map(b => b.status)), media: arred(media), cv: arred(cv, 2), bicos, pendencias: [...new Set(bicos.flatMap(b => [...b.avaliacaoMedia.pendencias, ...b.avaliacaoCatalogo.pendencias]))]};
  }

  /** Sensor de velocidade ou fluxômetro: leitura do controlador × instrumento de referência. */
  function avaliarSensor(dados, banco, opcoes = {}) {
    if (!finito(dados.leituraControlador) || !finito(dados.referencia) || dados.referencia <= 0) {
      return {...resultadoBase({unidade: '%'}, banco, opcoes.dataAnalise || new Date().toISOString()), status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar a leitura do controlador e o valor do instrumento de referência.']};
    }
    const erro = calculos.desvio(dados.leituraControlador, dados.referencia);
    return avaliar({equipamentoFamilia: dados.equipamentoFamilia || 'pulverizador_barra', produto: dados.produto, destino: dados.destino, etapa: 'afericao', ponto: dados.ponto, posicao: dados.posicao, variavel: 'erro_relativo_instrumento', unidade: '%', valor: arred(erro, 2), condicoes: {comparadoComInstrumentoReferencia: dados.comparadoComInstrumentoReferencia}}, banco, opcoes);
  }

  /** Semeadora de precisão: distribuição longitudinal a partir dos espaçamentos medidos (cm). */
  function avaliarDistribuicaoLongitudinal(dados, banco, opcoes = {}) {
    if (!finito(dados.sementesPorMetro) || dados.sementesPorMetro <= 0 || !Array.isArray(dados.espacamentos) || !dados.espacamentos.length || !dados.espacamentos.every(x => finito(x) && x >= 0)) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar sementes por metro planejadas e os espaçamentos medidos (cm).']};
    }
    const xref = calculos.xref(dados.sementesPorMetro);
    const cls = calculos.classificarEspacamentos(dados.espacamentos, xref);
    const avaliacao = avaliar({equipamentoFamilia: 'semeadora_precisao', produto: dados.produto, destino: dados.destino, etapa: 'afericao', ponto: 'linha_semeadura', posicao: dados.posicao, variavel: 'percentual_espacamentos_aceitaveis', unidade: '%', valor: arred(cls.pctAceitaveis, 2), condicoes: {xrefDefinido: true, minimoEspacamentosMedidos: cls.n}}, banco, opcoes);
    return {status: avaliacao.status, xrefCm: arred(xref, 2), ...cls, avaliacao, pendencias: avaliacao.pendencias};
  }

  /** Colhedora: perdas (massa coletada em gramas na área amostrada). */
  function avaliarPerdas(dados, banco, opcoes = {}) {
    if (!finito(dados.massaG) || dados.massaG < 0 || !finito(dados.areaM2) || dados.areaM2 <= 0) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar a massa coletada (g) e a área amostrada (m²).']};
    }
    const p = calculos.perda(dados.massaG, dados.areaM2);
    const avaliacao = avaliar({equipamentoFamilia: 'colhedora', produto: dados.produto, destino: dados.destino, etapa: 'colheita', ponto: 'atras_colhedora', posicao: dados.posicao, variavel: 'perda_total', unidade: 'sc60/ha', valor: arred(p.sc60Ha, 3), condicoes: {metodo: dados.metodo, incluiGraosEmVagens: dados.incluiGraosEmVagens}}, banco, opcoes);
    return {status: avaliacao.status, kgHa: arred(p.kgHa, 2), sc60Ha: arred(p.sc60Ha, 3), avaliacao, pendencias: avaliacao.pendencias};
  }

  /** Distribuidor a lanço: CV transversal a partir dos valores das bandejas JÁ sobrepostos na largura efetiva. */
  function avaliarDistribuicaoTransversal(dados, banco, opcoes = {}) {
    if (!Array.isArray(dados.valoresSobrepostos) || dados.valoresSobrepostos.length < 3 || !dados.valoresSobrepostos.every(finito)) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar pelo menos 3 valores de bandejas (já com sobreposição das passadas).']};
    }
    const cv = calculos.cv(dados.valoresSobrepostos);
    const avaliacao = avaliar({equipamentoFamilia: 'distribuidor_lanco', produto: dados.produto, destino: dados.destino, etapa: 'afericao', ponto: 'faixa_aplicacao', posicao: dados.posicao, variavel: 'cv_transversal', unidade: '%', valor: arred(cv, 2), condicoes: {fertilizanteNitrogenado: dados.fertilizanteNitrogenado, cvComSobreposicao: dados.cvComSobreposicao}}, banco, opcoes);
    return {status: avaliacao.status, cv: arred(cv, 2), avaliacao, pendencias: avaliacao.pendencias};
  }

  /** Taxa de aplicação do pulverizador: calcula L/ha e o desvio da taxa planejada. */
  function avaliarTaxaAplicacao(dados, banco, opcoes = {}) {
    const {vazaoMediaBico: q, velocidadeKmH: v, espacamentoBicosM: e, taxaPlanejada} = dados;
    if (![q, v, e].every(x => finito(x) && x > 0)) return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar vazão média por bico (L/min), velocidade (km/h) e espaçamento entre bicos (m).']};
    const taxa = calculos.taxaAplicacao(q, v, e);
    if (!finito(taxaPlanejada) || taxaPlanejada <= 0) return {status: STATUS.DADOS_INSUFICIENTES, taxaLHa: arred(taxa, 2), pendencias: ['Informar a taxa planejada (L/ha) para comparar.']};
    const desvio = calculos.desvio(taxa, taxaPlanejada);
    const avaliacao = avaliar({equipamentoFamilia: 'pulverizador_barra', produto: dados.produto, destino: dados.destino, etapa: 'calibracao', ponto: 'barra', posicao: dados.posicao, variavel: 'desvio_taxa_planejada', unidade: '%', valor: arred(desvio, 2), condicoes: {}}, banco, opcoes);
    return {status: avaliacao.status, taxaLHa: arred(taxa, 2), desvio: arred(desvio, 2), vazaoNecessariaBico: arred(calculos.vazaoNecessaria(taxaPlanejada, v, e), 3), avaliacao, pendencias: avaliacao.pendencias};
  }

  /** Dose de adubo/semente coletada (kg) em percurso conhecido. */
  function avaliarDose(dados, banco, opcoes = {}) {
    const {massaKg, distanciaM, larguraM, dosePlanejada, equipamentoFamilia} = dados;
    if (!finito(massaKg) || massaKg < 0 || !finito(distanciaM) || distanciaM <= 0 || !finito(larguraM) || larguraM <= 0) return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar massa coletada (kg), distância percorrida (m) e largura coletada (m).']};
    const dose = calculos.doseKgHa(massaKg, distanciaM, larguraM);
    if (!finito(dosePlanejada) || dosePlanejada <= 0) return {status: STATUS.DADOS_INSUFICIENTES, doseKgHa: arred(dose, 2), pendencias: ['Informar a dose planejada (kg/ha) para comparar.']};
    const desvio = calculos.desvio(dose, dosePlanejada);
    const avaliacao = avaliar({equipamentoFamilia, produto: dados.produto, destino: dados.destino, etapa: 'calibracao', ponto: dados.ponto || 'coleta', posicao: dados.posicao, variavel: 'desvio_dose_planejada', unidade: '%', valor: arred(desvio, 2), condicoes: {}}, banco, opcoes);
    return {status: avaliacao.status, doseKgHa: arred(dose, 2), desvio: arred(desvio, 2), avaliacao, pendencias: avaliacao.pendencias};
  }

  /** Verifica a integridade do banco (campos obrigatórios, validação documentada). Retorna lista de problemas. */
  function auditarBanco(banco) {
    const problemas = [], ids = new Set();
    for (const r of banco.regras || []) {
      if (!r.id) { problemas.push('Regra sem id'); continue; }
      if (ids.has(r.id)) problemas.push(`${r.id}: id duplicado`); ids.add(r.id);
      for (const c of ['versao', 'variavel', 'unidade', 'statusValidacao', ...ESCOPO.map(e => e[0])]) if (vazio(r[c])) problemas.push(`${r.id}: campo "${c}" vazio`);
      if (r.statusValidacao === 'validada') {
        if (!r.validadoPor || !r.dataValidacao) problemas.push(`${r.id}: validada sem validadoPor/dataValidacao`);
        if (!(r.fontes || []).length) problemas.push(`${r.id}: validada sem fonte`);
        if (!temLimite(r)) problemas.push(`${r.id}: validada sem limite`);
      }
      if (finito(r.limiteMin) && finito(r.limiteMax) && r.limiteMin > r.limiteMax) problemas.push(`${r.id}: limiteMin maior que limiteMax`);
    }
    return problemas;
  }

  return {STATUS, calculos, avaliar, congelar, resumir, avaliarBicos, avaliarSensor, avaliarDistribuicaoLongitudinal, avaliarPerdas, avaliarDistribuicaoTransversal, avaliarTaxaAplicacao, avaliarDose, auditarBanco};
}));
