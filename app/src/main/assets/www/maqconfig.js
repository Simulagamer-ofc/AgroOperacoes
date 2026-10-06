'use strict';
/* Configuração da máquina para aferição: parâmetros fixos (espaçamento de bicos, linhas, plataforma…) que as
   aferições reaproveitam. O catálogo do fabricante só SUGERE opções, com o texto original da ficha; o valor
   usado é sempre o que o usuário escolheu ou digitou, e a origem de cada um fica registrada. */

// Parâmetros por grupo. tipo: num (valor), faixa (mín–máx), texto.
const PARAMS_MAQ = {
  pulverizacao: {titulo: 'Pulverizador', itens: [
    ['espacamentoBicosM', 'Espaçamento entre bicos', 'm', 'num'],
    ['comprimentoBarraM', 'Comprimento da barra', 'm', 'num'],
    ['nBicos', 'Número de bicos na barra', 'bicos', 'num'],
    ['modeloPonta', 'Modelo da ponta em uso', '', 'texto'],
    ['faixaPressaoBar', 'Faixa de pressão do comando', 'bar', 'faixa'],
    ['faixaVelocidadeKmH', 'Velocidade de trabalho', 'km/h', 'faixa']]},
  plantio: {titulo: 'Plantadeira / semeadora / adubadora', itens: [
    ['nLinhas', 'Número de linhas', 'linhas', 'num'],
    ['espacamentoLinhasM', 'Espaçamento entre linhas', 'm', 'num'],
    ['faixaVelocidadeKmH', 'Velocidade de trabalho', 'km/h', 'faixa']]},
  distribuicao: {titulo: 'Distribuidor a lanço', itens: [
    ['larguraTrabalhoM', 'Largura de trabalho (faixa de aplicação)', 'm', 'num'],
    ['faixaVelocidadeKmH', 'Velocidade de trabalho', 'km/h', 'faixa']]},
  colheita: {titulo: 'Colheitadeira', itens: [
    ['larguraPlataformaM', 'Largura da plataforma', 'm', 'num']]}
};
const GRUPO_DO_TIPO_MAQ = {Pulverizador: ['pulverizacao'], Plantadeira: ['plantio'], Colheitadeira: ['colheita'], Implemento: ['distribuicao', 'plantio']};
const GRUPO_DO_TIPO_CAT = {pulverizacao: 'pulverizacao', plantio: 'plantio', distribuicao: 'distribuicao', colheita: 'colheita'};

// ---------- Leitura das fichas: números com unidade, sem inventar ----------
const UNID = {cm: 0.01, mm: 0.001, m: 1, in: 0.0254, pol: 0.0254, 'pés': 0.3048, pes: 0.3048, ft: 0.3048, psi: 0.0689476, bar: 1, 'km/h': 1, km: 1};
const numBR = t => /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t.replace(',', '.'));
const unidCampo = campo => { const m = semAcento(campo).match(/\((cm|mm|m|in\.?|pol|pes|ft|psi|bar|km\/h)[^)]*\)/); return m ? m[1].replace('.', '').replace('pes', 'pés') : ''; };
// Números “soltos” (não colados a letras, como 9L45 ou M12); sem unidade herdam a próxima unidade do texto ou a do campo
function numerosComUnidade(texto, unidadePadrao) {
  const re = /(?<![\wÀ-ú.,])(\d+(?:[.,]\d+)*)(?:\s*(cm|mm|m|in\.?|pol|pés|pes|ft|km\/h|km|mph|psi|bar|rpm))?(?![\wÀ-ú])/gi;
  const toks = [...texto.matchAll(re)].map(m => ({v: numBR(m[1]), u: (m[2] || '').toLowerCase().replace('.', ''), i: m.index}));
  for (let i = toks.length - 1; i >= 0; i--) if (!toks[i].u) toks[i].u = toks.slice(i + 1).find(t => t.u)?.u || unidadePadrao;
  return toks.filter(t => Number.isFinite(t.v) && t.u);
}
const arr2 = v => Math.round(v * 10000) / 10000; // metros com 4 casas: não perde 50,8 cm nem 7,62 m
const emMetros = toks => toks.filter(t => ['cm', 'mm', 'm', 'in', 'pol', 'pés', 'pes', 'ft'].includes(t.u)).map(t => arr2(t.v * UNID[t.u]));
// Faixas “2 a 6 km/h”, “6-10km/h”, “Até 12 km/h”, “30 a 75 psi”
function faixas(texto, unidades) {
  const out = [], re = /(?:(\d+(?:[.,]\d+)?)\s*(?:a|-|–)\s*|at[ée]\s*)(\d+(?:[.,]\d+)?)\s*(km\/h|km|psi|bar)?/gi;
  for (const m of texto.matchAll(re)) {
    const u = (m[3] || unidades[0] || '').toLowerCase();
    if (!unidades.includes(u)) continue;
    const f = UNID[u];
    out.push({min: m[1] ? Math.round(numBR(m[1]) * f * 10) / 10 : 0, max: Math.round(numBR(m[2]) * f * 10) / 10});
  }
  return out;
}

