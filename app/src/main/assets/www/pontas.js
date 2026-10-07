'use strict';
/* Catálogo offline de pontas de pulverização: vazão (L/min) por fabricante × linha × tamanho × pressão,
   copiada das tabelas dos catálogos oficiais, com a fonte e a página de cada linha.
   Na aferição de bicos o valor só é SUGERIDO, e somente quando a pressão da coleta consta da tabela
   (não há interpolação nem conversão pela raiz da pressão). O usuário confirma antes de usar. */

ARQ.pontas = 'dados/pontas.json';
const chaveBar = p => String(Math.round(Number(p) * 100) / 100); // "3", "1.5", "2.75"
const barTxt = p => num(Number(p), Number(p) % 1 ? 1 : 0).replace(/,0$/, '');
const linhaPonta = (d, fab, lin) => d.fabricantes.find(f => f.id === fab)?.linhas.find(l => l.id === lin);
const fonteDaLinha = (fab, l) => fab.fontes.find(f => f.id === l.fonte) || {};
const pressoesDe = t => Object.keys(t.vazoes).map(Number).sort((a, b) => a - b);

// ---------- Aferição de bicos: escolher a ponta e confirmar a vazão ----------
async function montarSeletorPonta() {
  const box = $('#pontaCat'); if (!box || wz?.tipo !== 'bicos') return;
  let d;
  try { d = await dados('pontas'); } catch { box.innerHTML = '<p class="nota">Catálogo de pontas indisponível offline neste aparelho.</p>'; return; }
  if (!box.isConnected || wz?.tipo !== 'bicos') return;
  const fab = d.fabricantes.find(f => f.id === wz.pontaFab), lin = fab && linhaPonta(d, fab.id, wz.pontaLinha), tam = lin?.tamanhos.find(t => t.codigo === wz.pontaTam);
  const op = (v, t, s) => `<option value="${esc(v)}" ${v === s ? 'selected' : ''}>${esc(t)}</option>`;
  box.innerHTML = `<details class="pc-box" ${wz.pontaFab ? 'open' : ''}><summary>Buscar a vazão no catálogo de pontas (${d.fabricantes.length} fabricantes)</summary>
    <div class="pc-sel">
      <select id="pcFab" aria-label="Fabricante da ponta"><option value="">Fabricante</option>${d.fabricantes.map(f => op(f.id, f.nome, wz.pontaFab)).join('')}</select>
      <select id="pcLinha" aria-label="Linha da ponta" ${fab ? '' : 'disabled'}><option value="">Linha / modelo</option>${(fab?.linhas || []).map(l => op(l.id, l.linha + (l.tipo ? ' — ' + l.tipo : ''), wz.pontaLinha)).join('')}</select>
      <select id="pcTam" aria-label="Tamanho da ponta" ${lin ? '' : 'disabled'}><option value="">Tamanho</option>${(lin?.tamanhos || []).map(t => op(t.codigo, t.codigo + (t.corIso ? ' (' + t.corIso + ')' : ''), wz.pontaTam)).join('')}</select>
    </div><div id="pcRes">${tam ? resultadoPonta(fab, lin, tam) : ''}</div></details>`;
  const muda = (k, limpar) => e => { wz[k] = e.target.value; limpar.forEach(x => { wz[x] = ''; }); montarSeletorPonta(); };
  $('#pcFab').onchange = muda('pontaFab', ['pontaLinha', 'pontaTam']);
  $('#pcLinha').onchange = muda('pontaLinha', ['pontaTam']);
  $('#pcTam').onchange = muda('pontaTam', []);
}

