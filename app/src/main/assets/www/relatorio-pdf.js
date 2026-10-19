/* MercaPlant — Relatório da propriedade em PDF (offline). jsPDF 4.2.1 (MIT), distribuído em lib/.
   Cabeçalho com a marca, cartões de resumo, gráficos de barras quando há o que comparar (2 itens ou mais),
   tabelas com linhas alternadas, assinatura e rodapé "Página X de Y". */
(() => {
  // Cores da marca
  const COR = {
    texto: [20, 37, 48], suave: [104, 120, 130], linha: [214, 222, 226], fundo: [242, 246, 244], zebra: [246, 249, 247],
    verde: [31, 168, 85], verdeEsc: [18, 87, 58], azul: [23, 112, 180], laranja: [214, 128, 32], trilho: [229, 236, 232]
  };
  const A4 = {l: 210, a: 297}, M = 16, LARG = A4.l - 2 * M, TOPO_CONT = 30, LIMITE = A4.a - 22;
  // Fontes padrão do PDF usam a tabela Latin-1: acentos funcionam; o resto vira equivalente simples
  const texto = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^ -ÿ]/g, '');

  function gerar() {
    if (typeof nvPodeRota === 'function' && !nvPodeRota('relatorios')) {
      showToast('Sua função não permite acessar os relatórios.', true); return;
    }
    const r = dadosRelatorio(), fim = today(), verCustos = typeof relVerCustos !== 'function' || relVerCustos();
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
    const fazenda = db.settings.farm || 'Propriedade não informada', emitido = new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'});
    const periodo = `${fmtDate(r.from)} a ${fmtDate(fim)}`;
    doc.setProperties({title: `Relatório da propriedade - ${texto(fazenda)} - MercaPlant`, author: texto(db.settings.owner || fazenda), creator: 'MercaPlant'});
    let y = 0;

    const cor = (c, tipo = 'text') => tipo === 'text' ? doc.setTextColor(...c) : tipo === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c);
    const fonte = (tam, negrito = false) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); };
    const escrever = (v, x, yy, op) => doc.text(texto(v), x, yy, op);

    function marca(x, yy, tam) {
      fonte(tam, true); cor(COR.texto); escrever('MERCA', x, yy);
      const w = doc.getTextWidth('MERCA'); cor(COR.verde); escrever('PLANT', x + w, yy);
      return w + doc.getTextWidth('PLANT');
    }
    function cabecalhoPrincipal() {
      marca(M, 24, 22);
      fonte(7.5, true); cor(COR.suave); doc.setCharSpace(.6); escrever('GESTÃO AGRÍCOLA INTELIGENTE', M, 30); doc.setCharSpace(0);
      fonte(12, true); cor(COR.texto); escrever(fazenda, A4.l - M, 19, {align: 'right', maxWidth: 95});
      fonte(9); cor(COR.suave);
      escrever('Relatório da propriedade', A4.l - M, 24.5, {align: 'right'});
      escrever(`Período: ${periodo} (${reportDays} dias)`, A4.l - M, 29, {align: 'right'});
      cor(COR.verde, 'fill'); doc.rect(M, 35, LARG, .9, 'F');
      y = 44;
      if (db.settings.owner) { fonte(9); cor(COR.suave); escrever(`Responsável: ${db.settings.owner}`, M, y); y += 6; }
    }
    function cabecalhoContinuacao() {
      marca(M, 16, 12);
      fonte(8.5); cor(COR.suave); escrever(`${fazenda}  ·  ${periodo}`, A4.l - M, 16, {align: 'right', maxWidth: 120});
      cor(COR.linha, 'draw'); doc.setLineWidth(.3); doc.line(M, 20, A4.l - M, 20);
      y = TOPO_CONT;
    }
    function novaPagina() { doc.addPage(); cabecalhoContinuacao(); }
    const garantir = h => { if (y + h > LIMITE) { novaPagina(); return true; } return false; };

    let secaoAtual = '';
    function secao(titulo, sub) {
      secaoAtual = titulo;
      garantir(26);
      y += 4;
      cor(COR.verde, 'fill'); doc.rect(M, y - 4.2, 1.4, 5.6, 'F');
      fonte(12.5, true); cor(COR.texto); escrever(titulo, M + 4, y);
      if (sub) { fonte(8.5); cor(COR.suave); escrever(sub, A4.l - M, y, {align: 'right'}); }
      y += 6;
    }
    function nada(msg) { fonte(9.5); cor(COR.suave); escrever(msg, M + 4, y + 1); y += 8; }

    // Cartões de resumo (até 3 por linha)
    function cartoes(lista) {
      const porLinha = 3, gap = 4, w = (LARG - gap * (porLinha - 1)) / porLinha, h = 22;
      for (let i = 0; i < lista.length; i += porLinha) {
        garantir(h + 4);
        lista.slice(i, i + porLinha).forEach(([rotulo, valor, dica, destaque], k) => {
          const x = M + k * (w + gap);
          cor(COR.fundo, 'fill'); doc.roundedRect(x, y, w, h, 2.2, 2.2, 'F');
          cor(destaque || COR.verde, 'fill'); doc.rect(x, y + 3, 1.1, h - 6, 'F');
          fonte(7, true); cor(COR.suave); doc.setCharSpace(.3); escrever(rotulo.toUpperCase(), x + 5, y + 6.5); doc.setCharSpace(0);
          fonte(15, true); cor(COR.texto); escrever(valor, x + 5, y + 14.5, {maxWidth: w - 8});
          if (dica) { fonte(7.5); cor(COR.suave); escrever(dica, x + 5, y + 19, {maxWidth: w - 8}); }
        });
        y += h + gap;
      }
    }

    // Gráfico de barras horizontais (só quando há 2 itens ou mais para comparar)
    function grafico(itens, {corBarra = COR.verde, formato = v => num(v), max = 10} = {}) {
      const lista = itens.slice(0, max), rotuloW = 52, valorW = 26, barraW = LARG - rotuloW - valorW - 6, h = 6.2, passo = 8.4;
      const maior = Math.max(1, ...lista.map(([, v]) => v));
      lista.forEach(([rot, v]) => {
        garantir(passo + 2);
        fonte(8.5); cor(COR.texto);
        const r1 = doc.splitTextToSize(texto(rot), rotuloW - 2)[0];
        escrever(r1, M + rotuloW - 2, y + h / 2 + 1.3, {align: 'right'});
        cor(COR.trilho, 'fill'); doc.roundedRect(M + rotuloW, y, barraW, h, 1.2, 1.2, 'F');
        const bw = Math.max(1.5, barraW * v / maior);
        cor(corBarra, 'fill'); doc.roundedRect(M + rotuloW, y, bw, h, 1.2, 1.2, 'F');
        fonte(8.5, true); cor(COR.texto); escrever(formato(v), M + rotuloW + barraW + 4, y + h / 2 + 1.3);
        y += passo;
      });
      if (itens.length > max) { fonte(7.5); cor(COR.suave); escrever(`+ ${itens.length - max} itens menores na tabela`, M + rotuloW, y + 1); y += 5; }
      y += 3;
    }

    function continuacao() { fonte(8.5, true); cor(COR.suave); escrever(`${secaoAtual} (continuação)`, M, y); y += 4; }
    // Tabela com cabeçalho repetido a cada página, linhas alternadas e quebra de texto por célula
    function tabela(colunas, linhas) {
      const total = colunas.reduce((s, c) => s + c.w, 0), esc = LARG / total, cols = colunas.map(c => ({...c, w: c.w * esc}));
      const cab = () => {
        cor(COR.verdeEsc, 'fill'); doc.rect(M, y, LARG, 7.5, 'F');
        fonte(7.8, true); cor([255, 255, 255]);
        let x = M; cols.forEach(c => { escrever(c.t, c.dir ? x + c.w - 2 : x + 2, y + 5, c.dir ? {align: 'right'} : undefined); x += c.w; });
        y += 7.5;
      };
      if (garantir(22)) continuacao(); cab();
      linhas.forEach((ln, i) => {
        fonte(8.3);
        const partes = ln.map((v, k) => doc.splitTextToSize(texto(v), cols[k].w - 4));
        const alt = Math.max(6.4, Math.max(...partes.map(p => p.length)) * 3.7 + 2.8);
        if (garantir(alt)) { continuacao(); cab(); }
        if (i % 2) { cor(COR.zebra, 'fill'); doc.rect(M, y, LARG, alt, 'F'); }
        let x = M;
        partes.forEach((p, k) => {
          const c = cols[k]; fonte(8.3, !!c.negrito); cor(COR.texto);
          p.forEach((t, j) => doc.text(t, c.dir ? x + c.w - 2 : x + 2, y + 4.4 + j * 3.7, c.dir ? {align: 'right'} : undefined));
          x += c.w;
        });
        y += alt;
      });
      cor(COR.linha, 'draw'); doc.setLineWidth(.3); doc.line(M, y, A4.l - M, y);
      y += 5;
    }

    // ---------- Conteúdo ----------
    cabecalhoPrincipal();
    const concl = r.ops.filter(o => o.status === 'Concluída').length, horas = r.hoursBy.reduce((s, [, h]) => s + h, 0);
    const kpis = [
      ['Operações no período', num(r.ops.length), `${concl} concluídas`],
      ['Área trabalhada', `${num(r.area)} ha`, 'em operações concluídas'],
      ['Horas de máquina', `${num(horas)} h`, `${r.hoursBy.length} ${r.hoursBy.length === 1 ? 'máquina' : 'máquinas'} com registro`, COR.azul]
    ];
    if (verCustos) kpis.push(
      ['Manutenção', `R$ ${num(r.maintCost, 2)}`, `${r.custosManut.length} ${r.custosManut.length === 1 ? 'ordem concluída' : 'ordens concluídas'}`, COR.laranja],
      ['Outros gastos', `R$ ${num(r.outrosGastos, 2)}`, 'combustível, peças, mão de obra...', COR.laranja],
      ['Custo total', `R$ ${num(r.maintCost + r.outrosGastos, 2)}`, r.area > 0 ? `R$ ${num((r.maintCost + r.outrosGastos) / r.area, 2)} por ha trabalhado` : '', COR.laranja]
    );
    secao('Resumo do período');
    cartoes(kpis);

    secao('Operações por tipo', `${r.ops.length} no total`);
    if (!r.byType.length) nada('Sem operações no período.');
    else {
      const itens = r.byType.map(([t, l]) => [t, l.length]).sort((a, b) => b[1] - a[1]);
      if (itens.length >= 2) grafico(itens);
      else tabela([{t: 'Tipo', w: 3}, {t: 'Operações', w: 1, dir: true}], itens.map(([t, n]) => [t, num(n)]));
    }

    secao('Horas trabalhadas por máquina', `${num(horas)} h no total`);
    if (!r.hoursBy.length) nada('Sem registros de horímetro no período.');
    else if (r.hoursBy.length >= 2) grafico(r.hoursBy.map(([m, h]) => [m.name, h]), {corBarra: COR.azul, formato: v => `${num(v)} h`});
    else tabela([{t: 'Máquina', w: 3}, {t: 'Horas', w: 1, dir: true}], r.hoursBy.map(([m, h]) => [m.name, `${num(h)} h`]));

    if (verCustos && typeof lancamentosCusto === 'function') {
      const cats = agrupar(lancamentosCusto(r.from, fim), x => x.category || 'Outros');
      if (cats.length) {
        secao('Custos por categoria', `R$ ${num(r.maintCost + r.outrosGastos, 2)}`);
        if (cats.length >= 2) grafico(cats, {corBarra: COR.laranja, formato: v => `R$ ${num(v, 2)}`, max: 8});
        tabela([{t: 'Categoria', w: 3}, {t: 'Valor', w: 1.2, dir: true}, {t: '% do total', w: 1, dir: true}],
          cats.map(([c, v]) => [c, `R$ ${num(v, 2)}`, `${num(Math.round(v / Math.max(1e-9, r.maintCost + r.outrosGastos) * 1000) / 10, 1)}%`]));
      }
    }

    secao('Consumo de insumos');
    if (!r.consumption.length) nada('Nenhuma saída de estoque no período.');
    else tabela([{t: 'Item', w: 3}, {t: 'Consumo no período', w: 1.4, dir: true}, {t: 'Saldo atual', w: 1.2, dir: true}],
      r.consumption.map(([s, q]) => [s.name, `${num(q)} ${s.unit || ''}`, `${num(s.qty)} ${s.unit || ''}`]));

    secao('Detalhamento das operações', `${r.ops.length} registros`);
    if (!r.ops.length) nada('Sem operações no período.');
    else tabela([{t: 'Data', w: 1.15}, {t: 'Tipo', w: 1.7, negrito: true}, {t: 'Situação', w: 1.35}, {t: 'Local', w: 1.8}, {t: 'Máquina', w: 1.7}, {t: 'Área (ha)', w: 1.05, dir: true}, {t: 'Operador / obs.', w: 2.1}],
      r.ops.slice().sort(byDateDesc).map(o => [fmtDate(o.date), o.type, o.status, opPlace(o) || '-', machineName(o.machineId) || '-',
        opTemArea(o) ? num(o.area || 0) : '-', [o.operator, o.notes].filter(Boolean).join(' - ') || '-']));

    // Assinaturas
    garantir(34); y += 14;
    const assinaturas = [[db.settings.owner || 'Responsável pela propriedade', 'Responsável']];
    if (db.settings.respTecnico) assinaturas.push([[db.settings.respTecnico, db.settings.respRegistro].filter(Boolean).join(' - '), 'Responsável técnico']);
    const wA = (LARG - 12) / 2;
    assinaturas.forEach(([nome, papel], k) => {
      const x = M + k * (wA + 12);
      cor(COR.texto, 'draw'); doc.setLineWidth(.3); doc.line(x, y, x + wA, y);
      fonte(9, true); cor(COR.texto); escrever(nome, x + wA / 2, y + 4.5, {align: 'center', maxWidth: wA});
      fonte(7.5); cor(COR.suave); escrever(papel, x + wA / 2, y + 8.5, {align: 'center'});
    });

    // Rodapé em todas as páginas
    const paginas = doc.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
      doc.setPage(p);
      cor(COR.linha, 'draw'); doc.setLineWidth(.3); doc.line(M, A4.a - 14, A4.l - M, A4.a - 14);
      fonte(7.5); cor(COR.suave);
      escrever(`MercaPlant  ·  Relatório gerado em ${emitido}`, M, A4.a - 9.5);
      escrever(`Página ${p} de ${paginas}`, A4.l - M, A4.a - 9.5, {align: 'right'});
    }

    const nome = `mercaplant-relatorio-${r.from}-a-${fim}.pdf`;
    if (window.AndroidBridge?.savePdf) {
      window.AndroidBridge.savePdf(nome, doc.output('datauristring').split(',')[1]);
    } else if (window.AndroidBridge?.printPage) {
      // APK antigo: o novo método binário exige atualização do aplicativo.
      showToast('Atualize o aplicativo para baixar o PDF. Você também pode baixar pelo navegador.', true);
    } else {
      downloadFile(nome, 'application/pdf', doc.output('arraybuffer'));
    }
    return doc;
  }
  ACTIONS['relatorio-pdf'] = gerar;
})();
