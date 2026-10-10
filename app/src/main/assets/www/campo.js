'use strict';
/* Campo: chuvas (pluviômetro), monitoramento de pragas (MIP), aplicações com carência e mão de obra.
   Nenhum nível de controle, carência ou dose é sugerido pelo app: vêm da recomendação técnica e da bula informadas pelo usuário. */

const talhaoOuGeral = id => id ? (fieldName(id) || 'Talhão removido') : 'Sede / geral';
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

// ---------------- Chuvas ----------------
function chuvaForm() {
  openForm({title: 'Registrar chuva', sub: 'Leitura do pluviômetro (mm). Sem talhão = pluviômetro da sede.', values: {date: today()},
    fields: [{k: 'date', label: 'Data', type: 'date', required: true}, {k: 'mm', label: 'Chuva (mm)', type: 'number', min: 0, required: true},
      {k: 'fieldId', label: 'Talhão / pluviômetro', type: 'select', options: fieldOptions}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => { if (!(v.mm >= 0)) return 'Informe os milímetros'; db.chuvas.push({id: uid(), ...v}); save(); showToast(`${um1(v.mm)} mm registrados`); }});
}
VIEWS.chuva = () => {
  const t = today(), ini30 = daysAgo(29), anoIni = t.slice(0, 4) + '-01-01';
  const soma = l => l.reduce((s, c) => s + Number(c.mm || 0), 0);
  const locais = [...new Set(db.chuvas.map(c => c.fieldId || ''))];
  const meses = Array.from({length: 12}, (_, k) => { const d = new Date(new Date(t + 'T12:00:00').getFullYear(), new Date(t + 'T12:00:00').getMonth() - 11 + k, 1); return {k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, rot: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`}; });
  // Média dos pluviômetros por mês (cada local soma seus registros; o mês mostra a média entre locais com registro)
  const porMes = meses.map(m => { const vals = locais.map(l => soma(db.chuvas.filter(c => (c.fieldId || '') === l && c.date.startsWith(m.k)))).filter((v, i) => db.chuvas.some(c => (c.fieldId || '') === locais[i] && c.date.startsWith(m.k))); return {...m, mm: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0}; });
  const max = Math.max(1, ...porMes.map(m => m.mm));
  const lista = db.chuvas.slice().sort(byDateDesc).slice(0, 30);
  // KPIs: média entre os pluviômetros com leitura na janela (mesmo critério do gráfico mensal)
  const media = (de, ate) => { const l = db.chuvas.filter(c => c.date >= de && c.date <= ate), n = new Set(l.map(c => c.fieldId || '')).size; return {mm: n ? soma(l) / n : 0, n}; };
  const plu = n => `${n} ${n === 1 ? 'pluviômetro' : 'pluviômetros'} com leitura`;
  const m30 = media(ini30, t), mAno = media(anoIni, t);
  return head('Chuvas', 'Pluviometria por talhão ou da sede', btn('+ Chuva', 'ch-new')) +
    (db.chuvas.length ? `<section class="es-kpis">
      <article class="card kpi"><div class="label">Últimos 30 dias</div><div class="value">${um1(m30.mm)} mm</div><div class="hint">${m30.n > 1 ? 'média entre ' + plu(m30.n) : m30.n ? plu(1) : 'sem leitura no período'}</div></article>
      <article class="card kpi"><div class="label">No ano</div><div class="value">${um1(mAno.mm)} mm</div><div class="hint">desde 01/01${mAno.n > 1 ? ' • média entre ' + plu(mAno.n) : ''}</div></article>
      <article class="card kpi"><div class="label">Última chuva</div><div class="value">${lista[0] ? um1(lista[0].mm) + ' mm' : '—'}</div><div class="hint">${lista[0] ? fmtDate(lista[0].date) + ' • ' + esc(talhaoOuGeral(lista[0].fieldId)) : ''}</div></article>
      <article class="card kpi"><div class="label">Dias sem chuva</div><div class="value">${(() => { const u = db.chuvas.filter(c => Number(c.mm) > 0 && c.date <= t).sort(byDateDesc)[0]; return u ? diasEntre(u.date, t) : '—'; })()}</div><div class="hint">desde a última chuva registrada</div></article>
    </section>
    <section class="card panel viz-root"><h3>Chuva por mês (mm)</h3><div class="fx-graf ch-graf" role="img" aria-label="Chuva por mês">${porMes.map(m => `<div class="fx-mes"><div class="fx-par"><div class="fx-barra ch" ${tip(m.rot, um1(m.mm) + ' mm')}><span class="ent" style="height:${m.mm / max * 100}%"></span></div></div><small>${m.rot.split('/')[0]}</small></div>`).join('')}</div>
      ${tabela(['Mês', 'mm'], porMes.map(m => [m.rot, um1(m.mm)]))}</section>
    <div class="section-title"><h3>Registros</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><tbody>${lista.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(talhaoOuGeral(c.fieldId))}</td><td class="num"><strong>${um1(c.mm)} mm</strong></td><td>${mini('Excluir', 'ch-del', c.id, 'del')}</td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="card">${empty('Nenhuma chuva registrada', 'Lance a leitura do pluviômetro de cada talhão ou da sede.', {act: 'ch-new', label: '+ Chuva'})}</section>`);
};

// ---------------- Monitoramento de pragas (MIP) ----------------
function monitoramentoForm(m = {}) {
  if (!db.fields.length) { showToast('Cadastre o talhão primeiro'); return fieldForm(); }
  openForm({title: m.id ? 'Editar monitoramento' : 'Registrar monitoramento', sub: 'Média dos pontos amostrados. O nível de ação vem da recomendação técnica (opcional).',
    values: {date: today(), tipo: 'Praga', ...m},
    fields: [{k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, required: true, full: true}, {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'tipo', label: 'Tipo', type: 'select', options: ['Praga', 'Doença', 'Planta daninha', 'Inimigo natural'], required: true},
      {k: 'alvo', label: 'Praga / doença / planta', required: true, placeholder: 'Ex.: Percevejo-marrom'}, {k: 'estadio', label: 'Estádio da cultura', placeholder: 'Ex.: R5.1'},
      {k: 'valor', label: 'Média encontrada', type: 'number', min: 0, required: true}, {k: 'unidade', label: 'Unidade', required: true, placeholder: 'Ex.: percevejos/pano, % desfolha'},
      {k: 'pontos', label: 'Pontos amostrados', type: 'number', min: 0}, {k: 'nivelAcao', label: 'Nível de ação (da recomendação)', type: 'number', min: 0, hint: 'Opcional. O app só compara com o valor que você informar.'},
      {k: 'responsavel', label: 'Responsável'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => { upsert('monitoramentos', {...m, ...v, id: m.id || uid()}); showToast('Monitoramento salvo'); }});
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
    <div class="section-title"><h3>Histórico</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><tbody>${lista.slice(0, 50).map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(fieldName(x.fieldId))}</td><td>${esc(x.alvo)}</td><td class="num">${num(x.valor, 2)} ${esc(x.unidade)}</td><td><div class="row-actions">${mini('Editar', 'mip-edit', x.id)}${mini('Excluir', 'mip-del', x.id, 'del')}</div></td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="card">${empty('Nenhum monitoramento', 'Registre a média encontrada nos pontos de amostragem de cada talhão.', {act: 'mip-new', label: '+ Monitoramento'})}</section>`);
};

// ---------------- Aplicações e carência ----------------
function aplicacaoForm() {
  if (!db.fields.length) { showToast('Cadastre o talhão primeiro'); return fieldForm(); }
  openForm({title: 'Registrar aplicação de defensivo', sub: 'Carência e reentrada conforme a bula/receituário. A quantidade total pode sair do estoque.', values: {date: today(), baixar: 'Sim'},
    fields: [{k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, required: true, full: true}, {k: 'date', label: 'Data da aplicação', type: 'date', required: true},
      {k: 'itemId', label: 'Produto do estoque', type: 'select', full: true, options: () => db.stock.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`}))},
      {k: 'produto', label: 'ou nome do produto', placeholder: 'Se não estiver no estoque'}, {k: 'dose', label: 'Dose aplicada', placeholder: 'Ex.: 1,5 L/ha'},
      {k: 'qtd', label: 'Quantidade total usada', type: 'number', min: 0, hint: 'Na unidade do item do estoque.'}, {k: 'baixar', label: 'Tirar a quantidade do estoque', type: 'select', options: ['Sim', 'Não'], required: true},
      {k: 'carencia', label: 'Carência (dias, da bula)', type: 'number', min: 0, required: true}, {k: 'reentrada', label: 'Reentrada (horas, da bula)', type: 'number', min: 0},
      {k: 'receituario', label: 'Nº do receituário agronômico'}, {k: 'responsavel', label: 'Responsável técnico'}, {k: 'notes', label: 'Observações', type: 'textarea'}],
    onSubmit: v => {
      const s = v.itemId ? find('stock', v.itemId) : null;
      if (!s && !v.produto) return 'Escolha o produto do estoque ou informe o nome';
      if (s && v.baixar === 'Sim' && v.qtd > 0) {
        if (v.qtd > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name} (${num(s.qty)} ${s.unit})`;
        const mov = aplicarMovimento(s, 'Saída', v.qtd, 0);
        v.movId = uid(); db.movements.push({id: v.movId, itemId: s.id, kind: 'Saída', qty: v.qtd, date: v.date, fieldId: v.fieldId, season: find('fields', v.fieldId)?.season || '', notes: `Aplicação${v.dose ? ' ' + v.dose : ''}`, ...mov});
      }
      db.aplicacoes.push({id: uid(), ...v, produto: s ? s.name : v.produto}); save(); showToast(`Colheita liberada a partir de ${fmtDate(addDias(v.date, Number(v.carencia) || 0))}`);
    }});
}
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
    <div class="section-title"><h3>Aplicações</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Talhão</th><th>Produto</th><th>Carência</th><th>Colheita liberada</th><th></th></tr></thead><tbody>${lista.map(a => { const lib = addDias(a.date, Number(a.carencia) || 0); return `<tr><td>${fmtDate(a.date)}</td><td>${esc(fieldName(a.fieldId))}</td><td><strong>${esc(a.produto)}</strong>${a.dose ? `<br><small style="color:var(--muted)">${esc(a.dose)}</small>` : ''}${a.receituario ? `<br><small style="color:var(--muted)">Receituário ${esc(a.receituario)}</small>` : ''}</td><td>${num(a.carencia)} dias${a.reentrada ? `<br><small style="color:var(--muted)">reentrada ${num(a.reentrada)} h</small>` : ''}</td><td>${lib > t ? chip('a partir de ' + fmtDate(lib), 'orange') : chip('liberada', 'green')}</td><td>${mini('Excluir', 'ap-del', a.id, 'del')}</td></tr>`; }).join('')}</tbody></table></div></section>`
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
  'ch-new': chuvaForm, 'ch-del': id => confirmDialog('Excluir este registro de chuva?', () => { remove('chuvas', id); showToast('Excluído'); }),
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
  const lista = alertasSemCampo(), t = today();
  Object.values(db.monitoramentos.slice().sort(byDateDesc).reduce((acc, x) => { acc[x.fieldId + '|' + x.alvo.toLowerCase()] ||= x; return acc; }, {})).filter(atingiuNivel)
    .forEach(x => lista.push({color: 'red', icon: '✱', title: `Nível de ação: ${x.alvo} — ${fieldName(x.fieldId)}`, text: `${num(x.valor, 2)} ${x.unidade} em ${fmtDate(x.date)} (nível informado ${num(x.nivelAcao, 2)}).`, route: 'pragas'}));
  db.operations.filter(o => o.type === 'Colheita' && o.status !== 'Concluída' && o.status !== 'Cancelada' && o.fieldId).forEach(o => {
    const l = liberacaoColheita(o.fieldId);
    if (l && o.date < l.libera) lista.unshift({color: 'red', icon: '!', title: `Colheita em carência: ${fieldName(o.fieldId)}`, text: `Programada para ${fmtDate(o.date)}; ${l.a.produto} libera a partir de ${fmtDate(l.libera)}.`, route: 'aplicacoes'});
  });
  return lista;
};
