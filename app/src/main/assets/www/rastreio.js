'use strict';
/* Etiqueta do lote de sementes com QR code (gerado no aparelho, sem internet) e resumo de rastreabilidade.
   O QR contém o texto da rastreabilidade: lê com qualquer leitor de QR, sem depender de servidor. */

function textoRastreio(l) {
  const f = find('fields', l.fieldId), ord = db.ubs.filter(o => o.lotId === l.id && o.status === 'Concluída').at(-1);
  const c = ord ? calcOrdem(ord) : null;
  const col = db.colheitas.filter(x => x.fieldId === l.fieldId && x.season === l.season);
  return [
    `Lote ${l.code}`,
    [l.species, l.cultivar, l.category && 'Cat. ' + l.category].filter(Boolean).join(' '),
    l.season && 'Safra ' + l.season,
    f && `Origem: ${f.name}${f.area ? ` (${num(f.area)} ha)` : ''}`,
    col.length && `Colheita: ${fmtDate(col[0].date)}`,
    c && `Beneficiamento: ${num(c.sacas)} sc de ${num(ord.registros.ensaque.kgPorSaca)} kg em ${fmtDate(ord.fim)}`,
    (l.germination !== '' && l.germination != null) && `Germinação ${num(l.germination)}%${l.vigor !== '' && l.vigor != null ? ` • Vigor ${num(l.vigor)}%` : ''}`,
    db.settings.farm && `Produtor: ${db.settings.farm}`
  ].filter(Boolean).join('\n');
}

function qrSvg(texto) {
  if (typeof qrcode !== 'function') return '';
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, 'M'); q.addData(texto, 'Byte'); q.make();
  return q.createSvgTag({cellSize: 4, margin: 2, scalable: true});
}

VIEWS.etiqueta = id => {
  const l = find('lots', id); if (!l) return empty('Lote não encontrado', '');
  const txt = textoRastreio(l), linhas = txt.split('\n');
  return `<div class="no-print">${head(`Etiqueta — lote ${l.code}`, 'Imprima e cole na sacaria ou no big bag. O QR code traz a rastreabilidade do lote.', btn('← Lote', 'nav', 'lotes/' + l.id, 'secondary') + btn('Imprimir', 'af-imprimir'))}</div>
    <section class="etiquetas">${[0, 1].map(() => `<article class="etiqueta"><div class="et-qr" role="img" aria-label="QR code do lote ${esc(l.code)}">${qrSvg(txt)}</div>
      <div class="et-txt"><strong>${esc(linhas[0])}</strong>${linhas.slice(1).map(x => `<span>${esc(x)}</span>`).join('')}</div></article>`).join('')}</section>
    <p class="nota no-print">Conteúdo do QR code (texto, sem link): ${esc(txt.replace(/\n/g, ' • '))}</p>`;
};
TITLES.etiqueta = 'Etiqueta do lote';
