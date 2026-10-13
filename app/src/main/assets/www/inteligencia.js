'use strict';
/* Nexus Agro — inteligência da aferição e calibragem (offline, sem internet e sem serviços externos).
   A partir das medições, explica a causa provável, calcula quanto ajustar e prevê o desgaste das pontas.
   Tudo aqui é ORIENTAÇÃO: não muda o resultado oficial, que continua vindo só das referências validadas
   (avaliador.js). Cálculos de ajuste usam relações físicas conhecidas (ex.: vazão do bico ∝ √pressão) e
   sempre pedem uma nova medição para confirmar. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexusInteligencia = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const finito = v => typeof v === 'number' && Number.isFinite(v);
  const arred = (v, c = 2) => finito(v) ? Math.round(v * 10 ** c) / 10 ** c : null;
  const media = vs => vs.reduce((s, v) => s + v, 0) / vs.length;
  const desvio = (v, ref) => (v - ref) / ref * 100;
  const fmt = (v, c = 1) => finito(v) ? (Math.round(v * 10 ** c) / 10 ** c).toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: c}) : '—';
  const sinal = (v, c = 1) => (v > 0 ? '+' : '') + fmt(v, c) + '%';
  const listaBicos = ns => {
    // 1, 2, 3, 7 → "1 a 3 e 7"
    const s = [...ns].sort((a, b) => a - b), partes = [];
    for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; if (j - i >= 2) { partes.push(`${s[i]} a ${s[j]}`); i = j; } else partes.push(`${s[i]}`); }
    return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1] : partes[0] || '';
  };
  const item = (nivel, titulo, texto) => ({nivel, titulo, texto}); // nivel: ok | info | atencao | alerta

  // ---------- Bicos: ponta nova como referência ----------
  /** Compara cada bico com a vazão medida numa ponta nova do mesmo modelo (critério prático de campo, ±limite %). */
  function bicosPontaNova({vazoes, vazaoPontaNova, mesmaCondicao, limite = 10}) {
    if (!Array.isArray(vazoes) || vazoes.length < 2 || !vazoes.every(v => finito(v) && v >= 0) || !vazoes.some(v => v > 0))
      return {status: 'DADOS_INSUFICIENTES', referencia: 'ponta_nova', bicos: [], pendencias: ['Informe a vazão (L/min) de pelo menos 2 bicos.']};
    if (!finito(vazaoPontaNova) || vazaoPontaNova <= 0)
      return {status: 'DADOS_INSUFICIENTES', referencia: 'ponta_nova', bicos: [], pendencias: ['Informe a vazão medida na ponta nova.']};
    if (mesmaCondicao !== true)
      return {status: 'DADOS_INSUFICIENTES', referencia: 'ponta_nova', bicos: [], pendencias: ['A ponta nova precisa ser medida na mesma pressão e no mesmo tempo de coleta dos outros bicos (responda “Sim”).']};
    const m = media(vazoes), dp = Math.sqrt(vazoes.reduce((s, v) => s + (v - m) ** 2, 0) / (vazoes.length - 1));
    const bicos = vazoes.map((q, i) => {
      const d = arred(desvio(q, vazaoPontaNova), 2);
      return {bico: i + 1, vazao: q, desvioRef: d, desvioCatalogo: d, desvioMedia: arred(desvio(q, m), 2), status: d < -limite || d > limite ? 'FORA_DO_PADRAO' : 'OK'};
    });
    const fora = bicos.filter(b => b.status === 'FORA_DO_PADRAO').length;
    return {status: fora ? 'FORA_DO_PADRAO' : 'OK', referencia: 'ponta_nova', criterio: `±${limite}% da vazão da ponta nova (critério prático de campo)`, limite,
      vazaoReferencia: vazaoPontaNova, media: arred(m, 4), cv: m > 0 ? arred(dp / m * 100, 2) : null, bicos, pendencias: []};
  }

  // ---------- Diagnóstico dos bicos ----------
  /** bicos: [{bico, vazao, desvio}] (desvio em % da referência: tabela ou ponta nova). */
  function diagnosticoBicos({bicos, cv, limiteMin = -10, limiteMax = 10, referencia = 'tabela'}) {
    const out = [];
    const bs = (bicos || []).filter(b => finito(b.desvio));
    if (!bs.length) {
      if (finito(cv) && cv > 10) out.push(item('atencao', 'Vazões muito diferentes entre si', `O CV entre os bicos é ${fmt(cv)}%. Sem a vazão de referência não dá para saber quais estão gastos; informe a tabela do fabricante ou meça uma ponta nova.`));
      return out;
    }
    const n = bs.length, ref = referencia === 'ponta_nova' ? 'da ponta nova' : 'da tabela';
    const entupidos = bs.filter(b => b.vazao === 0 || b.desvio <= -20).map(b => b.bico);
    const baixos = bs.filter(b => b.desvio < limiteMin && b.desvio > -20 && b.vazao > 0).map(b => b.bico);
    const gastos = bs.filter(b => b.desvio > limiteMax).map(b => b.bico);
    const dm = media(bs.map(b => b.desvio));
    // Trechos seguidos de bicos abaixo: problema na linha daquele pedaço da barra, não nas pontas
    const abaixo = new Set(bs.filter(b => b.desvio < limiteMin).map(b => b.bico)), trechos = [];
    for (let i = 1; i <= Math.max(...bs.map(b => b.bico)); i++) {
      if (!abaixo.has(i)) continue; let j = i; while (abaixo.has(j + 1)) j++;
      if (j - i + 1 >= 3) trechos.push([i, j]); i = j;
    }
    const noTrecho = new Set(trechos.flatMap(([a, z]) => Array.from({length: z - a + 1}, (_, k) => a + k)));
    trechos.forEach(([a, z]) => out.push(item('alerta', `Trecho da barra com vazão baixa (bicos ${a} a ${z})`,
      `${z - a + 1} bicos seguidos abaixo da referência: o problema provável está na alimentação desse trecho, não nas pontas. Confira o filtro de linha, mangueira dobrada ou furada e a válvula da seção antes de trocar pontas.`)));
    const entSoltos = entupidos.filter(b => !noTrecho.has(b)), baixosSoltos = baixos.filter(b => !noTrecho.has(b));
    if (entSoltos.length) out.push(item('alerta', `${entSoltos.length === 1 ? 'Bico' : 'Bicos'} ${listaBicos(entSoltos)}: provável entupimento`,
      'Vazão muito abaixo da referência. Limpe a ponta e o filtro do bico (escova macia, nunca arame) e meça de novo; só troque se continuar baixo.'));
    if (baixosSoltos.length) out.push(item('atencao', `${baixosSoltos.length === 1 ? 'Bico' : 'Bicos'} ${listaBicos(baixosSoltos)}: vazão abaixo`,
      'Sujeira parcial na ponta ou no filtro, ou ponta danificada (orifício amassado). Limpe e meça de novo.'));
    if (gastos.length) {
      const jogo = gastos.length >= Math.max(3, Math.ceil(n / 3));
      out.push(item('alerta', `${gastos.length === 1 ? 'Bico' : 'Bicos'} ${listaBicos(gastos)}: ponta gasta`,
        jogo ? `${gastos.length} de ${n} bicos passaram de ${sinal(limiteMax, 0)} ${ref}. Com tantos fora, o recomendado é trocar o jogo completo de pontas (pontas novas e velhas juntas deixam a aplicação desigual).`
          : `Passou de ${sinal(limiteMax, 0)} ${ref}: o orifício alargou com o uso. Troque ${gastos.length === 1 ? 'esta ponta' : 'estas pontas'} por novas do mesmo modelo.`));
    }
    // Barra inteira deslocada para o mesmo lado
    const acima = bs.filter(b => b.desvio > 0).length / n, abaixoPct = bs.filter(b => b.desvio < 0).length / n;
    if (dm > 5 && acima >= 0.7) out.push(item('atencao', `A barra toda está acima da referência (média ${sinal(dm)})`,
      `Desgaste geral do jogo de pontas ou pressão real maior que a informada. Confira o manômetro (compare com um manômetro aferido na saída de um bico)${referencia === 'tabela' ? ' e se a pressão usada é a mesma da tabela' : ''}.`));
    else if (dm < -5 && abaixoPct >= 0.7 && !trechos.length) out.push(item('atencao', `A barra toda está abaixo da referência (média ${sinal(dm)})`,
      'Pressão real menor que a informada (manômetro descalibrado ou perda de carga), filtro principal ou de sucção sujo, ou pontas de tamanho diferente do informado.'));
    if (finito(cv) && cv > 10 && !gastos.length && !entupidos.length && !trechos.length)
      out.push(item('atencao', `Vazões desiguais entre os bicos (CV ${fmt(cv)}%)`, 'Possível mistura de pontas de modelos ou idades diferentes. Confira se todas são do mesmo modelo e tamanho.'));
    if (!out.length) {
      const pior = bs.reduce((a, b) => Math.abs(b.desvio) > Math.abs(a.desvio) ? b : a);
      out.push(item('ok', 'Pontas em bom estado', `Todos os bicos dentro da faixa. O mais desviado é o bico ${pior.bico} (${sinal(pior.desvio)} ${ref}). Média da barra: ${sinal(dm)}.`));
    }
    return out;
  }

  // ---------- Taxa de aplicação: quanto ajustar ----------
  /** isoClasses: [{tamanho:'03', cor:'azul', vazao:1.18}] (L/min a 3 bar) para sugerir ponta quando a pressão não resolve. */
  function ajusteTaxa({taxaLHa, taxaPlanejada, vazaoMediaBico, velocidadeKmH, espacamentoBicosM, pressaoBar, faixaPressao, faixaVelocidade, isoClasses}) {
    const out = [];
    if (![taxaLHa, taxaPlanejada, vazaoMediaBico, velocidadeKmH, espacamentoBicosM].every(v => finito(v) && v > 0)) return out;
    const d = desvio(taxaLHa, taxaPlanejada);
    if (Math.abs(d) <= 5) { out.push(item('ok', 'Taxa dentro do planejado', `Aplicando ${fmt(taxaLHa)} L/ha para ${fmt(taxaPlanejada)} planejados (${sinal(d)}). Nada a ajustar.`)); return out; }
    const r = taxaPlanejada / taxaLHa; // fator que a taxa precisa mudar
    const qAlvo = vazaoMediaBico * r;
    out.push(item(Math.abs(d) > 10 ? 'alerta' : 'atencao', `Aplicando ${sinal(d)} do planejado`, `${fmt(taxaLHa)} L/ha medidos para ${fmt(taxaPlanejada)} L/ha planejados. Para acertar, cada bico precisa soltar ${fmt(qAlvo, 3)} L/min (hoje: ${fmt(vazaoMediaBico, 3)}). Escolha uma das opções abaixo e meça de novo.`));
    // Opção 1: velocidade (a taxa é inversamente proporcional à velocidade)
    const vAlvo = velocidadeKmH / r;
    const vFora = faixaVelocidade && finito(faixaVelocidade[0]) && finito(faixaVelocidade[1]) && (vAlvo < faixaVelocidade[0] || vAlvo > faixaVelocidade[1]);
    out.push(item(vFora ? 'info' : 'ok', `Opção: ajustar a velocidade para ${fmt(vAlvo)} km/h`, `Mantendo pontas e pressão, ${vAlvo < velocidadeKmH ? 'reduza' : 'aumente'} de ${fmt(velocidadeKmH)} para ${fmt(vAlvo)} km/h.${vFora ? ` Fica fora da velocidade de trabalho da máquina (${fmt(faixaVelocidade[0])} a ${fmt(faixaVelocidade[1])} km/h): prefira outra opção.` : ''}`));
    // Opção 2: pressão (vazão ∝ √pressão)
    if (finito(pressaoBar) && pressaoBar > 0) {
      const pAlvo = pressaoBar * r * r;
      const faixa = faixaPressao && finito(faixaPressao[0]) && finito(faixaPressao[1]) ? faixaPressao : null;
      const pFora = faixa ? pAlvo < faixa[0] || pAlvo > faixa[1] : pAlvo < 1 || pAlvo > 6;
      const grande = r * r > 1.6 || r * r < 0.6;
      out.push(item(pFora || grande ? 'info' : 'ok', `Opção: ajustar a pressão para cerca de ${fmt(pAlvo)} bar`,
        `Estimativa pela lei dos bicos (a vazão varia com a raiz da pressão): de ${fmt(pressaoBar)} para ${fmt(pAlvo)} bar.${pFora ? ` Fica fora da faixa ${faixa ? `do comando (${fmt(faixa[0])} a ${fmt(faixa[1])} bar)` : 'usual das pontas (1 a 6 bar)'}.` : ''}${grande ? ' Mudança grande de pressão altera o tamanho das gotas e a deriva: melhor trocar a ponta.' : ''}`));
    }
    // Opção 3: outra ponta (classe ISO que dá a vazão entre 2 e 4 bar)
    if (Array.isArray(isoClasses) && isoClasses.length) {
      const cand = isoClasses.filter(c => finito(c.vazao) && c.vazao > 0).map(c => ({...c, p: 3 * (qAlvo / c.vazao) ** 2})).filter(c => c.p >= 1.5 && c.p <= 5)
        .sort((a, b) => Math.abs(a.p - 3) - Math.abs(b.p - 3)).slice(0, 2);
      if (cand.length) out.push(item('info', 'Opção: trocar a ponta', `Para ${fmt(qAlvo, 3)} L/min por bico: ${cand.map(c => `ponta ${c.tamanho}${c.cor ? ` (${c.cor})` : ''} a cerca de ${fmt(c.p)} bar`).join(' ou ')}. Confirme a vazão na tabela do fabricante do modelo escolhido.`));
    }
    return out;
  }

  // ---------- Sensor / fluxômetro: novo fator de calibração ----------
  /** tipoFator: 'pulsos_por' (pulsos por litro, por 100 m…) ou 'por_pulso' (cm por pulso, mL por pulso…). */
  function ajusteSensor({leitura, referencia, fatorAtual, tipoFator, ponto}) {
    const out = [];
    if (!finito(leitura) || !finito(referencia) || referencia <= 0 || leitura <= 0) return out;
    const e = desvio(leitura, referencia), oque = ponto === 'fluxometro' ? 'o volume' : 'a velocidade';
    if (Math.abs(e) <= 2) { out.push(item('ok', 'Controlador lendo certo', `Diferença de ${sinal(e)} para o instrumento de referência. Não precisa recalibrar.`)); return out; }
    const efeito = ponto === 'fluxometro'
      ? (e > 0 ? 'Como o controlador acha que saiu mais calda do que saiu, na aplicação automática ele vai aplicar MENOS que o planejado.' : 'Como o controlador acha que saiu menos calda do que saiu, na aplicação automática ele vai aplicar MAIS que o planejado.')
      : (e > 0 ? 'Como o controlador acha que está mais rápido, na aplicação automática ele vai aplicar MAIS que o planejado.' : 'Como o controlador acha que está mais devagar, na aplicação automática ele vai aplicar MENOS que o planejado.');
    out.push(item(Math.abs(e) > 5 ? 'alerta' : 'atencao', `O controlador mostra ${oque} ${e > 0 ? 'acima' : 'abaixo'} do real (${sinal(e)})`, efeito));
    if (finito(fatorAtual) && fatorAtual > 0 && (tipoFator === 'pulsos_por' || tipoFator === 'por_pulso')) {
      const novo = tipoFator === 'pulsos_por' ? fatorAtual * leitura / referencia : fatorAtual * referencia / leitura;
      out.push(item('ok', `Novo fator de calibração: ${fmt(novo, 3)}`, `Troque o fator do controlador de ${fmt(fatorAtual, 3)} para ${fmt(novo, 3)} (${tipoFator === 'pulsos_por' ? 'pulsos por unidade: atual × leitura ÷ referência' : 'unidade por pulso: atual × referência ÷ leitura'}). Depois repita a medição para confirmar.`));
    } else out.push(item('info', 'Como corrigir', `Informe o fator de calibração atual do controlador para o app calcular o novo valor. Regra: se o fator é em pulsos por unidade, multiplique por ${fmt(leitura / referencia, 4)}; se é em unidade por pulso, multiplique por ${fmt(referencia / leitura, 4)}.`));
    return out;
  }

  // ---------- Dose (adubo / semente) ----------
  function ajusteDose({doseKgHa, dosePlanejada}) {
    const out = [];
    if (!finito(doseKgHa) || !finito(dosePlanejada) || dosePlanejada <= 0 || doseKgHa <= 0) return out;
    const d = desvio(doseKgHa, dosePlanejada);
    if (Math.abs(d) <= 3) { out.push(item('ok', 'Dose dentro do planejado', `Soltando ${fmt(doseKgHa)} kg/ha para ${fmt(dosePlanejada)} planejados (${sinal(d)}).`)); return out; }
    const f = dosePlanejada / doseKgHa;
    out.push(item(Math.abs(d) > 10 ? 'alerta' : 'atencao', `${d > 0 ? 'Soltando a mais' : 'Soltando a menos'}: ${sinal(d)}`,
      `${fmt(doseKgHa)} kg/ha para ${fmt(dosePlanejada)} planejados (${d > 0 ? 'sobra' : 'falta'} ${fmt(Math.abs(doseKgHa - dosePlanejada))} kg por hectare).`));
    out.push(item('ok', `Ajuste: ${f < 1 ? 'reduzir' : 'aumentar'} a regulagem em ${fmt(Math.abs(1 - f) * 100)}%`,
      `Multiplique a regulagem atual (abertura da comporta, rotação do dosador ou relação de engrenagens) por ${fmt(f, 3)}. Em dosador por engrenagens, escolha a combinação da tabela da máquina mais próxima desse fator. Depois faça nova coleta para confirmar.`));
    return out;
  }

  // ---------- Plantio na linha ----------
  function diagnosticoLongitudinal({pctDuplos, pctFalhos, pctAceitaveis, espacamentos, sementesPorMetro}) {
    const out = [];
    if (!finito(pctAceitaveis)) return out;
    if (Array.isArray(espacamentos) && espacamentos.length && finito(sementesPorMetro) && sementesPorMetro > 0) {
      const real = 100 / media(espacamentos), d = desvio(real, sementesPorMetro);
      if (Math.abs(d) > 5) out.push(item('atencao', `População ${d > 0 ? 'acima' : 'abaixo'} do planejado (${sinal(d)})`, `Pela média dos espaçamentos, a máquina está pondo cerca de ${fmt(real)} sementes por metro para ${fmt(sementesPorMetro)} planejadas. Confira o disco (número de furos) e a relação de engrenagens ou a taxa do dosador.`));
    }
    const muitosD = pctDuplos > 10, muitosF = pctFalhos > 10;
    if (muitosD && muitosF) out.push(item('alerta', `Duplos (${fmt(pctDuplos)}%) e falhas (${fmt(pctFalhos)}%) ao mesmo tempo`, 'Típico de velocidade alta ou vibração: reduza a velocidade, confira o tubo condutor (sujo, torto ou com degrau) e a fixação da linha.'));
    else if (muitosD) out.push(item('alerta', `Muitos duplos (${fmt(pctDuplos)}%)`, 'Duas sementes na mesma célula: disco com furo grande para o tamanho da semente, raspador/singulador desregulado ou vácuo alto demais (plantadeira a vácuo). Velocidade alta também aumenta duplos.'));
    else if (muitosF) out.push(item('alerta', `Muitas falhas (${fmt(pctFalhos)}%)`, 'Células vazias: disco com furo pequeno ou semente graúda, vácuo baixo, falta de grafite/talco, semente úmida grudando, ou velocidade alta. Confira também entupimento no dosador.'));
    if (!out.length) out.push(item('ok', 'Distribuição boa', `${fmt(pctAceitaveis)}% dos espaçamentos aceitáveis, com ${fmt(pctDuplos)}% de duplos e ${fmt(pctFalhos)}% de falhas.`));
    return out;
  }

  // ---------- Distribuidor a lanço ----------
  function diagnosticoTransversal({valores, cv}) {
    const out = [];
    if (!Array.isArray(valores) || valores.length < 4 || !finito(cv)) return out;
    const m = media(valores), meio = Math.floor(valores.length / 2);
    const esq = media(valores.slice(0, meio)), dir = media(valores.slice(valores.length - meio));
    const q = Math.max(1, Math.round(valores.length / 4));
    const pontas = media([...valores.slice(0, q), ...valores.slice(-q)]), centro = media(valores.slice(q, valores.length - q).length ? valores.slice(q, valores.length - q) : valores);
    if (m > 0 && Math.abs(esq - dir) / m > 0.15) out.push(item('atencao', `Lado ${esq > dir ? 'esquerdo' : 'direito'} recebe mais`, `Diferença de ${fmt(Math.abs(esq - dir) / m * 100, 0)}% entre as metades da faixa. Ajuste o ponto de queda do produto no disco (ou as palhetas) e confira se a máquina está nivelada.`));
    if (centro > 0 && pontas / centro < 0.8) out.push(item('atencao', 'Bordas da faixa com pouco produto', 'A sobreposição entre passadas está pequena: reduza a distância entre passadas (largura de trabalho menor) ou aumente o alcance do disco.'));
    else if (centro > 0 && pontas / centro > 1.2) out.push(item('atencao', 'Bordas da faixa com produto demais', 'Sobreposição excessiva: aumente a distância entre passadas ou reduza o alcance do disco.'));
    if (!out.length) out.push(item(cv > 25 ? 'atencao' : 'ok', cv > 25 ? `Distribuição irregular (CV ${fmt(cv)}%)` : 'Distribuição uniforme', cv > 25 ? 'Confira palhetas gastas, rotação do disco (TDP), granulometria e umidade do produto.' : `CV de ${fmt(cv)}% entre as bandejas, sem lado nem borda desequilibrados.`));
    return out;
  }

  // ---------- Perdas na colheita ----------
  function diagnosticoPerdas({pttKgHa, ppcKgHa, pmiKgHa, pttSc60Ha, foraDoLimite}) {
    const out = [];
    if (!finito(pttKgHa)) return out;
    if (finito(ppcKgHa) && finito(pmiKgHa) && pttKgHa > 0) {
      const plat = ppcKgHa / pttKgHa;
      if (plat >= 0.5) out.push(item(foraDoLimite ? 'alerta' : 'info', `A maior parte da perda é na plataforma (${fmt(plat * 100, 0)}%)`, 'Regule o molinete (altura, posição e velocidade um pouco acima da de deslocamento), a altura de corte e confira navalhas e dedos da barra de corte. Velocidade de deslocamento alta também aumenta essa perda.'));
      else out.push(item(foraDoLimite ? 'alerta' : 'info', `A maior parte da perda é interna (${fmt((1 - plat) * 100, 0)}%)`, 'Ajuste a trilha (rotação do rotor/cilindro e abertura do côncavo), a separação e a limpeza (vento do ventilador e abertura das peneiras). Grãos inteiros saindo atrás indicam vento forte ou peneira fechada; vagens fechadas, trilha fraca.'));
    } else out.push(item('info', 'Separar a origem da perda', 'Para saber se a perda vem da plataforma ou de dentro da máquina, colete também na frente da colhedora (opcional, na tela de medição).'));
    if (foraDoLimite) out.push(item('alerta', `Perdendo cerca de ${fmt(pttSc60Ha, 1)} sacas por hectare`, 'Depois de ajustar, faça nova coleta para confirmar a redução.'));
    return out;
  }

  // ---------- Tendência de desgaste das pontas ----------
  /** historico: [{data:'AAAA-MM-DD', horas?, desvioMedio, modelo?}] em ordem de data. Usa só o trecho desde a última troca de pontas. */
  function tendenciaBicos(historico, limite = 10) {
    const h = (historico || []).filter(p => p && p.data && finito(p.desvioMedio)).sort((a, b) => a.data.localeCompare(b.data));
    if (!h.length) return null;
    // Troca de pontas: queda de 5 pontos ou mais, ou outro modelo de ponta
    let ini = 0;
    for (let i = 1; i < h.length; i++) if (h[i].desvioMedio <= h[i - 1].desvioMedio - 5 || (h[i].modelo && h[i - 1].modelo && h[i].modelo !== h[i - 1].modelo)) ini = i;
    const seg = h.slice(ini), ult = seg[seg.length - 1];
    const dia = d => Date.parse(d + 'T12:00:00Z') / 864e5;
    const base = {pontos: seg.length, atual: arred(ult.desvioMedio, 1), limite, desde: seg[0].data, trocaDetectada: ini > 0};
    if (ult.desvioMedio >= limite) return {...base, situacao: 'passou'};
    if (seg.length < 2) return {...base, situacao: 'poucos'};
    const usaHoras = seg.every(p => finito(p.horas)) && seg[seg.length - 1].horas - seg[0].horas >= 10;
    const xs = seg.map(p => usaHoras ? p.horas : dia(p.data)), ys = seg.map(p => p.desvioMedio);
    if (xs[xs.length - 1] - xs[0] < (usaHoras ? 10 : 7)) return {...base, situacao: 'poucos'};
    const mx = media(xs), my = media(ys), den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const incl = den > 0 ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den : 0;
    if (!(incl > 0.0005)) return {...base, situacao: 'estavel', base: usaHoras ? 'horas' : 'dias'};
    // Previsão a partir do último ponto (pela reta ajustada)
    const yAgora = my + incl * (xs[xs.length - 1] - mx), falta = (limite - Math.max(yAgora, ult.desvioMedio)) / incl;
    let dias = usaHoras ? null : falta;
    if (usaHoras) { const hd = (seg[seg.length - 1].horas - seg[0].horas) / Math.max(1, dia(seg[seg.length - 1].data) - dia(seg[0].data)); dias = hd > 0 ? falta / hd : null; }
    const data = finito(dias) ? new Date((dia(ult.data) + dias) * 864e5).toISOString().slice(0, 10) : null;
    return {...base, situacao: 'desgastando', base: usaHoras ? 'horas' : 'dias', porCem: usaHoras ? arred(incl * 100, 2) : null, porMes: usaHoras ? null : arred(incl * 30, 2),
      faltamHoras: usaHoras ? Math.max(0, Math.round(falta)) : null, faltamDias: finito(dias) ? Math.max(0, Math.round(dias)) : null, dataPrevista: data};
  }
  function textoTendencia(t) {
    if (!t) return null;
    const desde = t.trocaDetectada ? ' (desde a última troca de pontas)' : '';
    if (t.situacao === 'passou') return item('alerta', 'Pontas já passaram do limite de desgaste', `A média da barra está em ${sinal(t.atual)} da referência${desde}. Planeje a troca do jogo de pontas.`);
    if (t.situacao === 'poucos') return item('info', 'Previsão de desgaste', 'Com mais uma aferição deste pulverizador (com alguns dias ou horas de uso de diferença), o app passa a prever quando as pontas vão passar do limite.');
    if (t.situacao === 'estavel') return item('ok', 'Desgaste estável', `Sem aumento de vazão entre as últimas ${t.pontos} aferições${desde}. Média atual: ${sinal(t.atual)}.`);
    const ritmo = t.base === 'horas' ? `${sinal(t.porCem)} a cada 100 horas` : `${sinal(t.porMes)} por mês`;
    const quando = t.base === 'horas' ? `em cerca de ${fmt(t.faltamHoras, 0)} horas de uso` : `em cerca de ${fmt(t.faltamDias, 0)} dias`;
    const data = t.dataPrevista ? ` (por volta de ${t.dataPrevista.slice(8, 10)}/${t.dataPrevista.slice(5, 7)}/${t.dataPrevista.slice(0, 4)})` : '';
    return item(t.faltamDias != null && t.faltamDias <= 30 ? 'atencao' : 'info', `Previsão: trocar as pontas ${quando}${data}`,
      `As pontas estão desgastando ${ritmo}${desde}; a média está em ${sinal(t.atual)} e o limite é ${sinal(t.limite, 0)}. Calculado pelas ${t.pontos} últimas aferições.`);
  }

  // ---------- Impacto estimado (sacas, litros, reais), sempre com a conta aberta ----------
  // area: {ha, origem}; custo/preço: {valor, origem}. Cada linha: [o quê, valor, de onde veio]. Sem um dado, a linha diz o que falta.
  const brl = v => 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const temArea = a => a && finito(a.ha) && a.ha > 0;
  const temValor = c => c && finito(c.valor) && c.valor > 0;

  /** Bicos/taxa: calda (e produto) a mais ou a menos. desvioPct: desvio médio do volume aplicado (%). */
  function impactoVolume({desvioPct, area, custoHa, rotulo = 'Volume aplicado pela barra'}) {
    if (!finito(desvioPct) || Math.abs(desvioPct) < 1) return null;
    const linhas = [[rotulo, `${sinal(desvioPct)} do certo`, 'média das medições desta aferição']];
    if (desvioPct < 0) {
      linhas.push(['Consequência', 'subdose do produto', 'menos produto que o recomendado na bula/receituário']);
      return {nivel: 'alerta', resumo: `Aplicando ${fmt(-desvioPct)}% a menos: risco de falha no controle (subdose), que pode custar mais que o produto.`, linhas};
    }
    let resumo = `Aplicando ${fmt(desvioPct)}% a mais de calda e de produto.`;
    if (temValor(custoHa)) {
      const porHa = custoHa.valor * desvioPct / 100;
      linhas.push(['Custo dos produtos por hectare (por aplicação)', brl(custoHa.valor), custoHa.origem], ['Gasto a mais por hectare', brl(porHa), `${fmt(desvioPct)}% × ${brl(custoHa.valor)}`]);
      if (temArea(area)) { const tot = porHa * area.ha; linhas.push(['Área', `${fmt(area.ha)} ha`, area.origem], ['Gasto a mais em cada aplicação na área', brl(tot), `${brl(porHa)} × ${fmt(area.ha)} ha`]); resumo = `Cerca de ${brl(tot)} a mais em produto a cada aplicação em ${fmt(area.ha)} ha (${brl(porHa)}/ha).`; }
      else resumo = `Cerca de ${brl(porHa)} a mais em produto por hectare, a cada aplicação.`;
    }
    linhas.push(['Premissa', 'sem controlador automático de vazão', 'com controlador, o volume total é corrigido, mas a distribuição na barra continua desigual']);
    return {nivel: desvioPct > 10 ? 'alerta' : 'atencao', resumo, linhas};
  }

  /** Perdas na colheita: sacas e reais. */
  function impactoPerdas({pttKgHa, limiteKgHa, area, preco, cultura = 'grãos'}) {
    if (!finito(pttKgHa) || pttKgHa <= 0) return null;
    const sc = pttKgHa / 60, linhas = [['Perda medida', `${fmt(pttKgHa)} kg/ha = ${fmt(sc, 2)} sc/ha`, 'média dos pontos coletados (saca de 60 kg)']];
    const evitavel = finito(limiteKgHa) ? Math.max(0, pttKgHa - limiteKgHa) / 60 : null;
    if (finito(limiteKgHa)) linhas.push(['Acima do aceitável', `${fmt(evitavel, 2)} sc/ha`, `referência de ${fmt(limiteKgHa)} kg/ha`]);
    let resumo = `Perdendo ${fmt(sc, 2)} sacas por hectare${evitavel ? `, ${fmt(evitavel, 2)} delas acima do aceitável` : ''}.`;
    if (temArea(area)) {
      linhas.push(['Área', `${fmt(area.ha)} ha`, area.origem], ['Perda na área', `${fmt(sc * area.ha, 0)} sacas`, `${fmt(sc, 2)} sc/ha × ${fmt(area.ha)} ha`]);
      resumo = `Cerca de ${fmt(sc * area.ha, 0)} sacas perdidas em ${fmt(area.ha)} ha${evitavel ? ` (${fmt(evitavel * area.ha, 0)} evitáveis)` : ''}.`;
      if (temValor(preco)) {
        const rs = sc * area.ha * preco.valor, rsEv = evitavel ? evitavel * area.ha * preco.valor : null;
        linhas.push([`Preço da saca de ${cultura}`, brl(preco.valor), preco.origem], ['Valor perdido na área', brl(rs), `${fmt(sc * area.ha, 0)} sc × ${brl(preco.valor)}`]);
        if (rsEv) linhas.push(['Valor evitável com regulagem', brl(rsEv), 'só a parte acima do aceitável']);
        resumo = `Cerca de ${brl(rs)} perdidos em ${fmt(area.ha)} ha${rsEv ? ` — ${brl(rsEv)} evitáveis com a regulagem` : ''}.`;
      }
    }
    return {nivel: evitavel ? 'alerta' : 'info', resumo, linhas};
  }

  /** Plantio: plantas por hectare a mais ou a menos. */
  function impactoPlantio({sementesPorMetro, espacamentos, espLinhasM, area}) {
    if (!Array.isArray(espacamentos) || !espacamentos.length || !finito(sementesPorMetro) || sementesPorMetro <= 0) return null;
    const real = 100 / media(espacamentos), d = desvio(real, sementesPorMetro);
    if (Math.abs(d) < 2) return null;
    const linhas = [['Sementes por metro', `${fmt(real, 1)} reais × ${fmt(sementesPorMetro, 1)} planejadas`, 'média dos espaçamentos medidos']];
    let resumo = `${fmt(Math.abs(d))}% ${d < 0 ? 'a menos' : 'a mais'} de sementes que o planejado.`;
    if (finito(espLinhasM) && espLinhasM > 0) {
      const ph = (real - sementesPorMetro) / espLinhasM * 10000;
      linhas.push(['Espaçamento entre linhas', `${fmt(espLinhasM * 100, 0)} cm`, 'configuração da máquina'], ['Diferença por hectare', `${ph > 0 ? '+' : ''}${fmt(ph, 0)} sementes/ha`, '(reais − planejadas) ÷ espaçamento × 10.000']);
      resumo = `${fmt(Math.abs(ph), 0)} sementes por hectare ${ph < 0 ? 'a menos' : 'a mais'} que o planejado.`;
      if (temArea(area)) { linhas.push(['Área', `${fmt(area.ha)} ha`, area.origem], ['Diferença na área', `${ph > 0 ? '+' : ''}${fmt(ph * area.ha, 0)} sementes`, `${fmt(ph, 0)} × ${fmt(area.ha)} ha`]); resumo += ` Na área: ${fmt(Math.abs(ph * area.ha), 0)} sementes.`; }
    }
    return {nivel: d < 0 ? 'alerta' : 'atencao', resumo, linhas};
  }

  /** Dose de adubo/semente: kg a mais ou a menos. */
  function impactoDose({doseKgHa, dosePlanejada, area}) {
    if (!finito(doseKgHa) || !finito(dosePlanejada) || dosePlanejada <= 0) return null;
    const dif = doseKgHa - dosePlanejada;
    if (Math.abs(dif / dosePlanejada) < 0.02) return null;
    const linhas = [['Diferença por hectare', `${dif > 0 ? '+' : ''}${fmt(dif)} kg/ha`, `${fmt(doseKgHa)} medidos − ${fmt(dosePlanejada)} planejados`]];
    let resumo = `${fmt(Math.abs(dif))} kg por hectare ${dif > 0 ? 'a mais' : 'a menos'}.`;
    if (temArea(area)) { linhas.push(['Área', `${fmt(area.ha)} ha`, area.origem], ['Diferença na área', `${dif > 0 ? '+' : ''}${fmt(dif * area.ha / 1000, 2)} t`, `${fmt(dif)} kg/ha × ${fmt(area.ha)} ha`]); resumo = `${fmt(Math.abs(dif * area.ha / 1000), 2)} toneladas ${dif > 0 ? 'a mais' : 'a menos'} em ${fmt(area.ha)} ha.`; }
    return {nivel: Math.abs(dif / dosePlanejada) > 0.1 ? 'alerta' : 'atencao', resumo, linhas};
  }

  return {bicosPontaNova, diagnosticoBicos, ajusteTaxa, ajusteSensor, ajusteDose, diagnosticoLongitudinal, diagnosticoTransversal, diagnosticoPerdas, tendenciaBicos, textoTendencia, listaBicos,
    impactoVolume, impactoPerdas, impactoPlantio, impactoDose};
}));
