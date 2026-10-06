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
    /** F-QUEBRA-UMIDADE: massa final após secar de ui% para uf% (base úmida) */
    massaAposSecagem(massaInicial, ui, uf) {
      exigirPositivo(massaInicial, 'massa inicial'); exigirNumero(ui, 'umidade inicial'); exigirNumero(uf, 'umidade final');
      if (ui < 0 || ui >= 100 || uf < 0 || uf >= 100) throw new Error('umidade deve estar entre 0 e 100%');
      return massaInicial * (100 - ui) / (100 - uf);
    },
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
        case 'entre': ok = finito(v) && v >= c.valor[0] && v <= c.valor[1]; break;
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
    const aplicaveis = [], faltandoValidadas = [], faltandoOutras = [], divergenteGeral = [], compativeis = [];
    for (const r of candidatas) {
      const esc = verificarEscopo(r, leitura);
      if (esc.divergente.length) { divergenteGeral.push(...esc.divergente); continue; }
      const cond = verificarCondicoes(r, leitura.condicoes);
      if (cond.divergente.length) { divergenteGeral.push(...cond.divergente); continue; }
      compativeis.push(r);
      const faltando = [...esc.faltando, ...cond.faltando];
      if (faltando.length) { (r.statusValidacao === 'validada' && temLimite(r) ? faltandoValidadas : faltandoOutras).push(...faltando); continue; }
      aplicaveis.push({regra: r, aplicadas: cond.aplicadas});
    }

    const validadas = aplicaveis.filter(a => a.regra.statusValidacao === 'validada' && temLimite(a.regra));
    // Só as regras compatíveis com a condição informada (escopo e condições), mas sem validação ou sem limite
    res.referenciasCandidatas = compativeis.filter(r => !(r.statusValidacao === 'validada' && temLimite(r))).map(regra => ({
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
    // limites exclusivos: "abaixo de 14%" → 14,0 já está fora
    const abaixo = min !== null && (regra.limiteMinExclusivo ? v <= min : v < min);
    const acima = max !== null && (regra.limiteMaxExclusivo ? v >= max : v > max);
    res.limiteMinExclusivo = !!regra.limiteMinExclusivo; res.limiteMaxExclusivo = !!regra.limiteMaxExclusivo;
    if (abaixo) { res.status = STATUS.FORA_DO_PADRAO; res.diferenca = arred(v - min); }
    else if (acima) { res.status = STATUS.FORA_DO_PADRAO; res.diferenca = arred(v - max); }
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
      // A comparação com a tabela do fabricante é o critério principal; a média só pesa quando a regra dela concluir.
      const conclusivos = [STATUS.OK, STATUS.ATENCAO, STATUS.FORA_DO_PADRAO];
      const status = resumir([aCat.status, ...(conclusivos.includes(aMedia.status) ? [aMedia.status] : [])]);
      return {bico: i + 1, vazao: q, desvioMedia: arred(dm, 2), desvioCatalogo: temCatalogo ? arred(calculos.desvio(q, dados.vazaoCatalogo), 2) : null, avaliacaoMedia: aMedia, avaliacaoCatalogo: aCat, status};
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

  /**
   * Colhedora: perdas. Uma massa (g) por ponto de coleta, todos com a mesma área amostral.
   * dados: {massasG:[g], areaM2, massasPlataformaG?:[g], produto, incluiGraosEmVagens}
   * Avalia a média da perda total (PTT); se houver coletas na plataforma (PPC), calcula PMI = PTT − PPC.
   */
  function avaliarPerdas(dados, banco, opcoes = {}) {
    const ms = dados.massasG;
    if (!Array.isArray(ms) || !ms.length || !ms.every(m => finito(m) && m >= 0) || !finito(dados.areaM2) || dados.areaM2 <= 0) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar a massa coletada (g) em cada ponto e a área amostral (m²).']};
    }
    const pontos = ms.map(m => calculos.perda(m, dados.areaM2).kgHa);
    const ptt = calculos.media(pontos);
    let ppc = null, pmi = null;
    const mp = dados.massasPlataformaG;
    if (Array.isArray(mp) && mp.length && mp.every(m => finito(m) && m >= 0)) {
      ppc = calculos.media(mp.map(m => calculos.perda(m, dados.areaM2).kgHa)); pmi = ptt - ppc;
    }
    const pendExtra = [];
    // PMI = PTT − PPC só faz sentido se a perda da plataforma não superar a perda total
    if (pmi != null && pmi < 0) { pmi = null; pendExtra.push('Perda na plataforma maior que a perda total: conferir as coletas (PMI não calculada).'); }
    const avaliacao = avaliar({equipamentoFamilia: 'colhedora', produto: dados.produto, destino: dados.destino, etapa: 'colheita', ponto: 'atras_colhedora', posicao: dados.posicao, variavel: 'perda_total', unidade: 'kg/ha', valor: arred(ptt, 2), condicoes: {areaAmostralM2: dados.areaM2, numeroPontos: ms.length, incluiGraosEmVagens: dados.incluiGraosEmVagens}}, banco, opcoes);
    return {status: avaliacao.status, pttKgHa: arred(ptt, 2), pttSc60Ha: arred(ptt / 60, 3), pontosKgHa: pontos.map(v => arred(v, 2)), ppcKgHa: arred(ppc, 2), pmiKgHa: arred(pmi, 2), avaliacao, pendencias: [...avaliacao.pendencias, ...pendExtra]};
  }

  /** Distribuidor a lanço: CV transversal a partir dos valores das bandejas JÁ sobrepostos na largura efetiva. */
  function avaliarDistribuicaoTransversal(dados, banco, opcoes = {}) {
    const vs = dados.valoresSobrepostos;
    if (!Array.isArray(vs) || vs.length < 3 || !vs.every(x => finito(x) && x >= 0) || !vs.some(x => x > 0)) {
      return {status: STATUS.DADOS_INSUFICIENTES, pendencias: ['Informar pelo menos 3 valores de bandejas (já com sobreposição das passadas), sem valores negativos e com alguma massa coletada.']};
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
        if (!(r.fontes || []).some(f => f.conferido === true && f.trechoLiteral)) problemas.push(`${r.id}: validada sem fonte conferida (trechoLiteral)`);
        if (!temLimite(r)) problemas.push(`${r.id}: validada sem limite`);
      }
      for (const [c] of ESCOPO) if (Array.isArray(r[c]) && r[c].includes('*')) problemas.push(`${r.id}: "*" dentro de lista em "${c}" (use "*" sem lista)`);
      if (finito(r.limiteMin) && finito(r.limiteMax) && r.limiteMin > r.limiteMax) problemas.push(`${r.id}: limiteMin maior que limiteMax`);
    }
    for (const t of banco.tabelasClassificacao || []) {
      if (!t.id) { problemas.push('Tabela de classificação sem id'); continue; }
      if (ids.has(t.id)) problemas.push(`${t.id}: id duplicado`); ids.add(t.id);
      if (t.statusValidacao === 'validada' && !(t.fontes || []).some(f => f.conferido === true && f.trechoLiteral)) problemas.push(`${t.id}: validada sem fonte conferida (trechoLiteral)`);
      if (!finito(t.casasDecimais)) problemas.push(`${t.id}: casasDecimais ausente`);
      for (const tp of t.tipos || []) for (const d of t.defeitos || []) if (!finito(tp.limites?.[d.id])) problemas.push(`${t.id}: ${tp.tipo} sem limite para "${d.id}"`);
      for (let i = 1; i < (t.tipos || []).length; i++) for (const d of t.defeitos || []) if (t.tipos[i].limites?.[d.id] < t.tipos[i - 1].limites?.[d.id]) problemas.push(`${t.id}: limite de "${d.id}" diminui de ${t.tipos[i - 1].tipo} para ${t.tipos[i].tipo}`);
    }
    return problemas;
  }


  // ---------------- Classificação de grãos (enquadramento em tipo) ----------------
  // Arredonda como a norma manda expressar o resultado (IN 11: 1 casa; IN 60: 2 casas).
  const arredNorma = (v, casas) => Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas;
  const pct = (v, casas) => `${v.toFixed(casas).replace('.', ',')}%`;

  /**
   * Enquadra a amostra em tipo pela tabela oficial (pior tipo entre os defeitos — IN 11, Art. 27).
   * dados: {produto, destino, etapa, grupo ('I'|'II' para soja), valores:{defeitoId: %}}
   * Sem tabela validada e aplicável → SEM_REFERENCIA; faltando defeito → DADOS_INSUFICIENTES.
   */
  function classificarGraos(dados, banco, opcoes = {}) {
    const res = {status: null, enquadramento: null, tabelaId: '', tabelaVersao: '', titulo: '', grupo: dados.grupo || null,
      defeitos: [], motivos: [], consequencias: [], pendencias: [], fontes: [], casasDecimais: null,
      bancoVersao: banco.versaoBanco || '', dataAnalise: opcoes.dataAnalise || new Date().toISOString()};
    const fim = (status, pend) => { res.status = status; if (pend) res.pendencias.push(pend); return res; };
    const tabs = (banco.tabelasClassificacao || []).filter(t => t.produto === dados.produto && t.statusValidacao !== 'suspensa');
    if (!tabs.length) return fim(STATUS.SEM_REFERENCIA, `Nenhuma tabela oficial de classificação cadastrada para "${dados.produto || 'produto não informado'}".`);
    if (vazio(dados.destino) || vazio(dados.etapa)) return fim(STATUS.DADOS_INSUFICIENTES, `Informe ${vazio(dados.destino) ? 'o destino' : 'a etapa'} do produto: a tabela oficial depende dele.`);
    const noEscopo = tabs.filter(t => (t.destino === '*' || lista(t.destino).includes(dados.destino)) && (t.etapa === '*' || lista(t.etapa).includes(dados.etapa)));
    if (!noEscopo.length) return fim(STATUS.SEM_REFERENCIA, `A classificação oficial cadastrada vale para ${lista(tabs[0].destino).join(', ')} na etapa ${lista(tabs[0].etapa).join(', ')}.`);
    let tab = noEscopo.length === 1 && !noEscopo[0].grupo ? noEscopo[0] : null;
    if (!tab && noEscopo.some(t => !t.grupo)) return fim(STATUS.SEM_REFERENCIA, `Mais de uma tabela de classificação aplicável (${noEscopo.map(t => t.id).join(', ')}): revisar o banco de referências.`);
    if (!tab) {
      if (vazio(dados.grupo)) return fim(STATUS.DADOS_INSUFICIENTES, `Informe o grupo: ${noEscopo.map(t => t.grupo?.rotulo).filter(Boolean).join(' ou ')} (responsabilidade do interessado).`);
      tab = noEscopo.find(t => t.grupo?.valor === dados.grupo);
      if (!tab) return fim(STATUS.SEM_REFERENCIA, `Grupo "${dados.grupo}" sem tabela cadastrada.`);
    }
    Object.assign(res, {tabelaId: tab.id, tabelaVersao: tab.versao, titulo: tab.titulo, casasDecimais: tab.casasDecimais,
      fontes: (tab.fontes || []).map(f => ({...f})), grupoRotulo: tab.grupo?.rotulo || null});
    if (tab.statusValidacao !== 'validada') return fim(STATUS.SEM_REFERENCIA, `Tabela ${tab.id} ainda não conferida no documento oficial.`);

    const v = {}, faltando = [];
    for (const d of tab.defeitos) {
      const bruto = (dados.valores || {})[d.id];
      if (!finito(bruto)) { faltando.push(d.rotulo); continue; }
      if (bruto < 0 || bruto > 100) return fim(STATUS.DADOS_INSUFICIENTES, `${d.rotulo}: percentual inválido (${bruto}).`);
      v[d.id] = arredNorma(bruto, tab.casasDecimais);
    }
    // Partes não podem superar o total que as contém
    const parte = (a, b) => finito(v[a]) && finito(v[b]) && v[a] > v[b];
    const rot = id => tab.defeitos.find(d => d.id === id)?.rotulo || id;
    const incoerentes = [['queimados', 'ardidos_queimados'], ['ardidos', 'avariados_total'], ['ardidos_queimados', 'avariados_total'], ['mofados', 'avariados_total']]
      .filter(([a, b]) => parte(a, b)).map(([a, b]) => `${rot(a)} (${pct(v[a], tab.casasDecimais)}) maior que ${rot(b)} (${pct(v[b], tab.casasDecimais)}), que o inclui.`);
    if (finito(v.ardidos_queimados) && finito(v.mofados) && finito(v.avariados_total) && arredNorma(v.ardidos_queimados + v.mofados, tab.casasDecimais) > v.avariados_total)
      incoerentes.push(`Ardidos e queimados + mofados (${pct(v.ardidos_queimados + v.mofados, tab.casasDecimais)}) maior que o total de avariados (${pct(v.avariados_total, tab.casasDecimais)}).`);
    if (incoerentes.length) { res.pendencias.push(...incoerentes); return fim(STATUS.DADOS_INSUFICIENTES, 'Corrigir os valores: um defeito parcial não pode ser maior que o total que o contém.'); }

    // Por defeito: melhor tipo cujo limite máximo comporta o valor (limites inclusivos: "limites máximos de tolerância")
    let pior = -1;
    for (const d of tab.defeitos) {
      if (!finito(v[d.id])) continue;
      const idx = tab.tipos.findIndex(t => v[d.id] <= t.limites[d.id]);
      const nivel = idx === -1 ? tab.tipos.length : idx;
      pior = Math.max(pior, nivel);
      res.defeitos.push({id: d.id, rotulo: d.rotulo, valor: v[d.id], valorInformado: dados.valores[d.id],
        tipo: idx === -1 ? tab.foraDeTipo : tab.tipos[idx].tipo, limiteUltimoTipo: tab.tipos[tab.tipos.length - 1].limites[d.id]});
    }
    // Desclassificação pelos percentuais (vale mesmo com outros defeitos ainda não informados)
    for (const dc of tab.desclassificacao || []) {
      if (!dc.soma.every(id => finito(v[id]))) continue;
      const total = arredNorma(dc.soma.reduce((s, id) => s + v[id], 0), tab.casasDecimais);
      if (total > dc.limiteMaxExclusivo) res.motivos.push(`${dc.rotulo}: ${pct(total, tab.casasDecimais)} — ${dc.artigo}.`);
    }
    if (res.motivos.length) {
      res.enquadramento = 'Desclassificado';
      res.consequencias.push('Comercialização proibida; a entidade classificadora comunica a Superintendência Federal de Agricultura (SFA) da UF.');
      return fim(STATUS.FORA_DO_PADRAO);
    }
    if (faltando.length) {
      res.enquadramento = null;
      if (pior >= 0) res.pendencias.push(`Pelos defeitos informados, o melhor enquadramento possível é ${pior < tab.tipos.length ? tab.tipos[pior].tipo : tab.foraDeTipo}.`);
      return fim(STATUS.DADOS_INSUFICIENTES, `Para enquadrar em tipo, informe também: ${faltando.join(', ')}.`);
    }
    if (pior < tab.tipos.length) { res.enquadramento = tab.tipos[pior].tipo; return fim(STATUS.OK); }
    res.enquadramento = tab.foraDeTipo;
    const acima = res.defeitos.filter(d => d.tipo === tab.foraDeTipo);
    res.motivos.push(...acima.map(d => `${d.rotulo}: ${pct(d.valor, tab.casasDecimais)} (máximo ${pct(d.limiteUltimoTipo, tab.casasDecimais)} para ${tab.tipos[tab.tipos.length - 1].tipo}).`));
    for (const c of Object.values(tab.consequencias || {})) if (acima.some(d => c.defeitos.includes(d.id))) res.consequencias.push(c.texto);
    return fim(STATUS.FORA_DO_PADRAO);
  }

  /**
   * Secador, moega e armazém: avalia cada leitura separadamente, sempre com o ponto de medição informado.
   * dados: {equipamentoFamilia, produto, destino, etapa, condicoes:{...},
   *         leituras:[{ponto, posicao, variavel:'temperatura'|'umidade_graos'|'umidade_relativa_ar'
   *                    |'graos_avariados'|'graos_quebrados_amassados'|'impurezas_materias_estranhas', valor}],
   *         umidadeInicial, umidadeFinal, umidadeMeta, massaInicial,
   *         classificacao:{grupo, valores:{defeitoId: %}} (moega, opcional)}
   */
  function avaliarSecagem(dados, banco, opcoes = {}) {
    const UN = {temperatura: '°C', umidade_graos: '%', umidade_relativa_ar: '%',
      graos_avariados: '%', graos_quebrados_amassados: '%', impurezas_materias_estranhas: '%'}; // classificação na moega (amostra)
    const leituras = (dados.leituras || []).filter(l => finito(l.valor));
    const avaliacoes = leituras.map(l => ({...l, avaliacao: avaliar({equipamentoFamilia: dados.equipamentoFamilia, produto: dados.produto, destino: dados.destino,
      etapa: dados.etapa, ponto: l.ponto, posicao: l.posicao, variavel: l.variavel, unidade: UN[l.variavel], valor: l.valor, condicoes: dados.condicoes || {}}, banco, opcoes)}));
    const calc = {};
    const {umidadeInicial: ui, umidadeFinal: uf, umidadeMeta: um, massaInicial: mi} = dados;
    if (finito(ui) && finito(uf)) calc.reducaoUmidadePP = arred(ui - uf, 2);
    if (finito(uf) && finito(um)) calc.diferencaMetaPP = arred(uf - um, 2);
    const pend = [];
    if (finito(mi) && mi > 0 && finito(ui) && finito(uf)) {
      if (ui < 0 || ui >= 100 || uf < 0 || uf >= 100) pend.push('Umidades devem estar entre 0 e 100% para estimar a massa final.');
      else if (uf > ui) pend.push('Umidade final maior que a inicial: quebra de massa pela secagem não calculada.');
      else {
        calc.massaFinalEstimada = arred(calculos.massaAposSecagem(mi, ui, uf), 3);
        calc.quebraMassa = arred(mi - calc.massaFinalEstimada, 3);
        calc.quebraPct = arred((mi - calc.massaFinalEstimada) / mi * 100, 2);
      }
    }
    // Classificação na moega: só quando algum defeito foi informado
    const cl = dados.classificacao && Object.values(dados.classificacao.valores || {}).some(finito)
      ? classificarGraos({produto: dados.produto, destino: dados.destino, etapa: dados.etapa, grupo: dados.classificacao.grupo, valores: dados.classificacao.valores}, banco, opcoes) : null;
    if (!leituras.length && !cl) pend.push('Nenhuma leitura informada.');
    avaliacoes.forEach(a => a.avaliacao.pendencias.forEach(x => pend.push(`[${a.variavel} — ${a.ponto || 'ponto não informado'}] ${x}`)));
    if (cl) cl.pendencias.forEach(x => pend.push(`Classificação: ${x}`));
    const statuses = [...avaliacoes.map(a => a.avaliacao.status), ...(cl ? [cl.status] : [])];
    const r = {status: statuses.length ? resumir(statuses) : STATUS.DADOS_INSUFICIENTES, leituras: avaliacoes, calculos: calc, pendencias: [...new Set(pend)]};
    if (cl) r.classificacao = cl;
    return r;
  }

  /**
   * Descontos de uma carga na moega (conferência do romaneio). Nenhum padrão é assumido:
   * umidade e impureza padrão vêm do contrato ou da tabela do comprador. Quando o percentual da
   * tabela do comprador é informado, ele é usado; senão aplica-se o balanço de massa:
   *   impureza  → peso limpo   = peso × (100 − I) ÷ (100 − Ipadrão)   (F-DESC-IMPUREZA)
   *   umidade   → peso seco    = peso × (100 − U) ÷ (100 − Upadrão)   (F-DESC-UMIDADE)
   * Ordem: impureza sobre o peso líquido; umidade sobre o peso já sem o excesso de impureza;
   * outros descontos (%) sobre o peso resultante. Abaixo do padrão não há desconto (nem acréscimo).
   * dados: {pesoLiquido kg, impureza, impurezaPadrao, umidade, umidadePadrao, descImpurezaPct, descUmidadePct, outrosPct, pesoRomaneio}
   */
  function descontosCarga(dados) {
    const d = dados || {}, pend = [], linhas = [];
    const P = d.pesoLiquido;
    if (!(finito(P) && P > 0)) return {status: STATUS.DADOS_INSUFICIENTES, linhas, pendencias: ['Informe o peso líquido da carga (kg).']};
    const pctValido = v => finito(v) && v >= 0 && v < 100;
    let peso = P;
    const aplicar = (id, rotulo, valor, padrao, tabela, formula) => {
      if (finito(tabela)) {
        if (!pctValido(tabela)) { pend.push(`${rotulo}: percentual da tabela do comprador inválido.`); return; }
        const kg = peso * tabela / 100;
        linhas.push({id, rotulo, metodo: 'tabela_comprador', percentual: arred(tabela, 4), base: arred(peso, 3), descontoKg: arred(kg, 3)}); peso -= kg; return;
      }
      if (!finito(valor) && !finito(padrao)) return;
      if (!finito(valor)) { pend.push(`${rotulo}: informe o valor medido na amostra.`); return; }
      if (!finito(padrao)) { pend.push(`${rotulo}: informe o padrão do contrato ou o percentual da tabela do comprador.`); return; }
      if (!pctValido(valor) || !pctValido(padrao)) { pend.push(`${rotulo}: percentuais devem estar entre 0 e 100.`); return; }
      const fim = valor > padrao ? peso * (100 - valor) / (100 - padrao) : peso, kg = peso - fim;
      linhas.push({id, rotulo, metodo: 'balanco_massa', formula, medido: valor, padrao, percentual: arred(kg / peso * 100, 4), base: arred(peso, 3), descontoKg: arred(kg, 3)}); peso = fim;
    };
    aplicar('impureza', 'Impureza e matérias estranhas', d.impureza, d.impurezaPadrao, d.descImpurezaPct, 'F-DESC-IMPUREZA');
    aplicar('umidade', 'Umidade', d.umidade, d.umidadePadrao, d.descUmidadePct, 'F-DESC-UMIDADE');
    if (finito(d.outrosPct)) {
      if (pctValido(d.outrosPct)) { const kg = peso * d.outrosPct / 100; linhas.push({id: 'outros', rotulo: 'Outros descontos do comprador', metodo: 'tabela_comprador', percentual: arred(d.outrosPct, 4), base: arred(peso, 3), descontoKg: arred(kg, 3)}); peso -= kg; }
      else pend.push('Outros descontos: percentual inválido.');
    }
    const total = P - peso;
    const r = {status: pend.length ? STATUS.DADOS_INSUFICIENTES : STATUS.OK, pesoLiquido: P, linhas, descontoTotalKg: arred(total, 3), descontoTotalPct: arred(total / P * 100, 4),
      pesoFinalKg: arred(peso, 3), sacas60: arred(peso / 60, 3), pendencias: pend};
    if (finito(d.pesoRomaneio) && d.pesoRomaneio > 0) r.diferencaRomaneioKg = arred(d.pesoRomaneio - peso, 3);
    if (!linhas.length && !pend.length) r.pendencias.push('Nenhum desconto informado: preencha o padrão do contrato ou o percentual da tabela do comprador.');
    return r;
  }

  return {STATUS, calculos, avaliar, congelar, resumir, avaliarSecagem, descontosCarga, classificarGraos, avaliarBicos, avaliarSensor, avaliarDistribuicaoLongitudinal, avaliarPerdas, avaliarDistribuicaoTransversal, avaliarTaxaAplicacao, avaliarDose, auditarBanco};
}));
