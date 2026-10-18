/* Relatório local, inclusive offline. jsPDF 4.2.1 (MIT), distribuído em lib/. */
(() => {
  function gerar() {
    if (typeof nvPodeRota === 'function' && !nvPodeRota('relatorios')) {
      showToast('Sua função não permite acessar os relatórios.', true); return;
    }
    const r = dadosRelatorio();
    const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
    const fim = today();
    let y = 22;
    doc.setProperties({title: 'Relatório da propriedade - MercaPlant', author: db.settings.farm || 'MercaPlant'});
    const texto = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/—|–/g, '-');
    function linha(valor, tamanho = 10, negrito = false) {
      doc.setFont('helvetica', negrito ? 'bold' : 'normal');
      doc.setFontSize(tamanho);
      const linhas = doc.splitTextToSize(texto(valor), 174);
      for (const l of linhas) {
        if (y > 274) { doc.addPage(); y = 22; }
        doc.text(l, 18, y); y += tamanho * .48 + 1;
      }
    }
    function secao(titulo) {
      if (y > 252) { doc.addPage(); y = 22; }
      y += 5; doc.setTextColor(15, 70, 85); linha(titulo, 12, true); doc.setTextColor(30, 40, 45); y += 2;
    }
    linha('MERCAPLANT', 18, true);
    linha('Relatório da propriedade', 14, true);
    linha(db.settings.farm || 'Propriedade não informada', 12);
    linha(`Período: ${fmtDate(r.from)} a ${fmtDate(fim)} (${reportDays} dias)`);
    linha(`Emitido em ${new Date().toLocaleString('pt-BR')}`);
    if (db.settings.owner) linha(`Responsável: ${db.settings.owner}`);
    secao('Resumo do período');
    linha(`Operações: ${r.ops.length} | Concluídas: ${r.ops.filter(o => o.status === 'Concluída').length}`);
    linha(`Área trabalhada: ${num(r.area)} ha em operações concluídas`);
    linha(`Horas de máquina: ${num(r.hoursBy.reduce((s, [, h]) => s + h, 0))} h`);
    if (typeof relVerCustos !== 'function' || relVerCustos()) {
      linha(`Manutenção: R$ ${num(r.maintCost, 2)} (${r.custosManut.length} ordens concluídas com custo)`);
      linha(`Outros gastos: R$ ${num(r.outrosGastos, 2)}`);
    }
    secao('Operações por tipo');
    if (!r.byType.length) linha('Sem operações no período.');
    r.byType.forEach(([tipo, lista]) => linha(`${tipo}: ${lista.length}`));
    secao('Horas trabalhadas por máquina');
    if (!r.hoursBy.length) linha('Sem registros de horímetro no período.');
    r.hoursBy.forEach(([m, h]) => linha(`${m.name}: ${num(h)} h`));
    secao('Consumo de insumos');
    if (!r.consumption.length) linha('Nenhuma saída de estoque no período.');
    r.consumption.forEach(([s, q]) => linha(`${s.name}: ${num(q)} ${s.unit || ''} | Saldo atual: ${num(s.qty)} ${s.unit || ''}`));
    secao('Detalhamento das operações');
    if (!r.ops.length) linha('Sem operações no período.');
    r.ops.slice().sort(byDateDesc).forEach(o => {
      if (y > 250) { doc.addPage(); y = 22; }
      linha(`${fmtDate(o.date)} - ${o.type} - ${o.status}`, 10, true);
      linha(`Local: ${opPlace(o) || '-'} | Máquina: ${machineName(o.machineId) || '-'}`);
      if (opTemArea(o)) linha(`Área: ${num(o.area || 0)} ha`);
      if (o.operator) linha(`Operador: ${o.operator}`);
      if (o.notes) linha(`Observações: ${o.notes}`);
      y += 3;
    });
    if (db.settings.respTecnico) {
      secao('Responsável técnico');
      linha([db.settings.respTecnico, db.settings.respRegistro].filter(Boolean).join(' - '));
    }
    const paginas = doc.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
      doc.text(`MercaPlant | ${fmtDate(r.from)} a ${fmtDate(fim)}`, 18, 287);
      doc.text(`${p} / ${paginas}`, 192, 287, {align: 'right'});
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
  }
  ACTIONS['relatorio-pdf'] = gerar;
})();