function resultadoPonta(fab, lin, tam) {
  const pres = umNum($('#wz_pressao')?.value ?? wz.pressao), fonte = fonteDaLinha(fab, lin), ps = pressoesDe(tam);
  const v = pres > 0 ? tam.vazoes[chaveBar(pres)] : undefined;
  const faixa = lin.faixaPressaoRecomendadaBar;
  const tabela = `<div class="pc-linha">${ps.map(p => `<span class="${pres > 0 && chaveBar(p) === chaveBar(pres) ? 'sel' : ''}"><small>${barTxt(p)} bar</small>${num(tam.vazoes[chaveBar(p)], 2)}</span>`).join('')}</div>`;
  const ref = `${esc(fab.nome)} ${esc(lin.linha)} ${esc(tam.codigo)} — ${esc(fonte.titulo || 'catálogo do fabricante')}${fonte.ano ? ' (' + fonte.ano + ')' : ''}${lin.pagina ? ', p. ' + esc(String(lin.pagina)) : ''}`;
  let msg;
  if (!(pres > 0)) msg = '<p class="nota">Informe a pressão da coleta acima para ver a vazão da tabela.</p>';
  else if (v === undefined) msg = `<p class="pc-aviso">A pressão de ${num(pres, 2)} bar não está na tabela desta ponta. Pressões tabeladas: ${ps.map(barTxt).join(', ')} bar. Colete numa delas ou digite a vazão de outra fonte — o app não estima valores fora da tabela.</p>`;
  else {
    const fora = faixa && (pres < faixa[0] || pres > faixa[1]);
    const usado = wz.fonteVazao && wz.fonteVazao.vazao === v && wz.fonteVazao.pressaoBar === pres && wz.fonteVazao.tamanho === tam.codigo && wz.fonteVazao.linha === lin.linha;
    msg = `<div class="pc-sug"><div><span>Vazão na tabela a ${num(pres, 2)} bar</span><b>${num(v, 2)} L/min</b><small>${ref}</small></div>
      ${usado ? '<span class="chip green">✓ Em uso</span>' : `<button type="button" class="primary" data-act="pc-usar" data-id="${esc(String(v))}">Usar ${num(v, 2)} L/min</button>`}</div>
      ${fora ? `<p class="pc-aviso">${num(pres, 2)} bar está fora da faixa recomendada pelo fabricante para esta linha (${barTxt(faixa[0])} a ${barTxt(faixa[1])} bar).</p>` : ''}`;
  }
  return tabela + msg + (lin.preOrificioOuInducao ? '<p class="nota">Ponta com pré-orifício ou indução de ar: use apenas os valores da tabela (a fórmula da raiz da pressão não vale para ela).</p>' : '') +
    (fonte.url ? `<p class="nota">Fonte: <a href="${esc(fonte.url)}" target="_blank" rel="noopener">${esc(fonte.titulo || fonte.url)}</a>. Confira a referência da ponta gravada no corpo dela.</p>` : '');
}

