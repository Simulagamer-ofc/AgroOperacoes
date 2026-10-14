'use strict';
/* Nexus Agro — comparativo entre safras e talhões: produtividade, custo por saca, margem e chuva lado a lado,
   com as conclusões escritas pelo app (melhor e pior talhão, tendência, talhão abaixo da média repetidas vezes).
   Usa os mesmos números da tela Produção e margem (analiseSafra). Custos e margem só para quem vê o financeiro. */

let cmpSafra = '';
// Safra “2025/26” → 01/07/2025 a 30/06/2026 (para somar a chuva do período)
const janelaSafra = s => { const m = String(s || '').match(/(\d{4})\s*\/\s*(\d{2,4})/); if (!m) return null; const a = Number(m[1]); return {ini: `${a}-07-01`, fim: `${a + 1}-06-30`}; };
// Chuva da safra: média entre os pluviômetros com registro no período (cada local soma os seus)
function chuvaSafra(s) {
  const j = janelaSafra(s); if (!j) return null;
  const porLocal = {}; db.chuvas.filter(c => (c.date || '') >= j.ini && (c.date || '') <= j.fim).forEach(c => { const k = c.fieldId || ''; porLocal[k] = (porLocal[k] || 0) + (Number(c.mm) || 0); });
  const v = Object.values(porLocal); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null;
}
function resumoSafra(s) {
  const a = analiseSafra(s), col = a.linhas.filter(l => l.sacas > 0);
  const area = col.reduce((t, l) => t + l.area, 0), sacas = col.reduce((t, l) => t + l.sacas, 0), custo = col.reduce((t, l) => t + l.custo, 0);
  const comMargem = col.filter(l => l.margem != null), areaM = comMargem.reduce((t, l) => t + l.area, 0);
  return {s, a, col, area, sacas, scha: area ? sacas / area : null, custoSc: sacas && custo > 0 ? custo / sacas : null, margemHa: areaM ? comMargem.reduce((t, l) => t + l.margem, 0) / areaM : null, chuva: chuvaSafra(s)};
}
const pct = (a, b) => b ? (a - b) / b * 100 : null;
const setaVar = v => v == null ? '' : `<small class="cmp-var ${v >= 0 ? 'sobe' : 'desce'}">${v >= 0 ? '▲' : '▼'} ${um1(Math.abs(v))}%</small>`;