// Sugestões do catálogo para cada parâmetro: [{valor, rotulo, campo, trecho, par?}]
function sugestoesCatalogo(espec) {
  const s = {};
  const add = (k, valor, rotulo, campo, trecho, extra = {}) => {
    const l = (s[k] ||= []);
    if (!l.some(o => JSON.stringify(o.valor) === JSON.stringify(valor) && JSON.stringify(o.par) === JSON.stringify(extra.par))) l.push({valor, rotulo, campo, trecho, ...extra});
  };
  for (const [, campo, valor] of espec || []) {
    const c = semAcento(campo), uc = unidCampo(campo);
    if (c.includes('bico') && c.includes('espac')) {
      if (/ramal central|barra lateral/i.test(valor)) continue; // atomizadores: não é espaçamento uniforme de barra
      const ms = emMetros(numerosComUnidade(valor, uc || 'cm').filter(t => t.u !== 'in' || !/cm/.test(valor)));
      ms.forEach(v => add('espacamentoBicosM', v, `${num(v * 100, 1)} cm`, campo, valor));
    } else if (c.includes('espac') && c.includes('linha') || /^n[º°o.]? de linhas \d+ ?cm/.test(c) || c.startsWith('numero de linhas')) {
      // pares “27 x 45 cm” e “6 linhas: 50 cm”
      const pares = [...valor.matchAll(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*cm/gi), ...valor.matchAll(/(\d+)\s*linhas?\s*:\s*(\d+(?:[.,]\d+)?)\s*cm/gi)];
      if (pares.length) { pares.forEach(m => { const n = +m[1], e = arr2(numBR(m[2]) / 100); add('linhas', {nLinhas: n, espacamentoLinhasM: e}, `${n} linhas × ${num(e * 100, 0)} cm`, campo, valor); }); continue; }
      const nl = c.match(/de linhas (\d+) ?cm/);
      if (nl && /^\d+$/.test(valor.trim())) { add('linhas', {nLinhas: +valor.trim(), espacamentoLinhasM: arr2(+nl[1] / 100)}, `${valor.trim()} linhas × ${nl[1]} cm`, campo, valor); continue; }
      if (c.startsWith('numero de linhas')) { (valor.match(/\d+/g) || []).forEach(n => add('nLinhas', +n, `${n} linhas`, campo, valor)); continue; }
      emMetros(numerosComUnidade(valor, uc || 'cm')).forEach(v => add('espacamentoLinhasM', v, `${num(v * 100, 1)} cm`, campo, valor));
    } else if (c.includes('plataforma') && /largura|corte|tamanho/.test(c)) {
      const toks = numerosComUnidade(valor, uc || 'pés'), metr = toks.filter(t => t.u === 'm'), pes = toks.filter(t => ['pés', 'pes', 'ft'].includes(t.u));
      (metr.length ? metr.map(t => [arr2(t.v), pes.length === metr.length ? `${pes[metr.indexOf(t)].v} pés (${num(t.v, 2)} m)` : `${num(t.v, 2)} m`])
        : pes.map(t => [arr2(t.v * UNID.ft), `${t.v} pés (${num(t.v * UNID.ft, 2)} m)`])).forEach(([v, r]) => add('larguraPlataformaM', v, r, campo, valor));
    } else if (c.includes('barra') && /compriment|^barra$|opcoes de comprimento/.test(c) && !c.includes('tracao')) {
      const toks = numerosComUnidade(valor, uc || 'm'), m = toks.filter(t => t.u === 'm');
      (m.length ? m : toks.filter(t => ['ft'].includes(t.u)).map(t => ({v: t.v * UNID.ft, u: 'm'}))).forEach(t => add('comprimentoBarraM', arr2(t.v), `${num(t.v, 1)} m`, campo, valor));
    } else if (c.includes('velocidade') && /trabalho|pulveriz|operacao|plantio/.test(c) && !c.includes('rpm') && !c.includes('mph') && !c.includes('transporte')) {
      faixas(valor, ['km/h', 'km']).forEach(f => add('faixaVelocidadeKmH', f, `${num(f.min, 1)} a ${num(f.max, 1)} km/h`, campo, valor));
    } else if (c.includes('pressao') && /escala|faixa|trabalho/.test(c) && !c.includes('hidraul') && !c.includes('sistema')) {
      faixas(valor, ['psi', 'bar']).forEach(f => add('faixaPressaoBar', f, `${num(f.min, 1)} a ${num(f.max, 1)} bar`, campo, valor));
    } else if (/largura de trabalho|faixa de aplicacao|largura de aplicacao|faixa de distribuicao/.test(c) && !c.includes('mm')) {
      emMetros(numerosComUnidade(valor, uc || 'm')).forEach(v => add('larguraTrabalhoM', v, `${num(v, 2)} m`, campo, valor));
    }
  }
  return s;
}

