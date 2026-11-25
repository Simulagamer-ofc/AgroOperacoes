'use strict';
/* MercaPlant — Termo de conformidade (S1 e S2) e certificado (Básica, C1 e C2) do lote de sementes, em PDF.
   Portaria MAPA 538/2022: o termo de conformidade (Anexo XI) é emitido pelo responsável técnico do produtor para S1 e S2;
   o certificado (Anexo IX) é emitido pela entidade de certificação ou pelo certificador de produção própria para Básica,
   C1 e C2. Os dados vêm do lote, da última análise (e reanálise), do beneficiamento e do cadastro do proprietário.
   Só emite se a análise sustenta a declaração: teste dentro da validade, contagem dentro do limite da categoria
   (não provisória) e germinação/pureza no mínimo da norma. */
(() => {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const porExtenso = iso => { const [a, m, d] = String(iso).split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };
  const certificado = cat => ['Básica', 'C1', 'C2'].includes(cat);
  const nomeDoc = cat => certificado(cat) ? 'Certificado de Sementes' : 'Termo de Conformidade de Sementes';

  /** Dados do documento ou o motivo de não poder emitir. */
  function dadosTermo(l) {
    const cat = l.category || '';
    if (!['Básica', 'C1', 'C2', 'S1', 'S2'].includes(cat)) return {erro: 'Informe a categoria do lote (Básica, C1, C2, S1 ou S2) antes de emitir o documento'};
    const todas = labAnalisesLote(l.id), a = todas.find(x => x.tipo !== 'reanalise');
    if (!a) return {erro: 'Registre a análise do lote antes de emitir o documento'};
    const re = todas.find(x => x.tipo === 'reanalise' && (x.data || '') >= (a.data || ''));
    const p = labPadrao(l.species), germ = re ? re.germinacao : a.germinacao;
    if (labVazio(germ)) return {erro: 'Informe a germinação do boletim (Outros resultados) antes de emitir o documento'};
    const vl = labValidadeLote(l);
    if (vl?.estado === 'vencido') return {erro: `Teste de germinação vencido em ${fmtDate(vl.validade)}: faça a reanálise antes de emitir o documento`};
    const cl = labClassificar(a, l.species), v = labVeredito(cl, cat);
    if (v) {
      if (cl.abaixo.length || v.pendente) return {erro: 'A classificação está provisória (amostra menor que a da norma): refaça a contagem no peso da norma'};
      if (v.tipo === 'reprovado') return {erro: 'A contagem de outras sementes não atende nenhuma categoria: o lote não pode ser vendido como semente'};
      if (v.tipo !== 'mantem') return {erro: `A contagem não atende ${cat}${v.cat ? `, só ${v.cat}: rebaixe o lote antes de emitir` : ''}`};
    }
    const conf = labConfere({...a, germinacao: germ}, p, cat), ruim = conf.find(c => !c.ok);
    if (ruim) return {erro: `${ruim.rot} ${num(ruim.valor)}% abaixo do mínimo do ${cat} (${num(ruim.min)}%)${ruim.atende ? `: rebaixe para ${ruim.atende}` : ''}`};
    const s = db.settings;
    const faltam = [!s.renasemProdutor && 'RENASEM do produtor', !s.respTecnico && 'responsável técnico', !s.renasemRT && 'RENASEM do responsável técnico', certificado(cat) && !s.certificador && 'certificador'].filter(Boolean);
    if (faltam.length) return {faltaDados: faltam};
    const ordem = db.ubs.filter(o => o.lotId === l.id && o.status === 'Concluída').sort((x, y) => (y.fim || '').localeCompare(x.fim || ''))[0];
    return {cat, a, re, p, germ, vl, cl, conf, ordem};
  }

  function gerarTermo(lotId, enviar = false) {
    const l = find('lots', lotId); if (!l) return;
    if (!window.jspdf?.jsPDF || typeof pdfMercaPlant !== 'function') return showToast('Gerador de PDF não carregou. Atualize a página.', true);
    const d = dadosTermo(l);
    if (d.erro) return showToast(d.erro, true);
    if (d.faltaDados) { showToast(`Complete os dados do termo: ${d.faltaDados.join(', ')}`, true); return labDadosTermo(() => gerarTermo(lotId, enviar)); }
    const {cat, a, re, p, germ, vl, conf, ordem} = d, s = db.settings;
    const prod = (typeof prDados === 'function' && prDados()) || {};
    const docProd = typeof prDocFmt === 'function' ? prDocFmt(prod.doc) : prod.doc;
    const titulo = nomeDoc(cat);
    const P = pdfMercaPlant({titulo, linha2: `Lote ${l.code} · ${[l.species, l.cultivar].filter(Boolean).join(' ')} · ${cat}`, continuacao: `${titulo} · lote ${l.code}`});

    P.secao('Produtor');
    P.pares([['Nome / razão social', prod.nome || s.owner || s.farm], [String(prod.doc || '').replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF', docProd], ['Inscrição estadual', prod.ie],
      ['Endereço', [prod.endereco, [prod.municipio, prod.uf].filter(Boolean).join('/'), prod.cep && 'CEP ' + prod.cep].filter(Boolean).join(' - ')], ['Propriedade', s.farm], ['RENASEM', s.renasemProdutor],
      ...(certificado(cat) ? [['Certificador', s.certificador]] : [])]);

    const trat = ordem?.registros?.tratamento, ens = ordem?.registros?.ensaque, prodTrat = trat?.itemId ? find('stock', trat.itemId)?.name : '';
    const pesoLote = ens ? ens.sacas * ens.kgPorSaca : Number(l.weight) || 0;
    P.secao('Semente');
    P.pares([['Espécie', [l.species, p?.cientifico && `(${p.cientifico})`].filter(Boolean).join(' ')], ['Cultivar', l.cultivar], ['Categoria', cat], ['Safra', l.season], ['Lote nº', l.code],
      ['Peso do lote', pesoLote ? `${num(pesoLote)} kg` : ''], ['Embalagens', ens ? `${num(ens.sacas)} de ${num(ens.kgPorSaca)} kg` : ''],
      ['Tratamento', trat ? [prodTrat, trat.dose && 'dose ' + trat.dose].filter(Boolean).join(' - ') || 'tratada' : 'sem tratamento registrado']], 3);

    P.secao('Análise da semente', a.boletim ? `Boletim nº ${a.boletim}` : '');
    const conta = {}; (a.encontradas || []).forEach(e => { if (e.grupo && Number(e.n) > 0) conta[e.grupo] = (conta[e.grupo] || 0) + Number(e.n); });
    P.pares([['Laboratório', a.laboratorio], ['Data do resultado', fmtDate(a.data)], ['Pureza', labVazio(a.pureza) ? '' : `${num(a.pureza, 1)}%`],
      ['Germinação', `${num(germ)}%${re ? ` (reanálise de ${fmtDate(re.data)}${re.boletim ? `, boletim nº ${re.boletim}` : ''})` : ''}`], ['Vigor', labVazio(re?.vigor ?? a.vigor) ? '' : `${num(re?.vigor ?? a.vigor)}%`],
      ['Validade do teste', vl ? `até ${fmtDate(vl.validade)}` : ''], ['Padrão', p?.norma]], 3);
    if (p && !labSemContagem(p)) {
      P.nota('Determinação de outras sementes por número:');
      P.tabela([{t: 'Grupo', w: 3}, {t: 'Encontradas', w: 1.3, dir: true}, {t: 'Amostra (g)', w: 1.3, dir: true}, {t: `Limite ${cat}`, w: 1.3, dir: true}],
        p.grupos.filter(g => !g.id.startsWith('x') || conta[g.id]).map(g => {
          const ex = g.tipo === 'cs' && labDuasAmostras(p) ? (a.amostraCS || a.amostraG) : a.amostraG;
          return [g.rot, num(conta[g.id] || 0), ex ? num(ex, ex % 1 ? 1 : 0) : '-', labVazio(g.lim?.[cat]) ? 'sem limite' : num(g.lim[cat])];
        }));
    } else if (p) P.nota('A norma desta espécie não pede determinação de outras sementes por número.');
    if (conf.length) P.nota(conf.map(c => `${c.rot} ${num(c.valor, c.valor % 1 ? 1 : 0)}%: atinge o mínimo do ${cat} (${num(c.min)}%).`).join(' '));

    P.espaco(2);
    P.nota(certificado(cat)
      ? `Certifico que o lote de sementes acima identificado foi produzido sob o processo de certificação, de acordo com as normas e padrões estabelecidos pelo Ministério da Agricultura e Pecuária, e atende aos padrões de identidade e qualidade da categoria ${cat}.`
      : `Declaro que o lote de sementes acima identificado foi produzido de acordo com as normas e padrões estabelecidos pelo Ministério da Agricultura e Pecuária e atende aos padrões de identidade e qualidade da categoria ${cat}.`);
    P.nota(`${[prod.municipio, prod.uf].filter(Boolean).join('/') || s.farm || ''}${prod.municipio || s.farm ? ', ' : ''}${porExtenso(today())}.`);
    P.assinaturas([[[s.respTecnico, s.respRegistro].filter(Boolean).join(' - '), `Responsável técnico - RENASEM ${s.renasemRT}`], [prod.nome || s.owner || 'Produtor', `Produtor - RENASEM ${s.renasemProdutor}`]]);
    P.espaco(14);
    P.nota(`Documento gerado pelo MercaPlant com os dados do lote. Confira com o modelo oficial (Portaria MAPA nº 538/2022, ${certificado(cat) ? 'Anexo IX' : 'Anexo XI'}) antes de usar.`);
    const doc = P.finalizar(), arq = `${certificado(cat) ? 'certificado' : 'termo-conformidade'}-lote-${String(l.code).replace(/[^\w-]+/g, '_')}.pdf`;
    entregarPdf(doc, arq, enviar, `${titulo} — lote ${l.code} (${[l.species, l.cultivar].filter(Boolean).join(' ')}, ${cat})`);
    db.lotEvents.push({id: uid(), lotId: l.id, date: today(), title: `${titulo} emitido`, text: `Germinação ${num(germ)}%${vl ? ` • válido até ${fmtDate(vl.validade)}` : ''}`});
    save();
  }
  window.dadosTermo = dadosTermo;
  Object.assign(ACTIONS, {'lab-termo': id => gerarTermo(id, false), 'lab-termo-enviar': id => gerarTermo(id, true)});
})();