VIEWS.comparativo = () => {
  const fin = typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
  const brl = v => v == null ? '—' : `${v < 0 ? '− ' : ''}R$ ${num(Math.abs(v), 2)}`;
  const safras = safrasConhecidas().slice(0, 6).reverse(); // da mais antiga para a mais nova
  const rs = safras.map(resumoSafra).filter(r => r.col.length);
  if (!rs.length) return head('Comparativo de safras', 'Produtividade, custo e chuva por safra e por talhão', btn('← Produção', 'nav', 'producao', 'secondary')) +
    `<section class="card">${empty('Sem colheitas registradas', 'Registre a colheita dos talhões em Produção e margem para comparar safras e talhões.', {act: 'nav', id: 'producao', label: 'Abrir Produção'})}</section>`;
  if (!cmpSafra || !rs.some(r => r.s === cmpSafra)) cmpSafra = rs[rs.length - 1].s;
  const atual = rs.find(r => r.s === cmpSafra), media = atual.scha;
  const ranking = atual.col.slice().sort((a, b) => b.scha - a.scha), max = Math.max(...ranking.map(l => l.scha));

  // Conclusões automáticas
  const ins = [];
  if (ranking.length >= 2) {
    const m = ranking[0], p = ranking[ranking.length - 1];
    ins.push(`<b>${esc(m.nome)}</b> foi o melhor talhão da safra ${esc(cmpSafra)}: ${um1(m.scha)} sc/ha, ${um1(pct(m.scha, media))}% acima da média da fazenda${fin && m.custo > 0 && atual.custoSc ? ` e custo por saca ${pct(m.custoSc, atual.custoSc) <= 0 ? um1(-pct(m.custoSc, atual.custoSc)) + '% menor' : um1(pct(m.custoSc, atual.custoSc)) + '% maior'}` : ''}.`);
    ins.push(`<b>${esc(p.nome)}</b> ficou ${um1(-pct(p.scha, media))}% abaixo da média (${um1(p.scha)} sc/ha): vale olhar solo, plantio e pragas desse talhão.`);
  }
  const ant = rs[rs.indexOf(atual) - 1];
  if (ant?.scha && atual.scha) ins.push(`Produtividade média ${atual.scha >= ant.scha ? 'subiu' : 'caiu'} ${um1(Math.abs(pct(atual.scha, ant.scha)))}% em relação à safra ${esc(ant.s)} (${um1(ant.scha)} → ${um1(atual.scha)} sc/ha)${atual.chuva != null && ant.chuva != null ? `, com ${num(atual.chuva, 0)} mm de chuva contra ${num(ant.chuva, 0)} mm` : ''}.`);
  if (fin && ant?.custoSc && atual.custoSc) ins.push(`Custo por saca ${atual.custoSc <= ant.custoSc ? 'caiu' : 'subiu'} ${um1(Math.abs(pct(atual.custoSc, ant.custoSc)))}% (${brl(ant.custoSc)} → ${brl(atual.custoSc)}).`);
  // Talhões abaixo da média em 2 safras ou mais
  const abaixo = {}; rs.forEach(r => r.col.forEach(l => { if (r.scha && l.scha < r.scha * 0.95) abaixo[l.nome] = (abaixo[l.nome] || 0) + 1; }));
  Object.entries(abaixo).filter(([, n]) => n >= 2).forEach(([nome, n]) => ins.push(`<b>${esc(nome)}</b> ficou abaixo da média da fazenda em ${n} safras: problema que se repete (fertilidade, compactação, drenagem ou manejo).`));

  // Talhão × safra (sc/ha)
  const nomes = [...new Set(rs.flatMap(r => r.col.map(l => l.nome)))].sort((a, b) => a.localeCompare(b, 'pt-BR', {numeric: true}));
  return head('Comparativo de safras', 'Produtividade, custo e chuva por safra e por talhão', btn('← Produção', 'nav', 'producao', 'secondary')) +
    (ins.length ? `<section class="card panel cmp-insights"><h3>O que os números mostram</h3><ul>${ins.map(t => `<li>${t}</li>`).join('')}</ul></section>` : '') +
    `<div class="section-title"><h3>Safra a safra</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Safra</th><th class="num">Área colhida</th><th class="num">Produção</th><th class="num">sc/ha</th>${fin ? '<th class="num">Custo/sc</th><th class="num">Margem/ha</th>' : ''}<th class="num">Chuva</th></tr></thead><tbody>
      ${rs.map((r, i) => `<tr class="${r.s === cmpSafra ? 'cmp-atual' : ''}"><td><strong>${esc(r.s)}</strong></td><td class="num">${num(r.area)} ha</td><td class="num">${num(r.sacas, 0)} sc</td><td class="num">${r.scha != null ? um1(r.scha) : '—'} ${setaVar(i ? pct(r.scha, rs[i - 1].scha) : null)}</td>${fin ? `<td class="num">${brl(r.custoSc)}</td><td class="num">${brl(r.margemHa)}</td>` : ''}<td class="num">${r.chuva != null ? num(r.chuva, 0) + ' mm' : '—'}</td></tr>`).join('')}
    </tbody></table></div></section>
    <div class="section-title"><h3>Talhões na safra</h3></div>
    <div class="filters">${rs.map(r => `<button class="${r.s === cmpSafra ? 'active' : ''}" data-act="cmp-safra" data-id="${esc(r.s)}">${esc(r.s)}</button>`).join('')}</div>
    <section class="card panel cmp-ranking">${ranking.map(l => `<div class="cmp-linha"><div class="cmp-nome"><strong>${esc(l.nome)}</strong><small>${esc([l.cultura, num(l.area) + ' ha'].filter(Boolean).join(' • '))}</small></div>
      <div class="cmp-barra"><span class="${l.scha >= media ? 'acima' : 'abaixo'}" style="width:${max ? Math.max(4, l.scha / max * 100) : 0}%"></span><b>${um1(l.scha)} sc/ha</b></div>
      <div class="cmp-extra">${setaVar(pct(l.scha, media))}${fin && l.custo > 0 ? `<small>${brl(l.custoSc)}/sc</small>` : ''}</div></div>`).join('')}
      <p class="nota">Barra verde: acima da média da fazenda na safra (${um1(media)} sc/ha); laranja: abaixo.</p></section>
    ${rs.length > 1 ? `<div class="section-title"><h3>Cada talhão ao longo das safras (sc/ha)</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Talhão</th>${rs.map(r => `<th class="num">${esc(r.s)}</th>`).join('')}</tr></thead><tbody>
      ${nomes.map(n => `<tr><td><strong>${esc(n)}</strong></td>${rs.map(r => { const l = r.col.find(x => x.nome === n); return `<td class="num ${l && r.scha ? (l.scha >= r.scha ? 'cmp-bom' : 'cmp-ruim') : ''}">${l ? um1(l.scha) : '—'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div><p class="nota">Verde: acima da média da fazenda naquela safra; laranja: abaixo.</p></section>` : ''}
    <p class="nota">Mesmos números de Produção e margem (colheita, custos lançados no talhão e insumos aplicados, preço médio das vendas). Chuva: média dos pluviômetros com registro de julho a junho.</p>`;
};
TITLES.comparativo = 'Comparativo de safras';
ACTIONS['cmp-safra'] = id => { cmpSafra = id; render(); };
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.comparativo = 'producao';