// ---------- Leitura da configuração para as aferições ----------
const cfgValor = (m, k) => m?.config?.[k]?.valor;
function configDaMaquina(machineId) {
  const m = machineId ? find('machines', machineId) : null;
  return m?.config ? Object.fromEntries(Object.entries(m.config).map(([k, v]) => [k, v.valor])) : {};
}
const origemTexto = o => o?.origem === 'fabricante' ? `ficha do fabricante (${o.fonte})` : 'informado pelo usuário';

// Preenche, ao entrar na medição, só campos vazios — e marca a origem para mostrar na tela e no relatório
function aplicarConfigMaquina(w) {
  const m = w.machineId ? find('machines', w.machineId) : null;
  w._origem ||= {}; w._preenchidos ||= {};
  // Trocou de máquina: limpa o que veio da configuração da anterior (se o usuário não alterou), para não medir com o espaçamento errado
  if (w._cfgMaq !== undefined && w._cfgMaq !== w.machineId) {
    for (const [k, v] of Object.entries(w._preenchidos)) if (w[k] === v) { w[k] = ''; delete w._origem[k]; }
    w._preenchidos = {};
  }
  w._cfgMaq = w.machineId;
  if (!m?.config) return;
  const pre = (k, ck, conv = v => v) => { const v = cfgValor(m, ck); if (v != null && v !== '' && (w[k] == null || w[k] === '')) { w[k] = typeof v === 'number' ? String(conv(v)).replace('.', ',') : conv(v); w._origem[k] = ck; w._preenchidos[k] = w[k]; } };
  if (w.tipo === 'taxa') pre('espacamentoBicosM', 'espacamentoBicosM');
  if (w.tipo === 'bicos') pre('modeloPonta', 'modeloPonta');
  if (w.tipo === 'dose' && w.familia !== 'distribuidor_lanco') pre('espLinhasM', 'espacamentoLinhasM');
}
// Quantidade de campos de vazão = número de bicos da configuração (se houver)
const qtdBicosConfig = w => { const n = Number(cfgValor(w.machineId ? find('machines', w.machineId) : null, 'nBicos')); return n > 0 && n <= 150 ? Math.round(n) : null; };

// Avisos (nunca alteram o resultado): valores da medição fora da faixa da ficha/configuração
function avisosConfig(w) {
  const m = w.machineId ? find('machines', w.machineId) : null, out = [];
  if (!m?.config) return out;
  const fora = (v, f) => v != null && f && ((f.min != null && v < f.min) || (f.max != null && v > f.max));
  const vel = umNum(w.velocidadeKmH) ?? (umNum(w.distVel) > 0 && umNum(w.tempoVel) > 0 ? 3.6 * umNum(w.distVel) / umNum(w.tempoVel) : undefined);
  const fv = cfgValor(m, 'faixaVelocidadeKmH');
  if (fora(vel, fv)) out.push(`Velocidade ${num(vel, 1)} km/h fora da faixa de trabalho da configuração da máquina (${num(fv.min, 1)} a ${num(fv.max, 1)} km/h — ${origemTexto(m.config.faixaVelocidadeKmH)}).`);
  const fp = cfgValor(m, 'faixaPressaoBar'), pr = umNum(w.pressao);
  if (fora(pr, fp)) out.push(`Pressão ${num(pr, 1)} bar fora da faixa do comando (${num(fp.min, 1)} a ${num(fp.max, 1)} bar — ${origemTexto(m.config.faixaPressaoBar)}).`);
  const eb = cfgValor(m, 'espacamentoBicosM'), ebw = umNum(w.espacamentoBicosM);
  if (w.tipo === 'taxa' && eb && ebw && Math.abs(ebw - eb) > 0.001) out.push(`Espaçamento entre bicos usado (${num(ebw, 3)} m) diferente da configuração da máquina (${num(eb, 3)} m).`);
  const el = cfgValor(m, 'espacamentoLinhasM'), elw = umNum(w.espLinhasM);
  if (w.tipo === 'dose' && el && elw && Math.abs(elw - el) > 0.001) out.push(`Espaçamento entre linhas usado (${num(elw, 3)} m) diferente da configuração da máquina (${num(el, 3)} m).`);
  const nb = qtdBicosConfig(w), nv = numeros(w.vazoes).vals.length;
  if (w.tipo === 'bicos' && nb && nv && nv !== nb) out.push(`Foram medidos ${nv} bicos; a configuração da máquina tem ${nb}.`);
  return out;
}