// ---------- Tela de consulta ----------
VIEWS.pontas = arg => { setTimeout(() => telaPontas(arg), 0); return `<div id="pcTela">${head('Catálogo de pontas', 'Carregando…')}</div>`; };
TITLES.pontas = 'Catálogo de pontas';
async function telaPontas(arg) {
  const el = $('#pcTela'); if (!el) return;
  let d;
  try { d = await dados('pontas'); } catch { el.innerHTML = head('Catálogo de pontas', '') + empty('Catálogo indisponível', 'Não foi possível carregar os dados offline.'); return; }
  if (!el.isConnected) return;
  const [fid, lid] = (arg || '').split('~').map(decodeURIComponent), fab = d.fabricantes.find(f => f.id === fid);
  if (fab && lid) {
    const lin = linhaPonta(d, fid, lid); if (!lin) { el.innerHTML = empty('Linha não encontrada', ''); return; }
    const ps = [...new Set(lin.tamanhos.flatMap(pressoesDe))].sort((a, b) => a - b), fonte = fonteDaLinha(fab, lin);
    el.innerHTML = head(`${fab.nome} ${lin.linha}`, [lin.tipo, lin.angulos?.length ? 'ângulos ' + lin.angulos.join('°, ') + '°' : '', lin.faixaPressaoRecomendadaBar ? `faixa recomendada ${barTxt(lin.faixaPressaoRecomendadaBar[0])}–${barTxt(lin.faixaPressaoRecomendadaBar[1])} bar` : ''].filter(Boolean).join(' • '), btn('← ' + fab.nome, 'nav', 'pontas/' + encodeURIComponent(fab.id), 'secondary')) +
      `<section class="card panel"><p class="nota" style="margin-top:0">Vazão por ponta, em L/min, conforme a tabela do fabricante. Células vazias: pressão não tabelada para esse tamanho.</p>
      <div class="tbl-wrap"><table class="tbl pc-tab"><thead><tr><th>Tamanho</th>${ps.map(p => `<th class="num">${barTxt(p)} bar</th>`).join('')}</tr></thead><tbody>
      ${lin.tamanhos.map(t => `<tr><td><strong>${esc(t.codigo)}</strong>${t.corIso ? `<br><small>${esc(t.corIso)}</small>` : ''}</td>${ps.map(p => `<td class="num">${t.vazoes[chaveBar(p)] != null ? num(t.vazoes[chaveBar(p)], 2) : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <p class="nota">Fonte: ${fonte.url ? `<a href="${esc(fonte.url)}" target="_blank" rel="noopener">${esc(fonte.titulo || fonte.url)}</a>` : esc(fonte.titulo || '—')}${fonte.ano ? ' (' + fonte.ano + ')' : ''}${lin.pagina ? ', página ' + esc(String(lin.pagina)) : ''}.${lin.preOrificioOuInducao ? ' Ponta com pré-orifício ou indução de ar: use só os valores tabelados.' : ''}</p></section>`;
    return;
  }
  if (fab) {
    el.innerHTML = head(fab.nome, `${fab.linhas.length} ${fab.linhas.length === 1 ? 'linha' : 'linhas'} de pontas`, btn('← Fabricantes', 'nav', 'pontas', 'secondary')) +
      `<div class="pc-grade">${fab.linhas.map(l => `<button class="card pc-card" data-act="nav" data-id="pontas/${esc(encodeURIComponent(fab.id) + '~' + encodeURIComponent(l.id))}"><strong>${esc(l.linha)}</strong><small>${esc(l.tipo || '')}</small><small>${l.tamanhos.length} tamanhos • ${pressoesDe(l.tamanhos[0]).length ? barTxt(Math.min(...l.tamanhos.flatMap(pressoesDe))) + '–' + barTxt(Math.max(...l.tamanhos.flatMap(pressoesDe))) + ' bar' : ''}</small></button>`).join('')}</div>
      <section class="card panel"><h3>Fontes</h3><ul class="pc-fontes">${fab.fontes.map(f => `<li>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.titulo)}</a>` : esc(f.titulo)}${f.ano ? ' (' + f.ano + ')' : ''}</li>`).join('')}</ul></section>`;
    return;
  }
  const nLin = d.fabricantes.reduce((s, f) => s + f.linhas.length, 0), nTam = d.fabricantes.reduce((s, f) => s + f.linhas.reduce((a, l) => a + l.tamanhos.length, 0), 0);
  el.innerHTML = head('Catálogo de pontas', `${d.fabricantes.length} fabricantes • ${nLin} linhas • ${nTam} tamanhos • funciona sem internet`, btn('← Aferição', 'nav', 'afericao', 'secondary')) +
    `<div class="pc-grade">${d.fabricantes.map(f => `<button class="card pc-card" data-act="nav" data-id="pontas/${esc(encodeURIComponent(f.id))}"><strong>${esc(f.nome)}</strong><small>${f.linhas.length} ${f.linhas.length === 1 ? 'linha' : 'linhas'}: ${esc(f.linhas.slice(0, 5).map(l => l.linha).join(', '))}${f.linhas.length > 5 ? '…' : ''}</small></button>`).join('')}</div>
    <p class="nota">${esc(d.aviso || '')}</p>`;
}

Object.assign(ACTIONS, {
  'pc-usar': v => {
    const d = DADOS.pontas; if (!d) return;
    d.then(c => {
      const fab = c.fabricantes.find(f => f.id === wz.pontaFab), lin = fab && linhaPonta(c, fab.id, wz.pontaLinha), tam = lin?.tamanhos.find(t => t.codigo === wz.pontaTam);
      const pres = umNum($('#wz_pressao')?.value), vaz = Number(v);
      if (!tam || !(pres > 0) || tam.vazoes[chaveBar(pres)] !== vaz) return showToast('Confira a pressão e a ponta escolhidas');
      coletarWizard();
      const fonte = fonteDaLinha(fab, lin);
      wz.vazaoCatalogo = String(vaz).replace('.', ',');
      if (!wz.modeloPonta) wz.modeloPonta = `${fab.nome} ${lin.linha} ${tam.codigo}`;
      wz.fonteVazao = {fabricante: fab.nome, linha: lin.linha, tamanho: tam.codigo, pressaoBar: pres, vazao: vaz, fonte: fonte.titulo || '', url: fonte.url || '', ano: fonte.ano || '', pagina: lin.pagina || '', catalogoVersao: c.versao};
      render(); showToast(`Vazão da tabela: ${num(vaz, 2)} L/min`);
    });
  }
});
// Pressão alterada: refaz a consulta (a vazão sugerida depende dela)
document.addEventListener('input', e => { if (e.target.id === 'wz_pressao' && $('#pcRes') && wz?.pontaTam) { clearTimeout(resultadoPonta.t); resultadoPonta.t = setTimeout(montarSeletorPonta, 250); } });
