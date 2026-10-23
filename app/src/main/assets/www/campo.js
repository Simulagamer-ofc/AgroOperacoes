'use strict';
/* Campo: chuvas (pluviômetro), monitoramento de pragas (MIP), aplicações com carência e mão de obra.
   Nenhum nível de controle, carência ou dose é sugerido pelo app: vêm da recomendação técnica e da bula informadas pelo usuário. */

const talhaoOuGeral = id => id ? (fieldName(id) || 'Talhão removido') : 'Sede / geral';
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

// ---------------- Chuvas ----------------
// Estimativa da chuva pela previsão do tempo (média dos modelos, local da fazenda) entre a leitura anterior do mesmo
// pluviômetro (até 3 dias antes) — ou as 24 h anteriores — e a hora desta leitura. É só um ponto de partida: confira no pluviômetro.
function chuvaEstimada(data, hora, fieldId) {
  const c = typeof lerClima === 'function' ? lerClima() : null, h = c?.dados?.hourly;
  if (!h?.time?.length || !h.precipitation || !data) return null;
  const fim = `${data}T${(hora || nowTime()).slice(0, 2)}:00`;
  const ant = db.chuvas.filter(x => (x.fieldId || '') === (fieldId || '') && `${x.date}T${x.hora || '07:00'}` < `${data}T${hora || '23:59'}`).map(x => `${x.date}T${(x.hora || '07:00').slice(0, 2)}:00`).sort().at(-1);
  const d24 = new Date(fim + ':00'); d24.setHours(d24.getHours() - 24);
  const ini24 = `${isoDate(d24)}T${String(d24.getHours()).padStart(2, '0')}:00`;
  const d72 = new Date(fim + ':00'); d72.setHours(d72.getHours() - 72);
  let ini = ant && ant >= `${isoDate(d72)}T${String(d72.getHours()).padStart(2, '0')}:00` ? ant : ini24, desdeLeitura = ini === ant;
  if (ini < h.time[0]) ini = h.time[0];
  if (fim <= h.time[0] || fim > h.time.at(-1)) return null;
  let mm = 0, n = 0;
  h.time.forEach((t, i) => { if (t > ini && t <= fim) { mm += Number(h.precipitation[i]) || 0; n++; } });
  if (!n) return null;
  return {mm: Math.round(mm * 10) / 10, ini, fim, desdeLeitura, atualizada: c.em};
}
const fmtDiaHoraChuva = iso => `${fmtDate(iso.slice(0, 10)).slice(0, 5)} ${iso.slice(11, 13)}h`;
function chuvaForm(valores = {}) {
  const manual = valores.mm != null && valores.mm !== '';
  openForm({title: 'Registrar chuva', sub: 'Leitura do pluviômetro (mm). Sem talhão = pluviômetro da sede.', values: {date: today(), hora: valores.notes ? '' : nowTime(), ...valores},
    fields: [{k: 'date', label: 'Data da leitura', type: 'date', required: true}, {k: 'hora', label: 'Hora da leitura', type: 'time', hint: 'Já vem com a hora de agora; ajuste se leu o pluviômetro antes.'},
      {k: 'mm', label: 'Chuva (mm)', type: 'number', min: 0, required: true, hint: ' '},
      {k: 'fieldId', label: 'Talhão / pluviômetro', type: 'select', options: fieldOptions}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => { if (!(v.mm >= 0)) return 'Informe os milímetros';
      if (v.mm > 400) return 'Mais de 400 mm numa leitura: confira o valor';
      if (v.date > today() || (v.date === today() && v.hora && v.hora > nowTime())) return 'A leitura não pode ser no futuro: confira a data e a hora';
      // Repetido: mesmo local, mesmo dia e mesma hora (duas leituras no mesmo dia, em horas diferentes, valem)
      const dup = typeof conferirRepetido === 'function' ? conferirRepetido('chuvas', c => c.date === v.date && (c.fieldId || '') === (v.fieldId || '') && (c.hora || '') === (v.hora || ''), `já existe chuva registrada em ${fmtDate(v.date)}${v.hora ? ' às ' + v.hora : ''} neste local`) : ''; if (dup) return dup;
      // Valor da estimativa sem mudar = registro estimado (fica marcado); mudou = leitura do pluviômetro
      if (!mmMexido && $('#f_mm', dialog).value !== ultimoPreenchido) mmMexido = true;
      const est = estAtual, estimada = !!est && !mmMexido && Math.abs(Number(v.mm) - est.mm) < 1e-9;
      const reg = {id: uid(), ...v, fonte: estimada ? 'estimativa' : (mmMexido && manual ? 'pluviômetro' : (valores.fonte || 'pluviômetro'))};
      if (estimada && !v.notes) reg.notes = 'Estimativa da previsão do tempo (média dos modelos) — conferir no pluviômetro';
      db.chuvas.push(reg); save(); showToast(`${um1(v.mm)} mm registrados${estimada ? ' (estimativa)' : ''}`);
      setTimeout(() => perguntarCompartilharChuva(reg.id), 350);
    }});
  // Preenche os mm pela previsão (enquanto a pessoa não digitar) e explica de onde veio o número
  const mmEl = $('#f_mm', dialog), dica = mmEl?.closest('.field').querySelector('.hint');
  let mmMexido = manual, estAtual = null, ultimoPreenchido = '';
  const atualizar = () => {
    const e = chuvaEstimada($('#f_date', dialog).value, $('#f_hora', dialog).value, $('#f_fieldId', dialog).value);
    estAtual = manual ? null : e;
    if (!dica) return;
    if (!e) { dica.textContent = manual ? '' : 'Sem previsão do tempo para estimar (ative a localização da fazenda no MercaClima). Digite a leitura do pluviômetro.'; return; }
    // Só troca o número se o campo ainda tem a estimativa anterior (ou está vazio): nunca apaga o que a pessoa digitou
    if (!mmMexido && mmEl.value !== '' && mmEl.value !== ultimoPreenchido) mmMexido = true;
    if (!mmMexido) { mmEl.value = String(e.mm).replace('.', ','); ultimoPreenchido = mmEl.value; }
    dica.innerHTML = `${mmMexido ? 'Previsão do tempo para o mesmo período' : '<b>Preenchido pela previsão do tempo</b>'}: ≈ ${esc(um1(e.mm))} mm de ${esc(fmtDiaHoraChuva(e.ini))} a ${esc(fmtDiaHoraChuva(e.fim))}${e.desdeLeitura ? ' (desde a leitura anterior)' : ''}. ${mmMexido ? '' : 'É estimativa: confira no pluviômetro e corrija se precisar.'}`;
  };
  mmEl?.addEventListener('input', () => { mmMexido = true; atualizar(); });
  ['f_date', 'f_hora', 'f_fieldId'].forEach(id => $('#' + id, dialog)?.addEventListener('change', atualizar));
  atualizar();
}
// ---------- Compartilhar chuva (WhatsApp, grupo da fazenda…) ----------
const nomeFazendaChuva = () => (typeof nv !== 'undefined' && nv?.fazenda?.name) || db.settings.farm || 'Fazenda';
const somaChuva = (fieldId, de, ate) => db.chuvas.filter(c => (c.fieldId || '') === (fieldId || '') && c.date >= de && c.date <= ate).reduce((s, c) => s + (Number(c.mm) || 0), 0);
function textoChuva(c) {
  const t = c.date, mesIni = t.slice(0, 8) + '01', ini7 = addDias(t, -6);
  return [`🌧️ Chuva — ${nomeFazendaChuva()}`, `📍 ${talhaoOuGeral(c.fieldId)}`, `💧 ${um1(c.mm)} mm${c.fonte === 'estimativa' ? ' (estimativa da previsão do tempo)' : ''}`, `🕖 Leitura: ${fmtDate(c.date)}${c.hora ? ' às ' + c.hora : ''}`,
    `Últimos 7 dias: ${um1(somaChuva(c.fieldId, ini7, t))} mm • No mês: ${um1(somaChuva(c.fieldId, mesIni, t))} mm`, c.notes ? `📝 ${c.notes}` : '', '— registrado no MercaPlant'].filter(Boolean).join('\n');
}
function textoResumoChuva() {
  const t = today(), ini7 = addDias(t, -6), mesIni = t.slice(0, 8) + '01';
  const locais = [...new Set(db.chuvas.filter(c => c.date >= mesIni || c.date >= ini7).map(c => c.fieldId || ''))];
  const linhas = locais.map(l => ({l, s7: somaChuva(l, ini7, t), mes: somaChuva(l, mesIni, t), ult: db.chuvas.filter(c => (c.fieldId || '') === l).sort((a, b) => (b.date + (b.hora || '')).localeCompare(a.date + (a.hora || '')))[0]}))
    .sort((a, b) => b.s7 - a.s7).map(x => `📍 ${talhaoOuGeral(x.l)}: ${um1(x.s7)} mm em 7 dias • ${um1(x.mes)} mm no mês${x.ult ? ` (última: ${um1(x.ult.mm)} mm em ${fmtDate(x.ult.date).slice(0, 5)}${x.ult.hora ? ' ' + x.ult.hora : ''})` : ''}`);
  return [`🌧️ Chuvas — ${nomeFazendaChuva()}`, `${fmtDate(ini7).slice(0, 5)} a ${fmtDate(t).slice(0, 5)}`, '', ...(linhas.length ? linhas : ['Nenhuma chuva registrada no período.']), '', '— registrado no MercaPlant'].join('\n');
}
function compartilharChuva(id) { const c = find('chuvas', id); if (c && typeof dialogoTexto === 'function') dialogoTexto('Compartilhar chuva', 'Envie para o grupo da fazenda, o agrônomo ou quem precisar.', textoChuva(c)); }
function perguntarCompartilharChuva(id) {
  const c = find('chuvas', id); if (!c || modal.classList.contains('open')) return;
  dialog.innerHTML = `<h3>Chuva registrada</h3><p><strong>${um1(c.mm)} mm</strong> — ${esc(talhaoOuGeral(c.fieldId))}, ${fmtDate(c.date)}${c.hora ? ' às ' + esc(c.hora) : ''}.</p><p class="sub">Quer avisar a equipe?</p>
    <div class="actions"><button class="secondary" data-close>Agora não</button><button class="primary" data-comp>Compartilhar</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-comp]', dialog).onclick = () => compartilharChuva(id);
  modal.classList.add('open');
}
VIEWS.chuva = () => {
  const t = today(), ini30 = daysAgo(29), anoIni = t.slice(0, 4) + '-01-01';
  const soma = l => l.reduce((s, c) => s + Number(c.mm || 0), 0);
  const locais = [...new Set(db.chuvas.map(c => c.fieldId || ''))];
  const meses = Array.from({length: 12}, (_, k) => { const d = new Date(new Date(t + 'T12:00:00').getFullYear(), new Date(t + 'T12:00:00').getMonth() - 11 + k, 1); return {k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, rot: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`}; });
  // Média dos pluviômetros por mês (cada local soma seus registros; o mês mostra a média entre locais com registro)
  const porMes = meses.map(m => { const vals = locais.map(l => soma(db.chuvas.filter(c => (c.fieldId || '') === l && c.date.startsWith(m.k)))).filter((v, i) => db.chuvas.some(c => (c.fieldId || '') === locais[i] && c.date.startsWith(m.k))); return {...m, mm: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0}; });
  const max = Math.max(1, ...porMes.map(m => m.mm));
  const lista = db.chuvas.slice().sort((a, b) => (b.date + (b.hora || '')).localeCompare(a.date + (a.hora || ''))).slice(0, 30);
  // KPIs: média entre os pluviômetros com leitura na janela (mesmo critério do gráfico mensal)
  const media = (de, ate) => { const l = db.chuvas.filter(c => c.date >= de && c.date <= ate), n = new Set(l.map(c => c.fieldId || '')).size; return {mm: n ? soma(l) / n : 0, n}; };
  const plu = n => `${n} ${n === 1 ? 'pluviômetro' : 'pluviômetros'} com leitura`;
  const m30 = media(ini30, t), mAno = media(anoIni, t);
  return head('Chuvas', 'Pluviometria por talhão ou da sede', btn('← MercaClima', 'nav', 'clima', 'secondary') + (db.chuvas.length ? btn('Compartilhar resumo', 'ch-resumo', '', 'secondary') : '') + btn('+ Chuva', 'ch-new')) +
    (db.chuvas.length ? `<section class="es-kpis">
      <article class="card kpi"><div class="label">Últimos 30 dias</div><div class="value">${um1(m30.mm)} mm</div><div class="hint">${m30.n > 1 ? 'média entre ' + plu(m30.n) : m30.n ? plu(1) : 'sem leitura no período'}</div></article>
      <article class="card kpi"><div class="label">No ano</div><div class="value">${um1(mAno.mm)} mm</div><div class="hint">desde 01/01${mAno.n > 1 ? ' • média entre ' + plu(mAno.n) : ''}</div></article>
      <article class="card kpi"><div class="label">Última chuva</div><div class="value">${lista[0] ? um1(lista[0].mm) + ' mm' : '—'}</div><div class="hint">${lista[0] ? fmtDate(lista[0].date) + ' • ' + esc(talhaoOuGeral(lista[0].fieldId)) : ''}</div></article>
      <article class="card kpi"><div class="label">Dias sem chuva</div><div class="value">${(() => { const u = db.chuvas.filter(c => Number(c.mm) > 0 && c.date <= t).sort(byDateDesc)[0]; return u ? diasEntre(u.date, t) : '—'; })()}</div><div class="hint">desde a última chuva registrada</div></article>
    </section>
    <section class="card panel viz-root"><h3>Chuva por mês (mm)</h3><div class="fx-graf ch-graf" role="img" aria-label="Chuva por mês">${porMes.map(m => `<div class="fx-mes"><div class="fx-par"><div class="fx-barra ch" ${tip(m.rot, um1(m.mm) + ' mm')}><span class="ent" style="height:${m.mm / max * 100}%"></span></div></div><small>${m.rot.split('/')[0]}</small></div>`).join('')}</div>
      ${tabela(['Mês', 'mm'], porMes.map(m => [m.rot, um1(m.mm)]))}</section>
    <div class="section-title"><h3>Registros</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><tbody>${lista.map(c => `<tr><td>${fmtDate(c.date)}${c.hora ? `<br><small style="color:var(--muted)">${esc(c.hora)}</small>` : ''}</td><td>${esc(talhaoOuGeral(c.fieldId))}</td><td class="num"><strong>${um1(c.mm)} mm</strong>${c.fonte === 'estimativa' ? '<br><small class="ch-est" title="Estimativa da previsão do tempo">≈ estimada</small>' : ''}</td><td><div class="row-actions">${mini('Compartilhar', 'ch-comp', c.id)}${mini('Excluir', 'ch-del', c.id, 'del')}</div></td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="card">${empty('Nenhuma chuva registrada', 'Lance a leitura do pluviômetro de cada talhão ou da sede.', {act: 'ch-new', label: '+ Chuva'})}</section>`);
};

// ---------------- Monitoramento de pragas (MIP) ----------------
function monitoramentoForm(m = {}) {
  if (!db.fields.length) { showToast('Cadastre o talhão primeiro'); return fieldForm(); }
  const idMon = m.id || uid(); // id já na abertura: as fotos tiradas antes de salvar ficam ligadas a ele
  openForm({title: m.id ? 'Editar monitoramento' : 'Registrar monitoramento', sub: 'Média dos pontos amostrados. O nível de ação vem da recomendação técnica (opcional).',
    values: {date: today(), tipo: 'Praga', ...m},
    fields: [{k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, required: true, full: true}, {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'tipo', label: 'Tipo', type: 'select', options: ['Praga', 'Doença', 'Planta daninha', 'Inimigo natural'], required: true},
      {k: 'alvo', label: 'Praga / doença / planta', required: true, placeholder: 'Ex.: Percevejo-marrom'}, {k: 'estadio', label: 'Estádio da cultura', placeholder: 'Ex.: R5.1'},
      {k: 'valor', label: 'Média encontrada', type: 'number', min: 0, required: true}, {k: 'unidade', label: 'Unidade', required: true, placeholder: 'Ex.: percevejos/pano, % desfolha'},
      {k: 'pontos', label: 'Pontos amostrados', type: 'number', min: 0}, {k: 'nivelAcao', label: 'Nível de ação (da recomendação)', type: 'number', min: 0, hint: 'Opcional. O app só compara com o valor que você informar.'},
      {k: 'responsavel', label: 'Responsável', mais: true}, {k: 'notes', label: 'Observações', type: 'textarea', mais: true}],
    onSubmit: v => { upsert('monitoramentos', {...m, ...v, id: idMon}); if (typeof fotosAoSalvar === 'function') fotosAoSalvar('monitoramentos', idMon); showToast('Monitoramento salvo'); }});
  if (typeof anexarCampoFotos === 'function') anexarCampoFotos('monitoramentos', idMon, m.fotos || []);
}
const atingiuNivel = x => x.nivelAcao !== '' && x.nivelAcao != null && Number(x.valor) >= Number(x.nivelAcao);
VIEWS.pragas = () => {
  const lista = db.monitoramentos.slice().sort(byDateDesc);
  // Último monitoramento de cada alvo em cada talhão
  const ultimos = Object.values(lista.reduce((acc, x) => { const k = x.fieldId + '|' + x.alvo.toLowerCase(); acc[k] ||= x; return acc; }, {}));
  const acima = ultimos.filter(atingiuNivel);
  return head('Pragas e doenças (MIP)', 'Monitoramento por talhão: média dos pontos e nível de ação informado', btn('+ Monitoramento', 'mip-new')) +
    (lista.length ? `<section class="es-kpis">
      <article class="card kpi ${acima.length ? 'alerta' : ''}"><div class="label">No nível de ação</div><div class="value">${acima.length ? '! ' : ''}${acima.length}</div><div class="hint">${esc(acima.map(x => `${x.alvo} (${fieldName(x.fieldId)})`).join(', ') || 'nenhum alvo no nível informado')}</div></article>
      <article class="card kpi"><div class="label">Monitoramentos em 7 dias</div><div class="value">${lista.filter(x => x.date >= daysAgo(6)).length}</div><div class="hint">${lista.length} no total</div></article>
      <article class="card kpi"><div class="label">Talhões monitorados</div><div class="value">${new Set(lista.filter(x => x.date >= daysAgo(13)).map(x => x.fieldId)).size}</div><div class="hint">nos últimos 14 dias, de ${db.fields.length}</div></article>
    </section>
    <div class="section-title"><h3>Situação atual por talhão</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Talhão</th><th>Alvo</th><th class="num">Última média</th><th class="num">Nível de ação</th><th>Situação</th></tr></thead><tbody>${ultimos.sort((a, b) => atingiuNivel(b) - atingiuNivel(a)).map(x => `<tr><td>${esc(fieldName(x.fieldId))}<br><small style="color:var(--muted)">${fmtDate(x.date)}${x.estadio ? ' • ' + esc(x.estadio) : ''}</small></td><td><strong>${esc(x.alvo)}</strong><br><small style="color:var(--muted)">${esc(x.tipo)}</small></td><td class="num">${num(x.valor, 2)} ${esc(x.unidade)}</td><td class="num">${x.nivelAcao !== '' && x.nivelAcao != null ? num(x.nivelAcao, 2) : '—'}</td><td>${x.nivelAcao === '' || x.nivelAcao == null ? chip('Sem nível informado', 'gray') : atingiuNivel(x) ? chip('Atingiu o nível de ação', 'red') : chip('Abaixo do nível', 'green')}</td></tr>`).join('')}</tbody></table></div>
      <p class="nota">O app não sugere nível de controle: a comparação usa o nível que você informou da recomendação técnica.</p></section>
    <div class="section-title"><h3>Histórico</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><tbody>${lista.slice(0, 50).map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(fieldName(x.fieldId))}</td><td>${esc(x.alvo)}${x.fotos?.length ? ` <small style="color:var(--muted)">📷 ${x.fotos.length}</small>` : ''}${typeof galeriaFotos === 'function' ? galeriaFotos('monitoramentos', x) : ''}</td><td class="num">${num(x.valor, 2)} ${esc(x.unidade)}</td><td><div class="row-actions">${mini('Editar', 'mip-edit', x.id)}${mini('Excluir', 'mip-del', x.id, 'del')}</div></td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="card">${empty('Nenhum monitoramento', 'Registre a média encontrada nos pontos de amostragem de cada talhão.', {act: 'mip-new', label: '+ Monitoramento'})}</section>`);
};

// ---------------- Aplicações e carência ----------------
let avisoPulvConfirmado = '';
function aplicacaoForm() {
  if (!db.fields.length) { showToast('Cadastre o talhão primeiro'); return fieldForm(); }
  avisoPulvConfirmado = '';
  const pulvs = db.machines.filter(m => !isInactive(m)).sort((a, b) => (b.type === 'Pulverizador') - (a.type === 'Pulverizador') || a.name.localeCompare(b.name)).map(m => ({value: m.id, label: m.name}));
  openForm({title: 'Registrar aplicação de defensivo', sub: 'Carência e reentrada conforme a bula/receituário. A quantidade total pode sair do estoque.', values: {date: today(), baixar: 'Sim'},
    fields: [{k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, required: true, full: true}, {k: 'date', label: 'Data da aplicação', type: 'date', required: true},
      {k: 'itemId', label: 'Produto do estoque', type: 'select', full: true, options: () => db.stock.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`}))},
      {k: 'produto', label: 'Nome do produto', placeholder: 'Se não estiver no estoque', mostrarSe: ['itemId', '']}, {k: 'dose', label: 'Dose aplicada', placeholder: 'Ex.: 1,5 L/ha'},
      {k: 'qtd', label: 'Quantidade total usada', type: 'number', min: 0, hint: 'Na unidade do item do estoque.'}, {k: 'baixar', label: 'Tirar a quantidade do estoque', type: 'select', options: ['Sim', 'Não'], required: true, mostrarSe: ['itemId', '!']},
      {k: 'carencia', label: 'Carência (dias, da bula)', type: 'number', min: 0, required: true}, {k: 'reentrada', label: 'Reentrada (horas, da bula)', type: 'number', min: 0},
      {k: 'machineId', label: 'Pulverizador', type: 'select', options: pulvs, hint: 'O app avisa se a aferição ou a inspeção dele estiver vencida ou reprovada.'},
      {k: 'receituario', label: 'Nº do receituário agronômico'}, {k: 'responsavel', label: 'Responsável técnico', mais: true}, {k: 'notes', label: 'Observações', type: 'textarea', mais: true}],
    onSubmit: v => {
      const s = v.itemId ? find('stock', v.itemId) : null;
      if (!s && !v.produto) return 'Escolha o produto do estoque ou informe o nome';
      const dup = typeof conferirRepetido === 'function' ? conferirRepetido('aplicacoes', a => a.fieldId === v.fieldId && a.date === v.date && (a.itemId ? a.itemId === v.itemId : a.produto === (s ? s.name : v.produto)), `já existe esta aplicação (${s ? s.name : v.produto}) em ${fieldName(v.fieldId)} no dia ${fmtDate(v.date)}`) : ''; if (dup) return dup;
      const aviso = v.machineId && typeof avisoPulverizador === 'function' ? avisoPulverizador(v.machineId) : '';
      if (aviso && avisoPulvConfirmado !== v.machineId) { avisoPulvConfirmado = v.machineId; return `Atenção: ${machineName(v.machineId)} — ${aviso}. Toque em salvar de novo para registrar mesmo assim.`; }
      if (s && v.baixar === 'Sim' && v.qtd > 0) {
        if (v.qtd > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name} (${num(s.qty)} ${s.unit})`;
        const mov = aplicarMovimento(s, 'Saída', v.qtd, 0);
        v.movId = uid(); db.movements.push({id: v.movId, itemId: s.id, kind: 'Saída', qty: v.qtd, date: v.date, fieldId: v.fieldId, season: typeof safraDoLancamento === 'function' ? safraDoLancamento({fieldId: v.fieldId, date: v.date}) : find('fields', v.fieldId)?.season || '', notes: `Aplicação${v.dose ? ' ' + v.dose : ''}`, ...mov});
      }
      db.aplicacoes.push({id: uid(), ...v, produto: s ? s.name : v.produto}); save(); showToast(`Colheita liberada a partir de ${fmtDate(addDias(v.date, Number(v.carencia) || 0))}`);
    }});
}
// Ao escolher o produto do estoque na aplicação: carência e reentrada do cadastro do item (da bula) entram sozinhas se estiverem vazias
document.addEventListener('change', e => {
  if (e.target?.id !== 'f_itemId' || !/aplicação/i.test(dialog.querySelector('h3')?.textContent || '')) return;
  const s = find('stock', e.target.value); if (!s) return;
  const c = $('#f_carencia', dialog), r = $('#f_reentrada', dialog);
  if (c && !c.value && s.carencia !== '' && s.carencia != null) c.value = String(s.carencia);
  if (r && !r.value && s.reentrada !== '' && s.reentrada != null) r.value = String(s.reentrada);
});
// Data a partir da qual o talhão pode ser colhido (maior fim de carência entre as aplicações)
function liberacaoColheita(fieldId) {
  const ap = db.aplicacoes.filter(a => a.fieldId === fieldId && Number(a.carencia) >= 0).map(a => ({a, libera: addDias(a.date, Number(a.carencia) || 0)})).sort((x, y) => y.libera.localeCompare(x.libera))[0];
  return ap || null;
}
VIEWS.aplicacoes = () => {
  const t = today(), lista = db.aplicacoes.slice().sort(byDateDesc);
  const emCarencia = db.fields.map(f => ({f, l: liberacaoColheita(f.id)})).filter(x => x.l && x.l.libera > t);
  return head('Aplicações e carência', 'Defensivos aplicados por talhão, receituário e liberação para colheita', btn('+ Aplicação', 'ap-new')) +
    (lista.length ? `<section class="es-kpis">
      <article class="card kpi ${emCarencia.length ? 'aviso' : ''}"><div class="label">Talhões em carência</div><div class="value">${emCarencia.length}</div><div class="hint">${esc(emCarencia.map(x => `${x.f.name} até ${fmtDate(x.l.libera)}`).join('; ') || 'todos liberados')}</div></article>
      <article class="card kpi"><div class="label">Aplicações no mês</div><div class="value">${lista.filter(a => a.date >= t.slice(0, 8) + '01').length}</div><div class="hint">${lista.length} no total</div></article>
      <article class="card kpi"><div class="label">Sem receituário</div><div class="value">${lista.filter(a => !a.receituario).length}</div><div class="hint">aplicações sem nº de receituário</div></article>
    </section>
    <div class="section-title"><h3>Aplicações</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Talhão</th><th>Produto</th><th>Carência</th><th>Colheita liberada</th><th></th></tr></thead><tbody>${lista.map(a => { const lib = addDias(a.date, Number(a.carencia) || 0); return `<tr><td>${fmtDate(a.date)}</td><td>${esc(fieldName(a.fieldId))}</td><td><strong>${esc(a.produto)}</strong>${a.dose ? `<br><small style="color:var(--muted)">${esc(a.dose)}</small>` : ''}${a.receituario ? `<br><small style="color:var(--muted)">Receituário ${esc(a.receituario)}</small>` : ''}${a.machineId ? `<br><small style="color:var(--muted)">${esc(machineName(a.machineId))}</small>` : ''}${typeof quemLancou === 'function' && quemLancou(a) ? `<br><small style="color:var(--muted)">lançado por ${esc(quemLancou(a))}</small>` : ''}</td><td>${num(a.carencia)} dias${a.reentrada ? `<br><small style="color:var(--muted)">reentrada ${num(a.reentrada)} h</small>` : ''}</td><td>${lib > t ? chip('a partir de ' + fmtDate(lib), 'orange') : chip('liberada', 'green')}</td><td>${mini('Excluir', 'ap-del', a.id, 'del')}</td></tr>`; }).join('')}</tbody></table></div></section>`
    : `<section class="card">${empty('Nenhuma aplicação registrada', 'Registre os defensivos aplicados com a carência da bula para saber quando cada talhão pode ser colhido.', {act: 'ap-new', label: '+ Aplicação'})}</section>`);
};

// ---------------- Mão de obra ----------------
function pessoaForm(p = {}) {
  openForm({title: p.id ? 'Editar pessoa' : 'Nova pessoa da equipe', values: {tipo: 'Diarista', ...p},
    fields: [{k: 'nome', label: 'Nome', required: true, full: true}, {k: 'funcao', label: 'Função', placeholder: 'Ex.: operador, auxiliar'},
      {k: 'tipo', label: 'Vínculo', type: 'select', options: ['Diarista', 'Por hora', 'Fixo (mensal)'], required: true},
      {k: 'valor', label: 'Valor da diária ou da hora (R$)', type: 'number', min: 0, hint: 'Para fixos, deixe em branco: o salário entra em Financeiro.'}],
    onSubmit: v => { upsert('equipe', {...p, ...v, id: p.id || uid()}); showToast('Pessoa salva'); }});
}
function apontamentoForm() {
  if (!db.equipe.length) { showToast('Cadastre a equipe primeiro'); return pessoaForm(); }
  openForm({title: 'Apontar trabalho', sub: 'Diaristas e por hora geram gasto de mão de obra (pago à vista). Fixos registram só as horas.', values: {date: today()},
    fields: [{k: 'pessoaId', label: 'Pessoa', type: 'select', required: true, full: true, options: () => db.equipe.map(p => ({value: p.id, label: `${p.nome} — ${p.tipo}`}))},
      {k: 'date', label: 'Data', type: 'date', required: true}, {k: 'quantidade', label: 'Dias ou horas trabalhados', type: 'number', min: 0, required: true, hint: 'Diarista: dias • Por hora e fixo: horas'},
      {k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions}, {k: 'atividade', label: 'Atividade', placeholder: 'Ex.: catação, roçada, plantio'}],
    onSubmit: v => {
      const p = find('equipe', v.pessoaId); if (!p) return 'Escolha a pessoa'; if (!(v.quantidade > 0)) return 'Informe dias ou horas';
      const ap = {id: uid(), ...v, tipo: p.tipo, valor: 0};
      if (p.tipo !== 'Fixo (mensal)' && Number(p.valor) > 0) {
        ap.valor = Math.round(v.quantidade * Number(p.valor) * 100) / 100;
        const g = {id: uid(), date: v.date, category: 'Mão de obra', description: `${p.nome} — ${num(v.quantidade)} ${p.tipo === 'Diarista' ? (Number(v.quantidade) > 1 ? 'diárias' : 'diária') : 'h'}${v.atividade ? ' • ' + v.atividade : ''}`, value: ap.valor, fieldId: v.fieldId || '', season: v.fieldId ? find('fields', v.fieldId)?.season || '' : '', apontamentoId: ap.id};
        db.expenses.push(g); ap.gastoId = g.id;
      }
      db.apontamentos.push(ap); save(); showToast(ap.valor ? `Apontado • R$ ${num(ap.valor, 2)} em mão de obra` : 'Apontado');
    }});
}
VIEWS.maodeobra = () => {
  const ini = today().slice(0, 8) + '01', mes = db.apontamentos.filter(a => a.date >= ini);
  return head('Mão de obra', 'Equipe, dias e horas trabalhados e custo', btn('+ Pessoa', 'mo-pessoa', '', 'secondary') + btn('+ Apontamento', 'mo-apont')) +
    `<section class="es-kpis">
      <article class="card kpi"><div class="label">Custo no mês</div><div class="value">R$ ${num(mes.reduce((s, a) => s + (a.valor || 0), 0), 2)}</div><div class="hint">diaristas e por hora</div></article>
      <article class="card kpi"><div class="label">Diárias no mês</div><div class="value">${num(mes.filter(a => a.tipo === 'Diarista').reduce((s, a) => s + Number(a.quantidade), 0))}</div><div class="hint">${num(mes.filter(a => a.tipo !== 'Diarista').reduce((s, a) => s + Number(a.quantidade), 0))} h apontadas</div></article>
      <article class="card kpi"><div class="label">Equipe</div><div class="value">${db.equipe.length}</div><div class="hint">pessoas cadastradas</div></article>
    </section>
    <section class="grid">
      <article class="card panel"><h3>Equipe</h3>${db.equipe.length ? `<table class="tbl"><tbody>${db.equipe.map(p => `<tr><td><strong>${esc(p.nome)}</strong><br><small style="color:var(--muted)">${esc([p.funcao, p.tipo].filter(Boolean).join(' • '))}</small></td><td class="num">${Number(p.valor) > 0 ? 'R$ ' + num(p.valor, 2) + (p.tipo === 'Diarista' ? '/dia' : '/h') : '—'}</td><td><div class="row-actions">${mini('Editar', 'mo-edit', p.id)}</div></td></tr>`).join('')}</tbody></table>` : empty('Nenhuma pessoa', '', {act: 'mo-pessoa', label: '+ Pessoa'})}</article>
      <article class="card panel"><h3>Últimos apontamentos</h3>${db.apontamentos.length ? `<table class="tbl"><tbody>${db.apontamentos.slice().sort(byDateDesc).slice(0, 20).map(a => `<tr><td>${fmtDate(a.date)}<br><small style="color:var(--muted)">${esc([find('equipe', a.pessoaId)?.nome, fieldName(a.fieldId), a.atividade].filter(Boolean).join(' • '))}</small></td><td class="num">${num(a.quantidade)} ${a.tipo === 'Diarista' ? 'd' : 'h'}</td><td class="num">${a.valor ? 'R$ ' + num(a.valor, 2) : '—'}</td><td>${mini('Excluir', 'mo-del', a.id, 'del')}</td></tr>`).join('')}</tbody></table>` : 'Nenhum apontamento.'}</article>
    </section>`;
};

Object.assign(TITLES, {chuva: 'Chuvas', pragas: 'Pragas e doenças (MIP)', aplicacoes: 'Aplicações e carência', maodeobra: 'Mão de obra'});
Object.assign(ACTIONS, {
  'ch-new': () => chuvaForm(), 'ch-comp': compartilharChuva, 'ch-resumo': () => dialogoTexto('Resumo das chuvas', 'Últimos 7 dias e o mês, por pluviômetro.', textoResumoChuva()), 'ch-del': id => confirmDialog('Excluir este registro de chuva?', () => { remove('chuvas', id); showToast('Excluído'); }),
  'mip-new': () => monitoramentoForm(), 'mip-edit': id => monitoramentoForm(find('monitoramentos', id)), 'mip-del': id => confirmDialog('Excluir este monitoramento?', () => { remove('monitoramentos', id); showToast('Excluído'); }),
  'ap-new': aplicacaoForm,
  'ap-del': id => confirmDialog('Excluir esta aplicação? Se tirou produto do estoque, ele volta ao saldo.', () => {
    const a = find('aplicacoes', id); const m = a?.movId && find('movements', a.movId);
    if (m) { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); db.movements = db.movements.filter(x => x.id !== m.id); }
    remove('aplicacoes', id); showToast('Excluído');
  }),
  'mo-pessoa': () => pessoaForm(), 'mo-edit': id => pessoaForm(find('equipe', id)), 'mo-apont': apontamentoForm,
  'mo-del': id => confirmDialog('Excluir este apontamento? O gasto de mão de obra gerado também será excluído.', () => { const a = find('apontamentos', id); if (a?.gastoId) db.expenses = db.expenses.filter(g => g.id !== a.gastoId); remove('apontamentos', id); showToast('Excluído'); })
});

// Alertas: alvo no nível de ação e talhão em carência com colheita programada
const alertasSemCampo = alerts;
alerts = function () {
  const lista = alertasSemCampo(), desde = daysAgo(30);
  // Último monitoramento de cada alvo no talhão; some depois de 30 dias ou quando há aplicação no talhão depois dele
  const aplicadoDepois = x => db.aplicacoes.some(a => a.fieldId === x.fieldId && (a.date || '') >= x.date);
  Object.values(db.monitoramentos.slice().sort(byDateDesc).reduce((acc, x) => { acc[x.fieldId + '|' + String(x.alvo || '').toLowerCase()] ||= x; return acc; }, {}))
    .filter(x => atingiuNivel(x) && x.date >= desde && !aplicadoDepois(x))
    .forEach(x => lista.push({color: 'red', icon: '✱', title: `Nível de ação: ${x.alvo} — ${fieldName(x.fieldId)}`, text: `${num(x.valor, 2)} ${x.unidade} em ${fmtDate(x.date)} (nível informado ${num(x.nivelAcao, 2)}).`, route: 'pragas'}));
  db.operations.filter(o => o.type === 'Colheita' && o.status !== 'Concluída' && o.status !== 'Cancelada' && o.fieldId).forEach(o => {
    const l = liberacaoColheita(o.fieldId);
    if (l && o.date < l.libera) lista.unshift({color: 'red', icon: '!', title: `Colheita em carência: ${fieldName(o.fieldId)}`, text: `Programada para ${fmtDate(o.date)}; ${l.a.produto} libera a partir de ${fmtDate(l.libera)}.`, route: 'aplicacoes'});
  });
  return lista;
};
