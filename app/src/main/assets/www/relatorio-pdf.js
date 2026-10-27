/* MercaPlant — Relatórios em PDF (offline). jsPDF 4.2.1 (MIT), distribuído em lib/.
   Peças comuns (pdfMercaPlant): cabeçalho com a marca, cartões de resumo, gráficos de barras quando há o que comparar
   (2 itens ou mais), tabelas com linhas alternadas, assinaturas e rodapé "Página X de Y".
   Relatórios: da propriedade (Relatórios) e da safra do talhão (Talhão → Relatório da safra). */
(() => {
  // Cores da marca
  const COR = {
    texto: [20, 37, 48], suave: [104, 120, 130], linha: [214, 222, 226], fundo: [242, 246, 244], zebra: [246, 249, 247],
    verde: [31, 168, 85], verdeEsc: [18, 87, 58], azul: [23, 112, 180], laranja: [214, 128, 32], trilho: [229, 236, 232], vermelho: [205, 64, 64]
  };
  const A4 = {l: 210, a: 297}, M = 16, LARG = A4.l - 2 * M, TOPO_CONT = 30, LIMITE = A4.a - 22;
  // Fontes padrão do PDF usam a tabela Latin-1: acentos funcionam; o resto vira equivalente simples
  const texto = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^ -ÿ]/g, '');
  const brl = v => `${v < 0 ? '- ' : ''}R$ ${num(Math.abs(v), 2)}`;

  // Entrega do PDF: baixar (salvar no aparelho) ou enviar (WhatsApp, e-mail…)
  function entregarPdf(doc, nome, enviar, textoEnvio = '') {
    if (enviar) {
      if (window.AndroidBridge?.sharePdf) { window.AndroidBridge.sharePdf(nome, doc.output('datauristring').split(',')[1], textoEnvio); return; }
      try {
        const arq = new File([doc.output('blob')], nome, {type: 'application/pdf'});
        if (navigator.canShare?.({files: [arq]})) {
          navigator.share({files: [arq], title: nome, text: textoEnvio}).catch(err => { if (err?.name !== 'AbortError') { showToast('Não foi possível enviar; o PDF foi baixado.', true); entregarPdf(doc, nome, false); } });
          return;
        }
      } catch { /* navegador sem envio de arquivos: baixa */ }
      showToast('Este navegador não envia arquivos direto. O PDF foi baixado: anexe no WhatsApp pelo clipe 📎.', true);
    }
    if (window.AndroidBridge?.savePdf) {
      window.AndroidBridge.savePdf(nome, doc.output('datauristring').split(',')[1]);
    } else if (window.AndroidBridge?.printPage) {
      // APK antigo: o novo método binário exige atualização do aplicativo.
      showToast('Atualize o aplicativo para baixar o PDF. Você também pode baixar pelo navegador.', true);
    } else {
      downloadFile(nome, 'application/pdf', doc.output('arraybuffer'));
    }
  }
  window.entregarPdf = entregarPdf;

  // ---------- Peças comuns de um relatório MercaPlant ----------
  function pdfMercaPlant({titulo, linha2 = '', continuacao: contTxt = ''}) {
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
    const fazenda = db.settings.farm || 'Propriedade não informada', emitido = new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'});
    doc.setProperties({title: `${texto(titulo)} - ${texto(fazenda)} - MercaPlant`, author: texto(db.settings.owner || fazenda), creator: 'MercaPlant'});
    let y = 0, secaoAtual = '';
    const cor = (c, tipo = 'text') => tipo === 'text' ? doc.setTextColor(...c) : tipo === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c);
    const fonte = (tam, negrito = false) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); };
    const escrever = (v, x, yy, op) => doc.text(texto(v), x, yy, op);
    function marca(x, yy, tam) {
      fonte(tam, true); cor(COR.texto); escrever('MERCA', x, yy);
      const w = doc.getTextWidth('MERCA'); cor(COR.verde); escrever('PLANT', x + w, yy);
    }
    function cabecalhoContinuacao() {
      marca(M, 16, 12);
      fonte(8.5); cor(COR.suave); escrever(`${fazenda}  ·  ${contTxt}`, A4.l - M, 16, {align: 'right', maxWidth: 120});
      cor(COR.linha, 'draw'); doc.setLineWidth(.3); doc.line(M, 20, A4.l - M, 20);
      y = TOPO_CONT;
    }
    const garantir = h => { if (y + h > LIMITE) { doc.addPage(); cabecalhoContinuacao(); return true; } return false; };
    const continuacao = () => { fonte(8.5, true); cor(COR.suave); escrever(`${secaoAtual} (continuação)`, M, y); y += 4; };

    // Cabeçalho da primeira página
    marca(M, 24, 22);
    fonte(7.5, true); cor(COR.suave); doc.setCharSpace(.6); escrever('GESTÃO AGRÍCOLA INTELIGENTE', M, 30); doc.setCharSpace(0);
    fonte(12, true); cor(COR.texto); escrever(fazenda, A4.l - M, 19, {align: 'right', maxWidth: 95});
    fonte(9); cor(COR.suave); escrever(titulo, A4.l - M, 24.5, {align: 'right', maxWidth: 110});
    if (linha2) escrever(linha2, A4.l - M, 29, {align: 'right', maxWidth: 110});
    cor(COR.verde, 'fill'); doc.rect(M, 35, LARG, .9, 'F');
    y = 44;

    const api = {
      doc, texto, COR,
      nota(msg) { fonte(9); cor(COR.suave); doc.splitTextToSize(texto(msg), LARG).forEach(l => { garantir(5); doc.text(l, M, y); y += 4.4; }); y += 1.5; },
      // reserva: espaço extra (mm) que o conteúdo logo abaixo precisa, para o título não ficar sozinho no fim da página
      secao(tit, sub, reserva = 0) {
        secaoAtual = tit; garantir(26 + reserva); y += 4;
        cor(COR.verde, 'fill'); doc.rect(M, y - 4.2, 1.4, 5.6, 'F');
        fonte(12.5, true); cor(COR.texto); escrever(tit, M + 4, y);
        if (sub) { fonte(8.5); cor(COR.suave); escrever(sub, A4.l - M, y, {align: 'right'}); }
        y += 6;
      },
      espaco(mm) { y += mm; },
      nada(msg) { fonte(9.5); cor(COR.suave); escrever(msg, M + 4, y + 1); y += 8; },
      // Fotos em grade (3 por linha): lista de {src: dataURL JPEG, w, h, legenda}
      fotos(lista) {
        const gap = 4, col = 3, lw = (LARG - gap * (col - 1)) / col, maxH = 62;
        for (let i = 0; i < lista.length; i += col) {
          const linha = lista.slice(i, i + col).map(f => { const k = Math.min(lw / f.w, maxH / f.h); return {...f, dw: f.w * k, dh: f.h * k}; });
          const alt = Math.max(...linha.map(f => f.dh)) + 7;
          garantir(alt);
          linha.forEach((f, j) => {
            const x = M + j * (lw + gap) + (lw - f.dw) / 2;
            try { doc.addImage(f.src, 'JPEG', x, y, f.dw, f.dh); } catch { /* foto ilegível: fica só a legenda */ }
            if (f.legenda) { fonte(7.5); cor(COR.suave); escrever(f.legenda, M + j * (lw + gap) + lw / 2, y + f.dh + 4, {align: 'center'}); }
          });
          y += alt;
        }
        y += 2;
      },
      // Cartões de resumo (até 3 por linha): [rótulo, valor, dica, cor]
      cartoes(lista) {
        const porLinha = 3, gap = 4, w = (LARG - gap * (porLinha - 1)) / porLinha, h = 22;
        for (let i = 0; i < lista.length; i += porLinha) {
          garantir(h + 4);
          lista.slice(i, i + porLinha).forEach(([rotulo, valor, dica, destaque], k) => {
            const x = M + k * (w + gap);
            cor(COR.fundo, 'fill'); doc.roundedRect(x, y, w, h, 2.2, 2.2, 'F');
            cor(destaque || COR.verde, 'fill'); doc.rect(x, y + 3, 1.1, h - 6, 'F');
            fonte(7, true); cor(COR.suave); doc.setCharSpace(.3); escrever(String(rotulo).toUpperCase(), x + 5, y + 6.5); doc.setCharSpace(0);
            fonte(15, true); cor(COR.texto); escrever(valor, x + 5, y + 14.5, {maxWidth: w - 8});
            if (dica) { fonte(7.5); cor(COR.suave); escrever(dica, x + 5, y + 19, {maxWidth: w - 8}); }
          });
          y += h + gap;
        }
      },
      // Barras horizontais: [rótulo, valor]
      grafico(itens, {corBarra = COR.verde, formato = v => num(v), max = 10} = {}) {
        const lista = itens.slice(0, max), rotuloW = 52, valorW = 26, barraW = LARG - rotuloW - valorW - 6, h = 6.2, passo = 8.4;
        const maior = Math.max(1e-9, ...lista.map(([, v]) => v));
        lista.forEach(([rot, v]) => {
          garantir(passo + 2);
          fonte(8.5); cor(COR.texto); escrever(doc.splitTextToSize(texto(rot), rotuloW - 2)[0], M + rotuloW - 2, y + h / 2 + 1.3, {align: 'right'});
          cor(COR.trilho, 'fill'); doc.roundedRect(M + rotuloW, y, barraW, h, 1.2, 1.2, 'F');
          cor(corBarra, 'fill'); doc.roundedRect(M + rotuloW, y, Math.max(1.5, barraW * v / maior), h, 1.2, 1.2, 'F');
          fonte(8.5, true); cor(COR.texto); escrever(formato(v), M + rotuloW + barraW + 4, y + h / 2 + 1.3);
          y += passo;
        });
        if (itens.length > max) { fonte(7.5); cor(COR.suave); escrever(`+ ${itens.length - max} itens menores na tabela`, M + rotuloW, y + 1); y += 5; }
        y += 3;
      },
      // Duas barras por item (ex.: planejado x realizado): [rótulo, a, b]
      graficoDuplo(itens, {nomes = ['A', 'B'], cores = [COR.trilho, COR.verde], formato = v => num(v)} = {}) {
        const rotuloW = 46, valorW = 30, barraW = LARG - rotuloW - valorW - 6, h = 4.2, passo = 12.5;
        const maior = Math.max(1e-9, ...itens.flatMap(([, a, b]) => [a, b]));
        garantir(10);
        nomes.forEach((n, k) => { const x = M + rotuloW + k * 40; cor(k === 0 ? [176, 190, 184] : cores[1], 'fill'); doc.rect(x, y - 2.6, 3.2, 3.2, 'F'); fonte(8); cor(COR.suave); escrever(n, x + 5, y); });
        y += 4;
        itens.forEach(([rot, a, b]) => {
          garantir(passo + 2);
          fonte(8.5); cor(COR.texto); escrever(doc.splitTextToSize(texto(rot), rotuloW - 2)[0], M + rotuloW - 2, y + h + 1.2, {align: 'right'});
          cor([176, 190, 184], 'fill'); doc.roundedRect(M + rotuloW, y, Math.max(a > 0 ? 1.5 : 0, barraW * a / maior), h, 1, 1, 'F');
          const corB = a > 0 && b > a ? COR.vermelho : cores[1];
          cor(corB, 'fill'); doc.roundedRect(M + rotuloW, y + h + 1.2, Math.max(b > 0 ? 1.5 : 0, barraW * b / maior), h, 1, 1, 'F');
          fonte(7.5); cor(COR.suave); escrever(a > 0 ? formato(a) : '-', M + rotuloW + barraW + 4, y + h - .6);
          fonte(7.5, true); cor(a > 0 && b > a ? COR.vermelho : COR.texto); escrever(formato(b), M + rotuloW + barraW + 4, y + 2 * h + .8);
          y += passo;
        });
        y += 2;
      },
      // Tabela com cabeçalho repetido a cada página, linhas alternadas e quebra de texto por célula
      tabela(colunas, linhas) {
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
      },
      // Pares rótulo → valor (ficha), sem cabeçalho
      ficha(pares) { api.tabela([{t: 'Item', w: 2}, {t: 'Informação', w: 3}], pares.filter(([, v]) => v !== '' && v != null)); },
      assinaturas(lista) {
        garantir(34); y += 14;
        const wA = (LARG - 12) / 2;
        lista.slice(0, 2).forEach(([nome, papel], k) => {
          const x = M + k * (wA + 12);
          cor(COR.texto, 'draw'); doc.setLineWidth(.3); doc.line(x, y, x + wA, y);
          fonte(9, true); cor(COR.texto); escrever(nome, x + wA / 2, y + 4.5, {align: 'center', maxWidth: wA});
          fonte(7.5); cor(COR.suave); escrever(papel, x + wA / 2, y + 8.5, {align: 'center'});
        });
      },
      finalizar() {
        const paginas = doc.getNumberOfPages();
        for (let p = 1; p <= paginas; p++) {
          doc.setPage(p);
          cor(COR.linha, 'draw'); doc.setLineWidth(.3); doc.line(M, A4.a - 14, A4.l - M, A4.a - 14);
          fonte(7.5); cor(COR.suave);
          escrever(`MercaPlant  ·  Relatório gerado em ${emitido}`, M, A4.a - 9.5);
          escrever(`Página ${p} de ${paginas}`, A4.l - M, A4.a - 9.5, {align: 'right'});
        }
        return doc;
      }
    };
    return api;
  }
  window.pdfMercaPlant = pdfMercaPlant;
  const assinaturasPadrao = () => [[db.settings.owner || 'Responsável pela propriedade', 'Responsável'],
    ...(db.settings.respTecnico ? [[[db.settings.respTecnico, db.settings.respRegistro].filter(Boolean).join(' - '), 'Responsável técnico']] : [])];

  // ---------- Relatório da propriedade (tela Relatórios) ----------
  function gerar(enviar = false) {
    if (typeof nvPodeRota === 'function' && !nvPodeRota('relatorios')) {
      showToast('Sua função não permite acessar os relatórios.', true); return;
    }
    const r = dadosRelatorio(), fim = today(), verCustos = typeof relVerCustos !== 'function' || relVerCustos();
    const periodo = `${fmtDate(r.from)} a ${fmtDate(fim)}`;
    const P = pdfMercaPlant({titulo: 'Relatório da propriedade', linha2: `Período: ${periodo} (${reportDays} dias)`, continuacao: periodo});
    if (db.settings.owner) P.nota(`Responsável: ${db.settings.owner}`);
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
    P.secao('Resumo do período');
    P.cartoes(kpis);

    P.secao('Operações por tipo', `${r.ops.length} no total`);
    if (!r.byType.length) P.nada('Sem operações no período.');
    else {
      const itens = r.byType.map(([t, l]) => [t, l.length]).sort((a, b) => b[1] - a[1]);
      if (itens.length >= 2) P.grafico(itens);
      else P.tabela([{t: 'Tipo', w: 3}, {t: 'Operações', w: 1, dir: true}], itens.map(([t, n]) => [t, num(n)]));
    }

    P.secao('Horas trabalhadas por máquina', `${num(horas)} h no total`);
    if (!r.hoursBy.length) P.nada('Sem registros de horímetro no período.');
    else if (r.hoursBy.length >= 2) P.grafico(r.hoursBy.map(([m, h]) => [m.name, h]), {corBarra: COR.azul, formato: v => `${num(v)} h`});
    else P.tabela([{t: 'Máquina', w: 3}, {t: 'Horas', w: 1, dir: true}], r.hoursBy.map(([m, h]) => [m.name, `${num(h)} h`]));

    if (verCustos && typeof lancamentosCusto === 'function') {
      const cats = agrupar(lancamentosCusto(r.from, fim), x => x.category || 'Outros');
      if (cats.length) {
        P.secao('Custos por categoria', `R$ ${num(r.maintCost + r.outrosGastos, 2)}`);
        if (cats.length >= 2) P.grafico(cats, {corBarra: COR.laranja, formato: v => `R$ ${num(v, 2)}`, max: 8});
        P.tabela([{t: 'Categoria', w: 3}, {t: 'Valor', w: 1.2, dir: true}, {t: '% do total', w: 1, dir: true}],
          cats.map(([c, v]) => [c, `R$ ${num(v, 2)}`, `${num(Math.round(v / Math.max(1e-9, r.maintCost + r.outrosGastos) * 1000) / 10, 1)}%`]));
      }
    }

    P.secao('Consumo de insumos');
    if (!r.consumption.length) P.nada('Nenhuma saída de estoque no período.');
    else P.tabela([{t: 'Item', w: 3}, {t: 'Consumo no período', w: 1.4, dir: true}, {t: 'Saldo atual', w: 1.2, dir: true}],
      r.consumption.map(([s, q]) => [s.name, `${num(q)} ${s.unit || ''}`, `${num(s.qty)} ${s.unit || ''}`]));

    P.secao('Detalhamento das operações', `${r.ops.length} registros`);
    if (!r.ops.length) P.nada('Sem operações no período.');
    else P.tabela([{t: 'Data', w: 1.15}, {t: 'Tipo', w: 1.7, negrito: true}, {t: 'Situação', w: 1.35}, {t: 'Local', w: 1.8}, {t: 'Máquina', w: 1.7}, {t: 'Área (ha)', w: 1.05, dir: true}, {t: 'Operador / obs.', w: 2.1}],
      r.ops.slice().sort(byDateDesc).map(o => [fmtDate(o.date), o.type, o.status, opPlace(o) || '-', machineName(o.machineId) || '-',
        opTemArea(o) ? num(o.area || 0) : '-', [o.operator, o.notes].filter(Boolean).join(' - ') || '-']));

    P.assinaturas(assinaturasPadrao());
    const doc = P.finalizar(), fazenda = db.settings.farm || 'Propriedade não informada';
    entregarPdf(doc, `mercaplant-relatorio-${r.from}-a-${fim}.pdf`, enviar === true, `Relatório MercaPlant - ${texto(fazenda)} - ${periodo}`);
    return doc;
  }
  ACTIONS['relatorio-pdf'] = () => gerar(false);
  ACTIONS['relatorio-pdf-enviar'] = () => gerar(true);

  // ---------- Relatório da safra do talhão ----------
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function gerarSafra(id, enviar = false) {
    const f = find('fields', id); if (!f) return showToast('Talhão não encontrado', true);
    if (typeof nvPodeRota === 'function' && !nvPodeRota('talhoes')) return showToast('Sua função não permite acessar os talhões.', true);
    const p = periodoSafra(f), no = r => (r.date || '') >= p.ini && (r.date || '') <= p.fim, area = Number(f.area) || 0;
    const ops = db.operations.filter(o => o.fieldId === id && no(o)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const aps = db.aplicacoes.filter(a => a.fieldId === id && no(a)).sort((a, b) => a.date.localeCompare(b.date));
    const mon = db.monitoramentos.filter(m => m.fieldId === id && no(m)).sort((a, b) => a.date.localeCompare(b.date));
    const chuvas = db.chuvas.filter(c => (c.fieldId === id || !c.fieldId) && no(c)), chuva = chuvas.reduce((t, c) => t + (Number(c.mm) || 0), 0);
    const col = db.colheitas.filter(c => c.fieldId === id && no(c)), sacas = col.reduce((t, c) => t + Number(c.kg || 0) / 60, 0);
    const sf = typeof safraDoPeriodo === 'function' ? safraDoPeriodo(f, p) : f.season;
    const ana = typeof analiseSafra === 'function' && sf ? analiseSafra(sf).linhas.find(l => l.id === id) : null;
    const fin = typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
    const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(id) : null;
    const periodo = `${fmtDate(p.ini)} a ${fmtDate(p.fim)}`;

    const P = pdfMercaPlant({titulo: `Relatório da safra - ${f.name}`, linha2: `${p.nome}: ${periodo}`, continuacao: `${f.name} · ${periodo}`});
    const conc = ops.filter(o => o.status === 'Concluída').length;
    const kpis = [
      ['Área', area ? `${num(area)} ha` : '-', [f.crop, f.cultivar].filter(Boolean).join(' · ')],
      ['Produção', col.length ? `${num(Math.round(sacas))} sc` : '-', col.length && area ? `${num(Math.round(sacas / area * 10) / 10, 1)} sc/ha` : 'sem colheita no período'],
      ['Chuva no período', chuvas.length ? `${num(Math.round(chuva))} mm` : '-', `${chuvas.length} ${chuvas.length === 1 ? 'registro' : 'registros'}`, COR.azul],
      ['Operações', num(ops.length), `${conc} concluídas`],
      ['Aplicações', num(aps.length), lib ? (lib.libera > today() ? `colheita a partir de ${fmtDate(lib.libera)}` : 'colheita liberada (carência)') : 'defensivos'],
      ['Monitoramentos', num(mon.length), 'pragas e doenças']
    ];
    if (fin && ana) kpis.push(
      ['Custo total', brl(ana.custo), ana.custoHa != null ? `${brl(ana.custoHa)} por ha` : '', COR.laranja],
      ['Custo por saca', ana.custoSc != null ? brl(ana.custoSc) : '-', ana.equilibrio != null ? `equilíbrio: ${num(Math.round(ana.equilibrio * 10) / 10, 1)} sc/ha` : '', COR.laranja],
      ['Margem', ana.margem != null ? brl(ana.margem) : '-', ana.margemHa != null ? `${brl(ana.margemHa)} por ha` : 'sem preço de venda', ana.margem != null && ana.margem < 0 ? COR.vermelho : COR.verde]
    );
    P.secao('Resumo da safra');
    P.cartoes(kpis);
    P.secao('Talhão');
    P.ficha([['Talhão', f.name], ['Área', area ? `${num(area)} ha` : ''], ['Cultura', f.crop || ''], ['Cultivar', f.cultivar || ''], ['Safra', sf || ''],
      ['Período do relatório', `${p.nome} (${periodo})`], ['Colheita liberada (carência)', lib ? (lib.libera > today() ? 'a partir de ' + fmtDate(lib.libera) : 'liberada') : '']]);

    // Planejado x realizado (quando há planejamento)
    if (fin && sf && typeof planejamentoSafra === 'function') {
      const l = planejamentoSafra(sf).linhas.find(x => x.id === id);
      if (l?.plan > 0) {
        P.secao('Planejado x realizado', `${num(Math.round(l.pct))}% do orçamento usado`);
        const cats = ORC_CATS.map(c => [c, (Number(l.o?.valores?.[c]) || 0) * l.area, l.porCat[c] || 0]).filter(([, a, b]) => a > 0 || b > 0);
        if (cats.length >= 2) P.graficoDuplo(cats, {nomes: ['Planejado', 'Realizado'], formato: v => brl(v)});
        P.tabela([{t: 'Categoria', w: 2.2}, {t: 'Planejado', w: 1.4, dir: true}, {t: 'Realizado', w: 1.4, dir: true}, {t: 'Saldo', w: 1.4, dir: true}],
          [...cats.map(([c, a, b]) => [c, a ? brl(a) : '-', brl(b), a ? brl(a - b) : 'não planejado']), ['Total', brl(l.plan), brl(l.real), brl(l.plan - l.real)]]);
      }
    }

    // Chuva por mês: gráfico quando há 2 meses ou mais
    const porMes = {}; chuvas.forEach(c => { const k = (c.date || '').slice(0, 7); porMes[k] = (porMes[k] || 0) + (Number(c.mm) || 0); });
    const meses = Object.entries(porMes).sort(([a], [b]) => a.localeCompare(b)).map(([k, mm]) => [`${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`, mm]);
    if (meses.length >= 2) { P.secao('Chuva por mês', `${num(Math.round(chuva))} mm no período`); P.grafico(meses, {corBarra: COR.azul, formato: v => `${num(Math.round(v))} mm`, max: 14}); }

    P.secao('Operações', `${ops.length} no período`);
    if (!ops.length) P.nada('Nenhuma operação no período.');
    else P.tabela([{t: 'Data', w: 1.15}, {t: 'Operação', w: 1.8, negrito: true}, {t: 'Máquina', w: 1.8}, {t: 'Área / qtd.', w: 1.2, dir: true}, {t: 'Horas', w: .9, dir: true}, {t: 'Situação', w: 1.3}],
      ops.map(o => [fmtDate(o.date), o.type, machineName(o.machineId) || '-', o.area && opTemArea(o) ? `${num(o.area)} ha` : o.kg ? `${num(o.kg)} kg` : '-', o.horas ? `${um1(o.horas)} h` : '-', o.status]));

    P.secao('Aplicações de defensivos', `${aps.length} no período`);
    if (!aps.length) P.nada('Nenhuma aplicação no período.');
    else P.tabela([{t: 'Data', w: 1.1}, {t: 'Produto e dose', w: 2.4, negrito: true}, {t: 'Receituário', w: 1.3}, {t: 'Resp. técnico', w: 1.5}, {t: 'Carência', w: 1.5}],
      aps.map(a => [fmtDate(a.date), [a.produto, a.dose].filter(Boolean).join(' - '), a.receituario || '-', a.responsavel || '-', `${num(a.carencia)} d (até ${fmtDate(addDias(a.date, Number(a.carencia) || 0))})`]));

    P.secao('Monitoramento de pragas e doenças', `${mon.length} no período`);
    if (!mon.length) P.nada('Nenhum monitoramento no período.');
    else {
      // Alvo que passou do nível de ação em algum momento: aparece destacado no gráfico
      const picos = {}; mon.forEach(m => { const k = m.alvo || 'Alvo'; const v = Number(m.valor) || 0; if (!picos[k] || v > picos[k].v) picos[k] = {v, nivel: Number(m.nivelAcao), un: m.unidade || ''}; });
      const acima = Object.entries(picos).filter(([, x]) => x.nivel > 0 && x.v >= x.nivel);
      if (acima.length) P.nota(`Atingiram o nível de ação no período: ${acima.map(([k, x]) => `${k} (máx. ${num(x.v, 2)} ${x.un}; nível ${num(x.nivel, 2)})`).join('; ')}.`);
      P.tabela([{t: 'Data', w: 1.1}, {t: 'Alvo', w: 2.4, negrito: true}, {t: 'Média', w: 1.4, dir: true}, {t: 'Nível de ação', w: 1.4, dir: true}],
        mon.map(m => [fmtDate(m.date), m.alvo, `${num(m.valor, 2)} ${m.unidade || ''}`, m.nivelAcao !== '' && m.nivelAcao != null ? num(m.nivelAcao, 2) : '-']));
    }

    P.secao('Colheita');
    if (!col.length) P.nada('Sem colheita registrada no período.');
    else P.tabela([{t: 'Data', w: 1.2}, {t: 'Peso (kg)', w: 1.4, dir: true}, {t: 'Sacas (60 kg)', w: 1.4, dir: true}, {t: 'Cultura', w: 1.6}],
      [...col.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(c => [fmtDate(c.date), num(c.kg), num(Math.round(Number(c.kg) / 60 * 10) / 10, 1), c.cultura || f.crop || '-']),
        ['Total', num(col.reduce((t, c) => t + Number(c.kg || 0), 0)), num(Math.round(sacas * 10) / 10, 1), area ? `${num(Math.round(sacas / area * 10) / 10, 1)} sc/ha` : '']]);

    P.assinaturas(assinaturasPadrao());
    const doc = P.finalizar();
    entregarPdf(doc, `mercaplant-safra-${semAcentoApp(f.name).replace(/[^a-z0-9]+/g, '-')}-${p.ini}-a-${p.fim}.pdf`, enviar === true, `Relatório da safra - ${texto(f.name)} - ${p.nome}`);
    return doc;
  }
  ACTIONS['safra-pdf'] = id => gerarSafra(id, false);
  ACTIONS['safra-pdf-enviar'] = id => gerarSafra(id, true);

  // ---------- Ticket do romaneio (comprovante da moega para o motorista e o dono da carga) ----------
  function gerarTicket(id, enviar = false) {
    const r = find('romaneios', id); if (!r) return showToast('Romaneio não encontrado', true);
    if (!window.jspdf?.jsPDF) return showToast('Gerador de PDF não carregou. Atualize a página.', true);
    const c = r.calc || calcRomaneio(r), cl = r.classif?.resultado, sc = v => `${num(v / 60, 2)} sc`;
    const P = pdfMercaPlant({titulo: `Romaneio de recebimento nº ${r.numero}`, linha2: `${fmtDate(r.date)} ${r.time || ''}`.trim(), continuacao: `Romaneio nº ${r.numero}`});
    P.secao('Resultado da carga');
    P.cartoes([['Peso líquido', `${num(c.liquido)} kg`, 'bruto - tara'], ['Descontos', `${num(c.descontoKg)} kg`, `${num(c.descontoPct, 2)}% do líquido`, COR.laranja], ['Peso final', `${num(c.pesoFinal)} kg`, sc(c.pesoFinal) + ' de 60 kg', COR.verdeEsc]]);
    P.secao('Carga');
    P.ficha([['Produto', nomeProd(r.produto, r.produtoNome)], ['Safra', r.season || ''], ['Dono do grão', r.dono === 'terceiro' ? `Terceiro - ${r.depositante}` : (db.settings.farm || 'Próprio')],
      ['Talhão de origem', fieldName(r.fieldId) || ''], ['Placa', r.placa || ''], ['Motorista', r.motorista || ''], ['Destino', nomeEquip(r.destinoId)], ['Amostra de contraprova', r.amostraRetida || '']]);
    P.secao('Pesagem');
    P.tabela([{t: 'Pesagem', w: 2}, {t: 'Data e hora', w: 1.6}, {t: 'Peso (kg)', w: 1.4, dir: true}],
      [['Bruto (caminhão cheio)', r.entrada ? fmtDH(r.entrada) : `${fmtDate(r.date)} ${r.time || ''}`, num(r.pesoBruto)], ['Tara (caminhão vazio)', r.saida ? fmtDH(r.saida) : '', num(r.tara)], ['Líquido', '', num(c.liquido)]]);
    P.secao('Amostra e descontos', r.metodoDesc === 'tabela' ? `Tabela: ${num(r.fatorUmid, 2)}% por ponto de umidade, ${num(r.fatorImp ?? 1, 2)}% por ponto de impureza` : 'Balanço de massa: desconta só o excesso de água e impureza sobre o padrão');
    P.tabela([{t: 'Item', w: 2.4}, {t: 'Medido', w: 1, dir: true}, {t: 'Padrão', w: 1, dir: true}, {t: 'Desconto (kg)', w: 1.3, dir: true}],
      [['Umidade', `${num(r.umidade, 1)}%`, `${num(r.umidadePadrao, 1)}%`, num(c.linhas.find(l => l.id === 'umidade')?.descontoKg || 0)],
        ...(r.impureza !== '' && r.impureza != null ? [['Impureza e matérias estranhas', `${num(r.impureza, 1)}%`, `${num(r.impurezaPadrao, 1)}%`, num(c.linhas.find(l => l.id === 'impureza')?.descontoKg || 0)]] : []),
        ...c.linhas.filter(l => !['umidade', 'impureza'].includes(l.id)).map(l => [l.rotulo, `${num(l.percentual, 2)}%`, '', num(l.descontoKg)]),
        ['Peso final (líquido e limpo)', '', '', `${num(c.pesoFinal)} = ${sc(c.pesoFinal)}`]]);
    if (cl) {
      P.secao('Classificação', cl.grupoRotulo || '');
      P.tabela([{t: 'Defeito', w: 3}, {t: '%', w: 1, dir: true}], [...Object.entries(r.classif.valores || {}).map(([k, x]) => [typeof rotuloDefeito === 'function' ? rotuloDefeito(r.produto, k) : k, num(x, 2)]), ['Enquadramento', cl.enquadramento || 'faltam defeitos']]);
      P.nota(cl.origem === 'fazenda' ? `Tabela da fazenda (${cl.fonte || ''}), não é norma oficial.` : `Tabela ${cl.tabelaId || ''} (MAPA). A classificação oficial é feita por classificador credenciado.`);
    }
    if (r.notes) { P.secao('Observações'); P.nota(r.notes); }
    P.assinaturas([[quemUsa?.() || db.settings.owner || 'Responsável', 'Balança / recebimento'], [r.motorista || 'Motorista', 'Motorista']]);
    const alt = (r.historico || []).filter(h => h.mudancas);
    if (alt.length) {
      P.espaco(12);
      alt.forEach(h => P.nota(`Alterado em ${fmtDH(h.em)} por ${h.por || '-'}: ${h.mudancas.map(m => `${m.campo} ${m.antes} -> ${m.depois}`).join('; ')}. Motivo: ${h.motivo || '-'}.`));
    }
    const doc = P.finalizar();
    entregarPdf(doc, `mercaplant-romaneio-${r.numero}-${(r.placa || '').replace(/\W/g, '').toLowerCase() || r.date}.pdf`, enviar === true, `Romaneio nº ${r.numero} - ${texto(nomeProd(r.produto, r.produtoNome))} - ${num(c.pesoFinal)} kg`);
    return doc;
  }
  window.gerarTicketRomaneio = gerarTicket;

  // ---------- Relatório da safra de grãos (moega, secador, silos e terceiros) ----------
  function gerarGraos(safra, enviar = false) {
    if (!window.jspdf?.jsPDF) return showToast('Gerador de PDF não carregou. Atualize a página.', true);
    const d = dadosSafraGraos(safra || undefined), verCustos = typeof relVerCustos !== 'function' || relVerCustos();
    const r1 = v => Math.round(v * 10) / 10, t = kg => `${num(r1(kg / 1000), 1)} t`, sc = kg => `${num(Math.round(kg / 60))} sc`, pc = v => `${num(r1(v), 1)}%`;
    const P = pdfMercaPlant({titulo: 'Relatório da safra de grãos', linha2: `${d.sf ? 'Safra ' + d.sf : 'Todas as cargas'} - até ${fmtDate(today())}`, continuacao: `Grãos${d.sf ? ' ' + d.sf : ''}`});
    const totRec = d.porProduto.reduce((a, p) => ({liq: a.liq + p.liq, fin: a.fin + p.fin, desc: a.desc + p.desc, cargas: a.cargas + p.cargas}), {liq: 0, fin: 0, desc: 0, cargas: 0});
    const saldoSilos = d.silos.reduce((a, s) => a + s.saldo, 0), capSilos = d.silos.reduce((a, s) => a + (s.cap || 0), 0);
    const aCobrar = d.terceiros.reduce((a, x) => a + x.total, 0);
    P.secao('Resumo');
    P.cartoes([
      ['Recebido', t(totRec.fin), `${totRec.cargas} cargas - ${sc(totRec.fin)}`],
      ['Descontos na moega', t(totRec.desc), `${pc(totRec.liq ? totRec.desc / totRec.liq * 100 : 0)} do líquido`, COR.laranja],
      ['Grão seco', t(d.sec.mf), `${d.sec.lotes} secagens - ${t(d.sec.agua)} de água`, COR.azul],
      ['Nos silos hoje', t(saldoSilos), capSilos ? `${num(Math.round(saldoSilos / capSilos * 100))}% da capacidade` : '', COR.verdeEsc],
      ...(verCustos && d.sec.custo ? [['Custo da secagem', brl(d.sec.custo), d.sec.mf ? `${brl(d.sec.custo / (d.sec.mf / 60))} por saca seca` : '', COR.laranja]] : []),
      ...(verCustos && d.terceiros.length ? [['Terceiros a cobrar', brl(aCobrar), `${d.terceiros.length} ${d.terceiros.length === 1 ? 'produtor' : 'produtores'}`]] : [])]);

    P.secao('Recebimento na moega', 'Peso final: líquido menos os descontos de umidade, impureza e outros');
    if (!totRec.cargas) P.nada('Nenhuma carga recebida nesta safra.');
    else {
      if (d.porProduto.length >= 2) P.grafico(d.porProduto.map(p => [p.nome, p.fin / 60]), {formato: v => `${num(Math.round(v))} sc`});
      P.tabela([{t: 'Produto', w: 1.6}, {t: 'Cargas', w: .8, dir: true}, {t: 'Líquido', w: 1.1, dir: true}, {t: 'Umidade média', w: 1.1, dir: true}, {t: 'Descontos', w: 1.3, dir: true}, {t: 'Peso final', w: 1.1, dir: true}, {t: 'Sacas', w: 1.1, dir: true}],
        [...d.porProduto.map(p => [p.nome, num(p.cargas), t(p.liq), p.uMedia != null ? pc(p.uMedia) : '-', `${t(p.desc)} (${pc(p.liq ? p.desc / p.liq * 100 : 0)})`, t(p.fin), sc(p.fin)]),
          ...(d.porProduto.length > 1 ? [['Total', num(totRec.cargas), t(totRec.liq), '', `${t(totRec.desc)} (${pc(totRec.liq ? totRec.desc / totRec.liq * 100 : 0)})`, t(totRec.fin), sc(totRec.fin)]] : [])]);
      if (d.porTalhao.length) {
        P.secao('Grão próprio por talhão');
        if (d.porTalhao.length >= 2) P.grafico(d.porTalhao.map(p => [p.nome, p.fin / 60]), {formato: v => `${num(Math.round(v))} sc`, corBarra: COR.verdeEsc});
        P.tabela([{t: 'Talhão', w: 2}, {t: 'Cargas', w: .8, dir: true}, {t: 'Líquido', w: 1.1, dir: true}, {t: 'Umidade média', w: 1.1, dir: true}, {t: 'Peso final', w: 1.1, dir: true}, {t: 'Sacas', w: 1.1, dir: true}],
          d.porTalhao.map(p => [p.nome, num(p.cargas), t(p.liq), p.uMedia != null ? pc(p.uMedia) : '-', t(p.fin), sc(p.fin)]));
      }
    }

    P.secao('Secagem', d.sec.massaMax != null ? `Maior temperatura da massa registrada: ${num(d.sec.massaMax)} °C` : '');
    if (!d.sec.lotes) P.nada('Nenhuma secagem concluída.');
    else P.tabela([{t: 'Produto', w: 1.5}, {t: 'Secagens', w: .9, dir: true}, {t: 'Entrada', w: 1.1, dir: true}, {t: 'Grão seco', w: 1.1, dir: true}, {t: 'Água retirada', w: 1.1, dir: true}, {t: 'Horas', w: .9, dir: true}, ...(verCustos ? [{t: 'Custo / saca', w: 1.1, dir: true}] : [])],
      [...d.secPorProd.map(p => [p.nome, num(p.lotes), t(p.mi), t(p.mf), t(p.agua), num(r1(p.h), 1), ...(verCustos ? [p.mf && p.custo ? brl(p.custo / (p.mf / 60)) : '-'] : [])]),
        ...(d.secPorProd.length > 1 ? [['Total', num(d.sec.lotes), t(d.sec.mi), t(d.sec.mf), t(d.sec.agua), num(r1(d.sec.h), 1), ...(verCustos ? [d.sec.mf && d.sec.custo ? brl(d.sec.custo / (d.sec.mf / 60)) : '-'] : [])]] : [])]);

    P.secao('Silos hoje');
    if (!d.silos.length) P.nada('Nenhum silo cadastrado.');
    else {
      const comCap = d.silos.filter(s => s.ocupacao != null);
      if (comCap.length >= 2) P.grafico(comCap.map(s => [s.nome, s.ocupacao]), {formato: v => pc(v), corBarra: COR.azul});
      P.tabela([{t: 'Silo', w: 1.8}, {t: 'Saldo', w: 1.1, dir: true}, {t: 'Sacas', w: 1.1, dir: true}, {t: 'Ocupação', w: .9, dir: true}, {t: 'Umidade', w: .9, dir: true}, {t: 'Temp. máx.', w: .9, dir: true}, {t: 'Último inventário', w: 1.5}],
        d.silos.map(s => [s.nome, t(s.saldo), sc(s.saldo), s.ocupacao != null ? pc(s.ocupacao) : '-', s.uMedia != null ? pc(s.uMedia) : '-', s.tMax != null ? `${num(r1(s.tMax), 1)} °C${s.insetos ? ' *' : ''}` : '-', s.inventario ? `${fmtDate(s.inventario.date)} (${pc(s.inventario.difPct)})` : '-']));
    }

    if (d.silos.some(s => s.insetos)) P.nota('* Insetos vivos na última vistoria de termometria.');
    P.nota(`Expedições de grão próprio: ${d.saidas.n ? `${d.saidas.n} ${d.saidas.n === 1 ? 'saída' : 'saídas'}, ${t(d.saidas.kg)} = ${sc(d.saidas.kg)}` : 'nenhuma'}${verCustos && d.vendas.n ? `; ${d.vendas.n} ${d.vendas.n === 1 ? 'venda lançada' : 'vendas lançadas'}, ${num(Math.round(d.vendas.sc))} sc, ${brl(d.vendas.valor)}` : ''}.`);

    if (d.terceiros.length) {
      P.secao('Grão de terceiros');
      P.tabela([{t: 'Produtor', w: 1.9}, {t: 'Recebido', w: 1, dir: true}, {t: 'Retirado', w: 1, dir: true}, {t: 'Quebra', w: .9, dir: true}, {t: 'Saldo', w: 1, dir: true}, ...(verCustos ? [{t: 'A cobrar', w: 1.1, dir: true}] : [])],
        d.terceiros.map(x => [x.nome, t(x.entrou), t(x.saiu), x.quebra >= .5 ? `${num(Math.round(x.quebra))} kg` : '-', t(x.saldo), ...(verCustos ? [brl(x.total)] : [])]));
    }

    const c = d.controle;
    P.secao('Controles e qualidade');
    P.ficha([['Cargas classificadas', `${c.classificados} de ${totRec.cargas}${c.foraTipo ? ` - ${c.foraTipo} fora de tipo` : ''}`],
      ['Romaneios alterados depois do registro', c.alterados ? `${c.alterados} (com motivo no histórico)` : 'nenhum'], ['Romaneios excluídos', c.excluidos ? `${c.excluidos} (registrados com motivo)` : 'nenhum'],
      ['Conferência do medidor de umidade', c.medidor ? `${fmtDate(c.medidor.date)} - erro médio ${num(c.medidor.erroMedio, 2)} ponto - ${c.medidor.ok ? 'dentro' : 'fora'} da tolerância` : 'não registrada'],
      ['Expurgos registrados', String(c.expurgos)], ['Inventários de silo', String(c.inventarios)]]);
    P.nota('Descontos pelo balanço de massa ou pela tabela do comprador informada em cada romaneio. Grão seco pelo balanço de água: Mf = Mi x (100 - Ui) / (100 - Uf). A classificação oficial é feita por classificador credenciado.');
    P.assinaturas(assinaturasPadrao());
    const doc = P.finalizar();
    entregarPdf(doc, `mercaplant-graos-${(d.sf || 'todas').replace(/[^0-9a-z]+/gi, '-')}.pdf`, enviar === true, `Relatório da safra de grãos${d.sf ? ' ' + d.sf : ''} - ${texto(db.settings.farm || '')}`);
    return doc;
  }
  window.gerarRelatorioGraos = gerarGraos;
  ACTIONS['graos-pdf'] = sf => gerarGraos(sf, false);
  ACTIONS['graos-pdf-enviar'] = sf => gerarGraos(sf, true);
  ACTIONS['gr-ticket'] = id => gerarTicket(id, false);
  ACTIONS['gr-ticket-enviar'] = id => gerarTicket(id, true);
})();