// ---------- Tela: configuração da máquina ----------
let cfgEdit = null; // rascunho {param: {valor, origem, fonte}}
const VIEW_MAQUINAS_BASE = VIEWS.maquinas;
VIEWS.maquinas = arg => {
  if (arg && arg.startsWith('config~')) { setTimeout(() => telaConfig(arg.slice(7)), 0); return '<div class="empty">Carregando…</div>'; }
  return VIEW_MAQUINAS_BASE(arg);
};
async function telaConfig(id) {
  const rota = location.hash;
  const m = find('machines', id);
  if (!m) { view.innerHTML = empty('Máquina não encontrada', ''); return; }
  let sug = {}, modeloCat = null;
  if (m.catalogo?.fonte === 'fabricante') { try { modeloCat = await modeloPorId(m.catalogo.id); sug = sugestoesCatalogo(modeloCat?.especificacoes); } catch { /* sem catálogo offline */ } }
  if (!cfgEdit || cfgEdit._id !== id) cfgEdit = {_id: id, ...JSON.parse(JSON.stringify(m.config || {}))};
  let grupos = [...new Set([...(GRUPO_DO_TIPO_MAQ[m.type] || []), ...(modeloCat ? [GRUPO_DO_TIPO_CAT[(await dados('catalogo')).modelos.find(x => x.i === m.catalogo.id)?.t]] : [])].filter(Boolean))];
  if (!grupos.length || cfgEdit._todos) grupos = Object.keys(PARAMS_MAQ);
  const opc = (k, o) => `<button type="button" class="cfg-op ${JSON.stringify(cfgEdit[k]?.valor) === JSON.stringify(o.valor) ? 'on' : ''}" data-act="cfg-usar" data-id="${esc(k)}|${esc(JSON.stringify(o))}">${esc(o.rotulo)}</button>`;
  const linhaParam = ([k, rot, un, tipo]) => {
    const atual = cfgEdit[k], ops = sug[k] || [];
    const entrada = tipo === 'faixa'
      ? `<div class="cfg-faixa"><input data-cfg="${k}" data-parte="min" inputmode="decimal" value="${esc(atual?.valor?.min != null ? String(atual.valor.min).replace('.', ',') : '')}" placeholder="mín."><span>a</span><input data-cfg="${k}" data-parte="max" inputmode="decimal" value="${esc(atual?.valor?.max != null ? String(atual.valor.max).replace('.', ',') : '')}" placeholder="máx."></div>`
      : `<input data-cfg="${k}" ${tipo === 'num' ? 'inputmode="decimal"' : ''} value="${esc(atual?.valor != null ? String(atual.valor).replace('.', ',') : '')}">`;
    return `<div class="cfg-param"><label>${esc(rot)}${un ? ` <span class="af-un">(${esc(un)})</span>` : ''}</label>${entrada}
      ${atual ? `<small class="cfg-origem ${atual.origem}">${atual.origem === 'fabricante' ? '✓ da ficha do fabricante' : '✎ informado por você'}</small>` : ''}
      ${ops.length ? `<div class="cfg-ops"><span>Opções da ficha:</span>${ops.map(o => opc(k, o)).join('')}</div><small class="cfg-trecho">“${esc([...new Set(ops.map(o => `${o.campo}: ${o.trecho}`))].join(' • ').slice(0, 220))}”</small>` : ''}</div>`;
  };
  const blocoLinhas = sug.linhas?.length ? `<div class="cfg-param"><label>Configuração de linhas de fábrica</label><div class="cfg-ops"><span>Escolha a da sua máquina:</span>${sug.linhas.map(o => `<button type="button" class="cfg-op ${cfgEdit.nLinhas?.valor === o.valor.nLinhas && cfgEdit.espacamentoLinhasM?.valor === o.valor.espacamentoLinhasM ? 'on' : ''}" data-act="cfg-linhas" data-id="${esc(JSON.stringify(o))}">${esc(o.rotulo)}</button>`).join('')}</div><small class="cfg-trecho">“${esc([...new Set(sug.linhas.map(o => `${o.campo}: ${o.trecho}`))].join(' • ').slice(0, 220))}”</small></div>` : '';
  if (location.hash !== rota) return; // o usuário já saiu desta tela
  view.innerHTML = head(`Configuração para aferição — ${m.name}`, [m.type, m.catalogo ? `${m.catalogo.marca} ${m.catalogo.nome}` : m.model].filter(Boolean).join(' • '), btn('← Máquinas', 'nav', 'maquinas', 'secondary')) +
    `<section class="card panel"><p class="nota" style="margin-top:0">Estes dados são usados nas aferições desta máquina. ${modeloCat ? 'As opções vêm da ficha do fabricante (texto original abaixo de cada uma): <strong>toque na que corresponde à sua máquina</strong> — o app não escolhe sozinho.' : m.catalogo ? 'Esta máquina está vinculada à lista do BNDES, que não traz especificações: informe os valores.' : 'Vincule a máquina ao catálogo (menu ⋯) para ver as opções do fabricante, ou informe os valores.'}</p>
      ${grupos.map(g => `<h3 class="af-sec">${esc(PARAMS_MAQ[g].titulo)}</h3>${g === 'plantio' ? blocoLinhas : ''}<div class="cfg-lista">${PARAMS_MAQ[g].itens.map(linhaParam).join('')}</div>`).join('')}
      ${!cfgEdit._todos && grupos.length < Object.keys(PARAMS_MAQ).length ? '<button class="link" data-act="cfg-todos" style="margin-top:10px">Mostrar parâmetros de outros tipos de máquina</button>' : ''}
      <div class="actions"><button class="secondary" data-act="nav" data-id="maquinas">Cancelar</button><button class="primary" data-act="cfg-salvar" data-id="${esc(id)}">Salvar configuração</button></div></section>`;
}
// Lê os campos digitados para o rascunho (valor digitado ou alterado = origem “usuário”)
function coletarConfig() {
  const tipos = Object.fromEntries(Object.values(PARAMS_MAQ).flatMap(g => g.itens.map(i => [i[0], i[3]])));
  const vistos = new Set();
  $$('[data-cfg]').forEach(el => {
    const k = el.dataset.cfg; if (vistos.has(k)) return; vistos.add(k);
    let v;
    if (tipos[k] === 'faixa') { const mn = umNum($(`[data-cfg="${k}"][data-parte="min"]`).value), mx = umNum($(`[data-cfg="${k}"][data-parte="max"]`).value); v = mn == null && mx == null ? null : {min: mn ?? null, max: mx ?? null}; }
    else if (tipos[k] === 'num') v = umNum(el.value) ?? null;
    else v = el.value.trim() || null;
    if (v == null) { delete cfgEdit[k]; return; }
    if (JSON.stringify(cfgEdit[k]?.valor) !== JSON.stringify(v)) cfgEdit[k] = {valor: v, origem: 'usuario', data: today()};
  });
}
Object.assign(ACTIONS, {
  'mc-config': id => { cfgEdit = null; go('maquinas/config~' + id); },
  'cfg-usar': arg => {
    coletarConfig();
    const i = arg.indexOf('|'), k = arg.slice(0, i), o = JSON.parse(arg.slice(i + 1));
    cfgEdit[k] = {valor: o.valor, origem: 'fabricante', fonte: `${o.campo}: “${o.trecho}”`, data: today()};
    telaConfig(cfgEdit._id);
  },
  'cfg-linhas': arg => {
    coletarConfig();
    const o = JSON.parse(arg), fonte = `${o.campo}: “${o.trecho}”`;
    cfgEdit.nLinhas = {valor: o.valor.nLinhas, origem: 'fabricante', fonte, data: today()};
    cfgEdit.espacamentoLinhasM = {valor: o.valor.espacamentoLinhasM, origem: 'fabricante', fonte, data: today()};
    telaConfig(cfgEdit._id);
  },
  'cfg-todos': () => { coletarConfig(); cfgEdit._todos = true; telaConfig(cfgEdit._id); },
  'cfg-salvar': id => {
    coletarConfig();
    const m = find('machines', id), cfg = Object.fromEntries(Object.entries(cfgEdit).filter(([k]) => !k.startsWith('_')));
    const fp = cfg.faixaPressaoBar?.valor, fv = cfg.faixaVelocidadeKmH?.valor;
    for (const f of [fp, fv]) if (f && f.min != null && f.max != null && f.min > f.max) { showToast('Faixa inválida: o mínimo é maior que o máximo'); return; }
    m.config = cfg; save(); cfgEdit = null; showToast('Configuração salva'); go('maquinas');
  }
});
