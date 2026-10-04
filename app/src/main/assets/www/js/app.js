import { openDatabase } from './db.js';
import * as L from './logic.js';
import { ENTITIES, DATA_STORES, OP_STATUS, MACHINE_STATUS, MAINT_KINDS, MAINT_STATUS, PROD_STATUS, LOT_STATUS, MOVE_KINDS, optionList } from './schemas.js';

const APP_VERSION = '0.2.0-beta1';
const insideApp = location.hostname === 'appassets.androidplatform.net';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = L.escapeHtml;
const today = () => L.localDate();

const state = Object.fromEntries(DATA_STORES.map(s => [s, []]));
let settings = { id: 'app', farmName: '', userName: '' };
let db = null;

const TONE = {
  programada: 'blue', andamento: 'green', concluida: 'gray', cancelada: 'red', aberta: 'orange',
  ativa: 'green', manutencao: 'orange', inativa: 'gray', planejado: 'blue', plantado: 'green', colhido: 'gray',
  em_analise: 'purple', aprovado: 'green', reprovado: 'red', expedido: 'gray',
  entrada: 'green', saida: 'orange', consumo: 'orange', ajuste: 'purple',
};
const chip = (text, key) => `<span class="chip t-${TONE[key] || 'gray'}">${esc(text)}</span>`;

// ---------- Avisos, janelas e confirmações
const toastEl = $('#toast');
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

const modal = $('#modal'), dialog = $('#dialog');
let pendingConfirm = null;
function openModal(html) {
  dialog.innerHTML = html;
  modal.classList.add('open');
  dialog.querySelector('input:not([type=hidden]),select,textarea,button')?.focus();
}
function closeModal() {
  modal.classList.remove('open');
  dialog.innerHTML = '';
  if (pendingConfirm) { const resolve = pendingConfirm; pendingConfirm = null; resolve(false); }
}
function confirmDialog(message, okLabel = 'Excluir', danger = true) {
  return new Promise(resolve => {
    openModal(`<h3>Confirmar</h3><p>${esc(message)}</p><div class="actions"><button type="button" class="secondary" data-act="confirm-no">Cancelar</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-act="confirm-yes">${esc(okLabel)}</button></div>`);
    pendingConfirm = resolve;
  });
}
function answerConfirm(value) {
  const resolve = pendingConfirm;
  pendingConfirm = null;
  closeModal();
  resolve?.(value);
}

// ---------- Gravação
const findRecord = (store, id) => state[store].find(r => r.id === id);

async function saveRecord(store, data) {
  const now = new Date().toISOString();
  const record = { ...data, id: data.id || L.uid(), createdAt: data.createdAt || now, updatedAt: now };
  await db.put(store, record);
  const list = state[store];
  const index = list.findIndex(r => r.id === record.id);
  if (index >= 0) list[index] = record; else list.push(record);
  return record;
}

async function removeRecord(store, id) {
  const record = findRecord(store, id);
  if (!record) return;
  const refs = L.findReferences(state, store, id);
  if (refs.length) {
    toast(`Não dá para excluir: está ligado a ${refs.map(r => `${r.count} em ${r.label}`).join(', ')}. Exclua ou altere esses registros antes.`);
    return;
  }
  if (!await confirmDialog(`Excluir ${ENTITIES[store].singular} “${L.recordTitle(store, record, state)}”? Essa ação não pode ser desfeita.`)) return;
  await db.remove(store, id);
  state[store] = state[store].filter(r => r.id !== id);
  toast('Registro excluído');
  render();
}

async function replaceAllData(data, newSettings) {
  const payload = Object.fromEntries(DATA_STORES.map(s => [s, data[s] || []]));
  payload.settings = [{ ...settings, ...(newSettings || {}), id: 'app' }];
  await db.replaceAll(payload);
  for (const s of DATA_STORES) state[s] = payload[s].slice();
  settings = payload.settings[0];
}

// ---------- Formulários
function sortedRefs(store) {
  return state[store].map(r => [r.id, L.recordTitle(store, r, state)]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR', { numeric: true }));
}

function fieldHtml(field, value) {
  const id = `f-${field.key}`;
  const v = value ?? '';
  let input;
  if (field.type === 'select') {
    const options = field.ref ? sortedRefs(field.ref) : optionList(field.options);
    const empty = field.required ? (options.length ? '' : '<option value="">—</option>') : '<option value="">—</option>';
    input = `<select id="${id}" name="${field.key}">${empty}${options.map(([val, label]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    input = `<textarea id="${id}" name="${field.key}" rows="3" placeholder="${esc(field.placeholder || '')}">${esc(v)}</textarea>`;
  } else {
    const extra = field.type === 'number' ? ' step="any" inputmode="decimal"' : '';
    input = `<input id="${id}" name="${field.key}" type="${field.type}" value="${esc(v)}" placeholder="${esc(field.placeholder || '')}"${extra}>`;
  }
  const unit = field.unit ? ` (${esc(field.unit)})` : '';
  return `<div class="field${field.full ? ' full' : ''}"><label for="${id}">${esc(field.label)}${unit}${field.required ? ' *' : ''}</label>${input}</div>`;
}

function openForm(store, record = null, defaults = {}) {
  const entity = ENTITIES[store];
  const values = {};
  for (const field of entity.fields) {
    const fallback = field.default === 'today' ? today() : field.default ?? '';
    values[field.key] = record ? record[field.key] : defaults[field.key] ?? fallback;
  }
  const missing = entity.fields.filter(f => f.required && f.ref && !state[f.ref].length);
  const notes = missing.map(f => `<p class="form-note">Antes, cadastre pelo menos um registro em ${esc(ENTITIES[f.ref].plural)}. <a href="#/${ENTITIES[f.ref].route}" data-act="close-modal">Ir para ${esc(ENTITIES[f.ref].plural)}</a></p>`).join('');
  const title = record ? `Editar ${entity.singular}` : entity.newLabel;
  openModal(`<h3>${esc(title)}</h3>${notes}<form id="entityForm" novalidate><div class="form-errors" id="formErrors" hidden></div><div class="form">${entity.fields.map(f => fieldHtml(f, values[f.key])).join('')}</div><div class="actions"><button type="button" class="secondary" data-act="close-modal">Cancelar</button><button class="primary" type="submit"${missing.length ? ' disabled' : ''}>Salvar</button></div></form>`);
  const form = $('#entityForm');
  form.onsubmit = async event => {
    event.preventDefault();
    const data = { ...(record || {}), ...L.normalizeRecord(store, Object.fromEntries(new FormData(form))) };
    const errors = L.validateRecord(store, data, state);
    const box = $('#formErrors');
    if (errors.length) {
      box.innerHTML = errors.map(e => `<p>${esc(e)}</p>`).join('');
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    await guarded(async () => {
      await saveRecord(store, data);
      closeModal();
      toast(entity.savedMsg);
      render();
    });
  };
}

// ---------- Exportação de arquivos
function saveFile(name, mime, text) {
  if (window.AgroAndroid && typeof window.AgroAndroid.saveFile === 'function') {
    window.AgroAndroid.saveFile(name, mime, text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Arquivo gerado: ${name}`);
}
window.agroFileSaved = result => toast(result === 'ok' ? 'Arquivo salvo' : result === 'cancel' ? 'Exportação cancelada' : 'Não foi possível salvar o arquivo');

function exportCsv(store) {
  const csv = L.toCsv(L.exportColumns(store, state), state[store]);
  saveFile(`agro-${store}-${today()}.csv`, 'text/csv', '﻿' + csv);
}

// ---------- Pedaços de tela
function pageHeader(title, subtitle, actions = '') {
  return `<section class="welcome"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="head-actions">${actions}</div></section>`;
}
const defaultsAttr = defaults => (defaults ? ` data-defaults="${esc(JSON.stringify(defaults))}"` : '');
const newButton = (store, label = ENTITIES[store].newLabel, defaults, cls = 'primary') =>
  `<button class="${cls}" data-act="new" data-store="${store}"${defaultsAttr(defaults)}>+ ${esc(label)}</button>`;
const rowActions = (store, id, extra = '') =>
  `<div class="row-actions">${extra}<button class="link" data-act="edit" data-store="${store}" data-id="${esc(id)}">Editar</button><button class="link danger-text" data-act="delete" data-store="${store}" data-id="${esc(id)}">Excluir</button></div>`;

function table(columns, rows, emptyText, footer = '') {
  if (!rows.length) return `<div class="empty">${esc(emptyText)}</div>`;
  const th = columns.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr>${columns.map(c => `<td data-label="${esc(c.label)}"${c.num ? ' class="num"' : ''}>${c.html(r)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${footer}</table></div>`;
}
const actionsCol = (store, extra) => ({ label: '', html: r => rowActions(store, r.id, extra ? extra(r) : '') });

function opRow(op, showDate = false) {
  const meta = [showDate ? L.fmtDate(op.date) : '', op.time, L.refName(state, 'machines', op.machineId), op.notes].filter(Boolean).join(' • ');
  const options = Object.entries(OP_STATUS).map(([v, l]) => `<option value="${v}"${v === op.status ? ' selected' : ''}>${l}</option>`).join('');
  return `<div class="operation"><span class="status ${TONE[op.status] || 'blue'}"></span><div><strong>${esc(op.type)} — ${esc(L.opPlace(state, op))}</strong><small>${esc(meta || 'Sem detalhes')}</small></div>
    <div class="op-side"><select class="status-select" aria-label="Situação" data-act="op-status" data-id="${esc(op.id)}">${options}</select>
    <button class="icon-btn" data-act="edit" data-store="operations" data-id="${esc(op.id)}" aria-label="Editar operação" title="Editar">✎</button>
    <button class="icon-btn" data-act="delete" data-store="operations" data-id="${esc(op.id)}" aria-label="Excluir operação" title="Excluir">🗑</button></div></div>`;
}

function alertsHtml(alerts) {
  if (!alerts.length) return '<div class="empty">Nenhuma pendência. Tudo em dia ✓</div>';
  return alerts.map(a => `<a class="alert" href="#/${a.route}"><span class="alert-icon ${a.level}">${esc(a.icon)}</span><div><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small>${a.progress !== undefined ? `<div class="progress"><span style="width:${a.progress.toFixed(0)}%"></span></div>` : ''}</div></a>`).join('');
}

const kpi = (tone, icon, label, value, hint, route) =>
  `<a class="card kpi" href="#/${route}"><div class="badge ${tone}">${icon}</div><div class="label">${esc(label)}</div><div class="value">${esc(String(value))}</div><div class="hint">${esc(hint)}</div></a>`;

const byOpOrder = (a, b) => String(b.date).localeCompare(String(a.date)) || String(a.time || '99').localeCompare(String(b.time || '99'));
const byDateDesc = key => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''));
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric: true });

// ---------- Telas
function viewDashboard() {
  const t = today();
  const k = L.computeKpis(state, t);
  const alerts = L.computeAlerts(state, t);
  const ops = state.operations.filter(o => o.date === t).sort(byOpOrder);
  const empty = DATA_STORES.every(s => !state[s].length);
  const onboarding = empty ? `<section class="card card-section"><h3>Comece por aqui</h3><p>Cadastre talhões, máquinas e itens de estoque, ou carregue dados de exemplo para conhecer o aplicativo. Tudo fica salvo neste dispositivo.</p><div class="button-row"><a class="secondary" href="#/cadastros">Ir para Cadastros</a><button class="primary" data-act="sample">Carregar dados de exemplo</button></div></section>` : '';
  return `${pageHeader(settings.farmName || 'Operações da fazenda', 'Acompanhe o trabalho do campo e os registros salvos neste dispositivo.', newButton('operations'))}
    ${onboarding}
    <section class="kpis">
      ${kpi('blue', '◷', 'Programadas hoje', k.scheduled, k.scheduledHint, 'operacoes')}
      ${kpi('green', '▶', 'Em andamento', k.running, k.runningHint, 'operacoes?all=1&status=andamento')}
      ${kpi('orange', '⚙', 'Máquinas em manutenção', k.maintenance, k.maintenanceHint, 'maquinas')}
      ${kpi('red', '!', 'Pendências importantes', k.alerts, k.alertsHint, 'relatorios')}
    </section>
    <div class="section-title"><h3>Ações rápidas</h3></div>
    <section class="quick">
      <button data-act="new" data-store="operations"><span class="qicon green">＋</span><span><strong>Nova operação</strong><small>Registrar atividade no campo</small></span></button>
      <button data-act="new" data-store="hourmeterLogs"><span class="qicon blue">◷</span><span><strong>Registrar horímetro</strong><small>Máquina e horas trabalhadas</small></span></button>
      <button data-act="new" data-store="maintenance"><span class="qicon orange">⚙</span><span><strong>Abrir manutenção</strong><small>Preventiva ou corretiva</small></span></button>
      <button data-act="new" data-store="stockMoves"><span class="qicon purple">⇄</span><span><strong>Movimentar estoque</strong><small>Entrada, saída ou consumo</small></span></button>
    </section>
    <section class="grid">
      <article class="card panel"><div class="section-title" style="margin:0 0 4px"><h3>Operações do dia</h3><a href="#/operacoes">Ver todas</a></div>
        ${ops.length ? ops.map(o => opRow(o)).join('') : '<div class="empty">Nenhuma operação para hoje.</div>'}</article>
      <article class="card panel"><h3>Alertas e pendências</h3>${alertsHtml(alerts.slice(0, 6))}${alerts.length > 6 ? `<button class="link" data-act="bell">Ver todos os ${alerts.length} alertas</button>` : ''}</article>
    </section>`;
}

function viewOperations(params) {
  const all = params.get('all') === '1';
  const date = L.isDate(params.get('date')) ? params.get('date') : today();
  const status = params.get('status') || '';
  const list = state.operations.filter(o => (all || o.date === date) && (!status || o.status === status)).sort(byOpOrder);
  const statusOptions = Object.entries(OP_STATUS).map(([v, l]) => `<option value="${v}"${v === status ? ' selected' : ''}>${l}</option>`).join('');
  const subtitle = all ? 'Todas as datas' : date === today() ? 'Hoje' : L.fmtDate(date);
  return `${pageHeader('Operações', `${subtitle} • ${L.plural(list.length, 'operação', 'operações')}`, newButton('operations', 'Nova operação', all ? undefined : { date }) + `<button class="secondary" data-act="export-csv" data-store="operations">Exportar CSV</button>`)}
    <div class="card toolbar">
      <button class="secondary" data-act="op-day" data-delta="-1" aria-label="Dia anterior"${all ? ' disabled' : ''}>◀</button>
      <input type="date" value="${date}" data-act="op-date" aria-label="Data"${all ? ' disabled' : ''}>
      <button class="secondary" data-act="op-day" data-delta="1" aria-label="Próximo dia"${all ? ' disabled' : ''}>▶</button>
      <button class="secondary" data-act="op-day" data-delta="0">Hoje</button>
      <label><input type="checkbox" data-act="op-all"${all ? ' checked' : ''}> Todas as datas</label>
      <select data-act="op-filter" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${statusOptions}</select>
    </div>
    <article class="card panel">${list.length ? list.map(o => opRow(o, all)).join('') : '<div class="empty">Nenhuma operação encontrada com esses filtros.</div>'}</article>`;
}

function viewMachines() {
  const cards = state.machines.slice().sort(byName).map(m => {
    const current = L.hourmeterOf(state, m);
    const service = L.machineService(state, m);
    const status = L.machineInMaintenance(state, m) && m.status !== 'inativa' ? 'manutencao' : m.status || 'ativa';
    const serviceHtml = service
      ? `<div class="service ${service.due ? 'due' : service.soon ? 'soon' : ''}"><small>${service.due ? `Revisão vencida (prevista em ${L.fmtNum(service.next, 1)} h)` : `Próxima revisão em ${L.fmtNum(service.next, 1)} h • faltam ${L.fmtNum(service.left, 1)} h`}</small><div class="progress"><span style="width:${service.pct.toFixed(0)}%"></span></div></div>`
      : '<small class="muted">Sem revisão programada</small>';
    return `<article class="card machine"><div class="machine-head"><div><strong>${esc(m.name)}</strong><small>${esc([m.kind, m.model].filter(Boolean).join(' • '))}</small></div>${chip(MACHINE_STATUS[status] || status, status)}</div>
      <div class="machine-hours"><span>Horímetro</span><b>${L.fmtNum(current, 1)} h</b></div>${serviceHtml}
      ${rowActions('machines', m.id, `<button class="link" data-act="new" data-store="hourmeterLogs"${defaultsAttr({ machineId: m.id })}>Horímetro</button><button class="link" data-act="new" data-store="maintenance"${defaultsAttr({ machineId: m.id, hourmeter: current || '' })}>Manutenção</button>`)}</article>`;
  }).join('');
  const maint = state.maintenance.slice().sort((a, b) => (a.status === 'aberta' ? 0 : 1) - (b.status === 'aberta' ? 0 : 1) || byDateDesc('date')(a, b));
  const logs = state.hourmeterLogs.slice().sort(byDateDesc('date'));
  return `${pageHeader('Máquinas e manutenção', `${L.plural(state.machines.length, 'máquina', 'máquinas')} • ${L.plural(state.maintenance.filter(m => m.status === 'aberta').length, 'manutenção aberta', 'manutenções abertas')}`, newButton('machines') + newButton('hourmeterLogs', 'Horímetro', undefined, 'secondary') + newButton('maintenance', 'Manutenção', undefined, 'secondary'))}
    ${state.machines.length ? `<section class="machines">${cards}</section>` : '<section class="card card-section"><div class="empty">Nenhuma máquina cadastrada.</div></section>'}
    <section class="card card-section"><div class="section-head"><h3>Manutenções</h3><button class="link" data-act="export-csv" data-store="maintenance">Exportar CSV</button></div>
      ${table([
        { label: 'Data', html: r => esc(L.fmtDate(r.date)) },
        { label: 'Máquina', html: r => esc(L.refName(state, 'machines', r.machineId)) },
        { label: 'Tipo', html: r => esc(MAINT_KINDS[r.kind] || r.kind) },
        { label: 'Serviço', html: r => esc(r.description) },
        { label: 'Horímetro', num: true, html: r => (r.hourmeter === '' ? '—' : `${L.fmtNum(L.num(r.hourmeter), 1)} h`) },
        { label: 'Custo', num: true, html: r => (r.cost === '' ? '—' : esc(L.fmtMoney(L.num(r.cost)))) },
        { label: 'Situação', html: r => chip(MAINT_STATUS[r.status] || r.status, r.status) },
        actionsCol('maintenance', r => (r.status === 'aberta' ? `<button class="link" data-act="maint-done" data-id="${esc(r.id)}">Concluir</button>` : '')),
      ], maint, 'Nenhuma manutenção registrada.')}</section>
    <section class="card card-section"><div class="section-head"><h3>Registros de horímetro</h3><button class="link" data-act="export-csv" data-store="hourmeterLogs">Exportar CSV</button></div>
      ${table([
        { label: 'Data', html: r => esc(L.fmtDate(r.date)) },
        { label: 'Máquina', html: r => esc(L.refName(state, 'machines', r.machineId)) },
        { label: 'Leitura', num: true, html: r => `${L.fmtNum(L.num(r.reading), 1)} h` },
        { label: 'Observações', html: r => esc(r.notes || '') },
        actionsCol('hourmeterLogs'),
      ], logs, 'Nenhum registro de horímetro.')}</section>`;
}

function viewFields() {
  const rows = state.fields.slice().sort(byName);
  const total = rows.reduce((s, f) => s + L.num(f.areaHa), 0);
  const opsOf = id => state.operations.filter(o => o.fieldId === id);
  const footer = rows.length ? `<tfoot><tr><td data-label="Total">Total</td><td class="num" data-label="Área">${L.fmtNum(total)} ha</td><td colspan="4"></td></tr></tfoot>` : '';
  return `${pageHeader('Talhões', `${L.plural(rows.length, 'talhão', 'talhões')} • ${L.fmtNum(total)} ha`, newButton('fields') + `<button class="secondary" data-act="export-csv" data-store="fields">Exportar CSV</button>`)}
    <section class="card card-section">${table([
      { label: 'Talhão', html: r => `<strong>${esc(r.name)}</strong>` },
      { label: 'Área', num: true, html: r => (r.areaHa === '' ? '—' : `${L.fmtNum(L.num(r.areaHa))} ha`) },
      { label: 'Cultura', html: r => esc(r.crop || '—') },
      { label: 'Operações', num: true, html: r => String(opsOf(r.id).length) },
      { label: 'Última operação', html: r => { const last = opsOf(r.id).sort(byOpOrder)[0]; return last ? esc(`${last.type} • ${L.fmtDate(last.date)}`) : '—'; } },
      actionsCol('fields'),
    ], rows, 'Nenhum talhão cadastrado.', footer)}</section>`;
}

function viewSeeds() {
  const rows = state.productions.slice().sort(byDateDesc('plantingDate'));
  const expected = rows.reduce((s, p) => s + L.num(p.expectedKg), 0);
  const produced = rows.reduce((s, p) => s + L.producedKg(state, p.id), 0);
  return `${pageHeader('Produção de sementes', 'Campos de produção, previsão e o que já virou lote.', newButton('productions') + newButton('lots', 'Novo lote', undefined, 'secondary'))}
    <section class="summary">
      <div class="card"><small>Campos de produção</small><b>${rows.length}</b></div>
      <div class="card"><small>Produção prevista</small><b>${L.fmtNum(expected, 0)} kg</b></div>
      <div class="card"><small>Produzido em lotes</small><b>${L.fmtNum(produced, 0)} kg</b></div>
      <div class="card"><small>Lotes aprovados</small><b>${state.lots.filter(l => l.status === 'aprovado').length}</b></div>
    </section>
    <section class="card card-section"><div class="section-head"><h3>Campos de produção</h3><button class="link" data-act="export-csv" data-store="productions">Exportar CSV</button></div>${table([
      { label: 'Cultivar', html: r => `<strong>${esc(r.cultivar)}</strong>` },
      { label: 'Safra', html: r => esc(r.season || '—') },
      { label: 'Talhão', html: r => esc(L.refName(state, 'fields', r.fieldId)) },
      { label: 'Plantio', html: r => esc(L.fmtDate(r.plantingDate) || '—') },
      { label: 'Área', num: true, html: r => (r.areaHa === '' ? '—' : `${L.fmtNum(L.num(r.areaHa))} ha`) },
      { label: 'Previsto', num: true, html: r => (r.expectedKg === '' ? '—' : `${L.fmtNum(L.num(r.expectedKg), 0)} kg`) },
      { label: 'Produzido', num: true, html: r => `${L.fmtNum(L.producedKg(state, r.id), 0)} kg` },
      { label: 'Situação', html: r => chip(PROD_STATUS[r.status] || r.status, r.status) },
      actionsCol('productions', r => `<button class="link" data-act="new" data-store="lots"${defaultsAttr({ productionId: r.id })}>+ Lote</button>`),
    ], rows, 'Nenhum campo de produção cadastrado.')}</section>`;
}

function viewLots(params) {
  const status = params.get('status') || '';
  const rows = state.lots.filter(l => !status || l.status === status).sort(byDateDesc('harvestDate'));
  const options = Object.entries(LOT_STATUS).map(([v, l]) => `<option value="${v}"${v === status ? ' selected' : ''}>${l}</option>`).join('');
  return `${pageHeader('Lotes e rastreabilidade', 'Origem, análise e movimentação de cada lote.', newButton('lots') + `<button class="secondary" data-act="export-csv" data-store="lots">Exportar CSV</button>`)}
    <div class="card toolbar"><select data-act="lot-filter" aria-label="Filtrar por situação"><option value="">Todas as situações</option>${options}</select></div>
    <section class="card card-section">${table([
      { label: 'Lote', html: r => `<strong>${esc(r.code)}</strong>` },
      { label: 'Cultivar', html: r => esc(L.lotCultivar(state, r) || '—') },
      { label: 'Origem', html: r => { const p = findRecord('productions', r.productionId); return esc(p ? `${L.refName(state, 'fields', p.fieldId)} • ${p.season || ''}` : '—'); } },
      { label: 'Colheita', html: r => esc(L.fmtDate(r.harvestDate) || '—') },
      { label: 'Quantidade', num: true, html: r => (r.quantityKg === '' ? '—' : `${L.fmtNum(L.num(r.quantityKg), 0)} kg`) },
      { label: 'Germinação', num: true, html: r => (r.germination === '' || r.germination === undefined ? '—' : `${L.fmtNum(L.num(r.germination), 1)}%`) },
      { label: 'Situação', html: r => chip(LOT_STATUS[r.status] || r.status, r.status) },
      actionsCol('lots', r => `<button class="link" data-act="trace" data-id="${esc(r.id)}">Rastrear</button>`),
    ], rows, 'Nenhum lote encontrado.')}</section>`;
}

function showTrace(id) {
  const t = L.lotTrace(state, id);
  if (!t) return;
  const step = (tone, title, text) => `<div class="trace-step ${tone}"><strong>${esc(title)}</strong><small>${esc(text)}</small></div>`;
  const parts = [];
  if (t.field) parts.push(step('', `Talhão: ${t.field.name}`, [t.field.areaHa ? `${L.fmtNum(L.num(t.field.areaHa))} ha` : '', t.field.crop].filter(Boolean).join(' • ') || 'Sem detalhes'));
  if (t.production) parts.push(step('', `Campo de produção: ${t.production.cultivar}`, [t.production.season && `Safra ${t.production.season}`, t.production.plantingDate && `plantio ${L.fmtDate(t.production.plantingDate)}`, PROD_STATUS[t.production.status]].filter(Boolean).join(' • ')));
  if (!t.field && !t.production) parts.push(step('orange', 'Origem não informada', 'Ligue o lote a um campo de produção para registrar a origem.'));
  parts.push(step('purple', `Lote ${t.lot.code}`, [t.cultivar, t.lot.harvestDate && `colhido em ${L.fmtDate(t.lot.harvestDate)}`, t.lot.quantityKg !== '' && `${L.fmtNum(L.num(t.lot.quantityKg), 0)} kg`, t.lot.germination !== '' && t.lot.germination !== undefined && `germinação ${L.fmtNum(L.num(t.lot.germination), 1)}%`, LOT_STATUS[t.lot.status]].filter(Boolean).join(' • ')));
  for (const m of t.moves) parts.push(step('blue', `${MOVE_KINDS[m.kind] || m.kind}: ${m.itemName}`, [L.fmtDate(m.date), `${L.fmtNum(L.num(m.qty))} ${m.unit}`, m.notes].filter(Boolean).join(' • ')));
  const ops = t.operations.length ? `<h4>Operações relacionadas</h4>${t.operations.map(o => step('blue', `${o.type} — ${L.opPlace(state, o)}`, [L.fmtDate(o.date), OP_STATUS[o.status], o.notes].filter(Boolean).join(' • '))).join('')}` : '';
  openModal(`<h3>Rastreabilidade do lote ${esc(t.lot.code)}</h3><div class="trace">${parts.join('')}${ops}</div><div class="actions"><button class="primary" data-act="close-modal">Fechar</button></div>`);
}

function viewStock() {
  const items = state.stockItems.slice().sort(byName);
  const moves = state.stockMoves.slice().sort(byDateDesc('date'));
  const low = items.filter(i => { const q = L.stockQty(state, i.id), min = L.num(i.minQty); return q < 0 || (min > 0 && q <= min); }).length;
  return `${pageHeader('Estoque e insumos', `${L.plural(items.length, 'item', 'itens')} • ${L.plural(low, 'abaixo do mínimo', 'abaixo do mínimo')}`, newButton('stockMoves', 'Movimentar') + newButton('stockItems', 'Novo item', undefined, 'secondary'))}
    <section class="card card-section"><div class="section-head"><h3>Saldos</h3><button class="link" data-act="export-csv" data-store="stockItems">Exportar CSV</button></div>${table([
      { label: 'Item', html: r => `<strong>${esc(r.name)}</strong>` },
      { label: 'Categoria', html: r => esc(r.category) },
      { label: 'Saldo', num: true, html: r => { const q = L.stockQty(state, r.id), min = L.num(r.minQty); const isLow = q < 0 || (min > 0 && q <= min); return `${L.fmtNum(q)} ${esc(r.unit)}${isLow ? ' ' + chip('Baixo', 'cancelada') : ''}`; } },
      { label: 'Mínimo', num: true, html: r => (L.num(r.minQty) ? `${L.fmtNum(L.num(r.minQty))} ${esc(r.unit)}` : '—') },
      actionsCol('stockItems', r => `<button class="link" data-act="new" data-store="stockMoves"${defaultsAttr({ itemId: r.id })}>Movimentar</button>`),
    ], items, 'Nenhum item de estoque cadastrado.')}</section>
    <section class="card card-section"><div class="section-head"><h3>Movimentações</h3><button class="link" data-act="export-csv" data-store="stockMoves">Exportar CSV</button></div>${table([
      { label: 'Data', html: r => esc(L.fmtDate(r.date)) },
      { label: 'Item', html: r => esc(L.refName(state, 'stockItems', r.itemId)) },
      { label: 'Tipo', html: r => chip(MOVE_KINDS[r.kind] || r.kind, r.kind) },
      { label: 'Quantidade', num: true, html: r => { const d = L.moveDelta(r); return `${d > 0 ? '+' : ''}${L.fmtNum(d)} ${esc(findRecord('stockItems', r.itemId)?.unit || '')}`; } },
      { label: 'Lote', html: r => esc(L.refName(state, 'lots', r.lotId) || '—') },
      { label: 'Observações', html: r => esc(r.notes || '') },
      actionsCol('stockMoves'),
    ], moves, 'Nenhuma movimentação registrada.')}</section>`;
}

function bars(rows, max, fmt) {
  if (!rows.length) return '<div class="empty">Sem dados no período.</div>';
  return `<div class="bars">${rows.map(r => `<div class="bar-row"><span>${esc(r.label)}</span><div class="bar"><span style="width:${max ? Math.max(3, (r.value / max) * 100).toFixed(0) : 0}%"></span></div><b>${esc(fmt(r.value))}</b></div>`).join('')}</div>`;
}

function viewReports(params) {
  const t = today();
  const from = L.isDate(params.get('from')) ? params.get('from') : L.monthStart(t);
  const to = L.isDate(params.get('to')) ? params.get('to') : t;
  const r = L.buildReport(state, from, to);
  const statusChips = Object.entries(r.operations.byStatus).map(([s, n]) => chip(`${OP_STATUS[s]}: ${n}`, s)).join('');
  const lotChips = Object.entries(r.lots.byStatus).map(([s, n]) => chip(`${LOT_STATUS[s]}: ${n}`, s)).join('');
  const typeMax = Math.max(0, ...r.operations.byType.map(x => x.count));
  const hourMax = Math.max(0, ...r.hours.map(x => x.hours));
  const alerts = L.computeAlerts(state, t);
  return `${pageHeader('Relatórios', `${L.fmtDate(from)} a ${L.fmtDate(to)}`, insideApp ? '' : '<button class="secondary" data-act="print">Imprimir</button>')}
    <div class="card toolbar"><label>De <input type="date" value="${from}" data-act="rep-from"></label><label>Até <input type="date" value="${to}" data-act="rep-to"></label>
      <button class="secondary" data-act="rep-range" data-range="month">Este mês</button><button class="secondary" data-act="rep-range" data-range="30">Últimos 30 dias</button></div>
    <section class="summary">
      <div class="card"><small>Operações no período</small><b>${r.operations.total}</b></div>
      <div class="card"><small>Horas de máquina</small><b>${L.fmtNum(r.hours.reduce((s, h) => s + h.hours, 0), 1)} h</b></div>
      <div class="card"><small>Custo de manutenção</small><b>${esc(L.fmtMoney(r.maintenance.cost))}</b></div>
      <div class="card"><small>Sementes colhidas</small><b>${L.fmtNum(r.lots.kg, 0)} kg</b></div>
    </section>
    <section class="report-grid">
      <article class="card card-section"><h3>Operações por tipo</h3><div class="stat-line">${statusChips}</div>${bars(r.operations.byType.map(x => ({ label: x.type, value: x.count })), typeMax, v => String(v))}</article>
      <article class="card card-section"><h3>Horas trabalhadas por máquina</h3>${bars(r.hours.map(x => ({ label: x.name, value: x.hours })), hourMax, v => `${L.fmtNum(v, 1)} h`)}<p class="muted" style="margin-top:12px;font-size:.82rem">Calculado pelos registros de horímetro do período.</p></article>
      <article class="card card-section"><h3>Manutenções</h3><div class="stat-line">${chip(`Total: ${r.maintenance.total}`, 'programada')}${chip(`Abertas: ${r.maintenance.open}`, 'aberta')}${chip(`Custo: ${L.fmtMoney(r.maintenance.cost)}`, 'concluida')}</div></article>
      <article class="card card-section"><h3>Lotes de sementes</h3><div class="stat-line">${chip(`Lotes: ${r.lots.total}`, 'programada')}${lotChips}</div></article>
    </section>
    <section class="card card-section"><h3>Movimentação de estoque</h3>${table([
      { label: 'Item', html: x => esc(x.name) },
      { label: 'Entradas', num: true, html: x => `${L.fmtNum(x.entrada)} ${esc(x.unit)}` },
      { label: 'Saídas e consumo', num: true, html: x => `${L.fmtNum(x.saida)} ${esc(x.unit)}` },
    ], r.stock, 'Nenhuma movimentação no período.')}</section>
    <section class="card card-section"><h3>Pendências atuais</h3>${alertsHtml(alerts)}</section>
    <section class="card card-section no-print"><h3>Exportar planilhas (CSV)</h3><p>Abra no Excel, Google Planilhas ou LibreOffice. Cada arquivo traz todos os registros do cadastro.</p>
      <div class="button-row">${DATA_STORES.map(s => `<button class="secondary" data-act="export-csv" data-store="${s}">${esc(ENTITIES[s].plural)}</button>`).join('')}</div></section>`;
}

function viewSettings() {
  const basics = ['fields', 'machines', 'stockItems', 'productions'].map(s => `<div class="list-row"><div><strong>${esc(ENTITIES[s].plural)}</strong><small>${L.plural(state[s].length, 'registro', 'registros')}</small></div><div class="row-actions"><a class="link" href="#/${ENTITIES[s].route}">Ver</a>${newButton(s, 'Novo', undefined, 'link')}</div></div>`).join('');
  return `${pageHeader('Cadastros e dados', 'Informações da fazenda, cadastros básicos e cópia de segurança.')}
    <section class="card card-section"><h3>Fazenda</h3>
      <form id="settingsForm" class="settings-form">
        <div class="field"><label for="s-farm">Nome da fazenda</label><input id="s-farm" name="farmName" value="${esc(settings.farmName)}" placeholder="Ex.: Fazenda Santa Rita"></div>
        <div class="field"><label for="s-user">Seu nome</label><input id="s-user" name="userName" value="${esc(settings.userName)}" placeholder="Usado no avatar"></div>
        <div class="actions" style="grid-column:1/-1;margin:0"><button class="primary" type="submit">Salvar</button></div>
      </form></section>
    <section class="card card-section"><h3>Cadastros básicos</h3><div class="list-rows">${basics}</div></section>
    <section class="card card-section"><h3>Cópia de segurança</h3>
      <p>Os dados ficam só neste dispositivo. Exporte um backup com frequência e guarde em outro lugar (Drive, e-mail, computador). Se o aplicativo for desinstalado ou os dados forem limpos, só o backup recupera as informações.</p>
      <div class="button-row"><button class="primary" data-act="backup-export">Exportar backup</button><label class="secondary" style="cursor:pointer">Importar backup<input type="file" accept=".json,application/json" data-act="backup-import" hidden></label></div>
      <p class="muted" id="storageInfo" style="margin:12px 0 0;font-size:.85rem"></p></section>
    <section class="card card-section"><h3>Dados de exemplo</h3><p>Carregue um conjunto de dados fictícios para conhecer o aplicativo, ou apague tudo para recomeçar.</p>
      <div class="button-row"><button class="secondary" data-act="sample">Carregar dados de exemplo</button><button class="danger" data-act="wipe">Apagar todos os dados</button></div></section>
    <section class="card card-section"><h3>Sobre</h3><p>Agro Operações ${APP_VERSION} • funciona sem internet.</p></section>`;
}

function searchResultsHtml(query) {
  if (!query.trim()) return '<div class="empty">Digite para pesquisar em operações, máquinas, talhões, lotes, estoque e manutenções.</div>';
  const results = L.searchAll(state, query);
  if (!results.length) return `<div class="empty">Nada encontrado para “${esc(query)}”.</div>`;
  return `<p class="muted">${L.plural(results.length, 'resultado', 'resultados')}</p><div class="results">${results.slice(0, 100).map(r => `<button class="result" data-act="edit" data-store="${r.store}" data-id="${esc(r.id)}"><span><strong>${esc(r.title)}</strong><small>${esc(r.subtitle)}</small></span>${chip(ENTITIES[r.store].plural, 'programada')}</button>`).join('')}</div>`;
}

function viewSearch(params) {
  const q = params.get('q') || '';
  return `${pageHeader('Pesquisa', 'Encontre qualquer registro salvo no dispositivo.')}
    <input class="search-box" type="search" id="pageSearch" data-act="search" value="${esc(q)}" placeholder="Pesquisar..." aria-label="Pesquisar">
    <div id="searchResults">${searchResultsHtml(q)}</div>`;
}

const ROUTES = {
  '': { title: 'Visão Geral', view: viewDashboard },
  operacoes: { title: 'Operações do Dia', view: viewOperations },
  maquinas: { title: 'Máquinas e Manutenção', view: viewMachines },
  talhoes: { title: 'Talhões', view: viewFields },
  sementes: { title: 'Produção de Sementes', view: viewSeeds },
  lotes: { title: 'Lotes e Rastreabilidade', view: viewLots },
  estoque: { title: 'Estoque e Insumos', view: viewStock },
  relatorios: { title: 'Relatórios', view: viewReports },
  cadastros: { title: 'Cadastros', view: viewSettings },
  busca: { title: 'Pesquisa', view: viewSearch },
};

function currentRoute() {
  const [name, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: name in ROUTES ? name : '', params: new URLSearchParams(query) };
}

function setRouteParams(name, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();
  history.replaceState(null, '', `#/${name}${query ? '?' + query : ''}`);
  render();
}

// ---------- Desenho da tela
function updateChrome() {
  const alerts = L.computeAlerts(state, today());
  const badge = $('#bellBadge');
  badge.hidden = !alerts.length;
  badge.textContent = alerts.length > 99 ? '99+' : String(alerts.length);
  $('#farmLabel').textContent = settings.farmName || 'Configure em Cadastros';
  const avatar = $('#avatar');
  avatar.textContent = L.initials(settings.userName || settings.farmName);
  avatar.title = settings.userName || '';
  if ($('#alertsPopover').classList.contains('open')) fillAlertsPopover();
}

function render() {
  const { name, params } = currentRoute();
  const route = ROUTES[name];
  $('#pageTitle').textContent = route.title;
  document.title = `${route.title} • Agro Operações`;
  $('#view').innerHTML = route.view(params);
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  updateChrome();
  if (name === 'cadastros') fillStorageInfo();
}

async function fillStorageInfo() {
  const el = $('#storageInfo');
  if (!el) return;
  let text = `Armazenamento: ${db.kind}.`;
  try {
    if (navigator.storage?.persisted) text += (await navigator.storage.persisted()) ? ' Protegido contra limpeza automática.' : ' O sistema pode limpar os dados se faltar espaço — mantenha backups.';
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); text += ` Uso: ${L.fmtNum((e.usage || 0) / 1024, 0)} KB.`; }
  } catch { /* informação opcional */ }
  if ($('#storageInfo') === el) el.textContent = text;
}

function fillAlertsPopover() {
  const alerts = L.computeAlerts(state, today());
  $('#alertsPopover').innerHTML = `<h3>Alertas e pendências (${alerts.length})</h3>${alertsHtml(alerts)}`;
}

const sidebar = $('#sidebar'), overlay = $('#overlay');
const openMenu = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
const closeMenu = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
function togglePopover(force) {
  const pop = $('#alertsPopover');
  const open = force ?? !pop.classList.contains('open');
  if (open) fillAlertsPopover();
  pop.classList.toggle('open', open);
  document.querySelector('.bell').setAttribute('aria-expanded', String(open));
}

async function guarded(fn) {
  try { await fn(); } catch (err) { console.error(err); toast(`Erro: ${err?.message || err}`); }
}

// ---------- Ações
const clickActions = {
  'new': el => openForm(el.dataset.store, null, el.dataset.defaults ? JSON.parse(el.dataset.defaults) : {}),
  edit: el => { const r = findRecord(el.dataset.store, el.dataset.id); if (r) openForm(el.dataset.store, r); },
  delete: el => removeRecord(el.dataset.store, el.dataset.id),
  'maint-done': async el => {
    const r = findRecord('maintenance', el.dataset.id);
    if (!r) return;
    await saveRecord('maintenance', { ...r, status: 'concluida' });
    toast('Manutenção concluída');
    render();
  },
  trace: el => showTrace(el.dataset.id),
  'op-day': el => {
    const { params } = currentRoute();
    const delta = Number(el.dataset.delta);
    const base = L.isDate(params.get('date')) ? params.get('date') : today();
    setRouteParams('operacoes', { date: delta === 0 ? today() : L.addDays(base, delta), status: params.get('status') || '' });
  },
  'rep-range': el => {
    const t = today();
    setRouteParams('relatorios', el.dataset.range === 'month' ? { from: L.monthStart(t), to: t } : { from: L.addDays(t, -29), to: t });
  },
  'export-csv': el => exportCsv(el.dataset.store),
  'backup-export': () => saveFile(`agro-backup-${today()}.json`, 'application/json', JSON.stringify(L.makeBackup(state, { farmName: settings.farmName, userName: settings.userName }, APP_VERSION), null, 1)),
  sample: async () => {
    const hasData = DATA_STORES.some(s => state[s].length);
    if (hasData && !await confirmDialog('Os dados atuais serão substituídos pelos dados de exemplo. Exporte um backup antes se quiser guardá-los.', 'Substituir')) return;
    await replaceAllData(L.sampleData(today()), { farmName: settings.farmName || 'Fazenda Exemplo' });
    toast('Dados de exemplo carregados');
    location.hash = '#/';
    render();
  },
  wipe: async () => {
    if (!await confirmDialog('Apagar todos os dados deste dispositivo? Essa ação não pode ser desfeita. Exporte um backup antes se quiser guardá-los.', 'Apagar tudo')) return;
    await replaceAllData({}, { farmName: '', userName: '' });
    toast('Todos os dados foram apagados');
    render();
  },
  print: () => window.print(),
  theme: () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('agro-theme', next); } catch { /* sem armazenamento */ }
  },
  menu: () => openMenu(),
  'close-menu': () => closeMenu(),
  bell: () => togglePopover(),
  'close-modal': () => closeModal(),
  'confirm-yes': () => answerConfirm(true),
  'confirm-no': () => answerConfirm(false),
  install: async () => {
    if (!installPrompt) { toast('Abra o menu do navegador e escolha “Instalar aplicativo”'); return; }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#installBtn').classList.remove('show');
  },
};

const changeActions = {
  'op-status': async el => {
    const r = findRecord('operations', el.dataset.id);
    if (!r) return;
    await saveRecord('operations', { ...r, status: el.value });
    toast(`Situação: ${OP_STATUS[el.value]}`);
    render();
  },
  'op-date': el => { if (L.isDate(el.value)) setRouteParams('operacoes', { date: el.value, status: currentRoute().params.get('status') || '' }); },
  'op-all': el => { const p = currentRoute().params; setRouteParams('operacoes', { all: el.checked ? '1' : '', date: el.checked ? '' : p.get('date') || '', status: p.get('status') || '' }); },
  'op-filter': el => { const p = currentRoute().params; setRouteParams('operacoes', { all: p.get('all') || '', date: p.get('date') || '', status: el.value }); },
  'lot-filter': el => setRouteParams('lotes', { status: el.value }),
  'rep-from': el => { if (L.isDate(el.value)) setRouteParams('relatorios', { from: el.value, to: currentRoute().params.get('to') || '' }); },
  'rep-to': el => { if (L.isDate(el.value)) setRouteParams('relatorios', { from: currentRoute().params.get('from') || '', to: el.value }); },
  'backup-import': async el => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { toast('O arquivo não é um backup válido.'); return; }
    const result = L.validateBackup(parsed);
    if (!result.ok) { toast(result.error); return; }
    const when = result.exportedAt ? ` de ${new Date(result.exportedAt).toLocaleString('pt-BR')}` : '';
    if (!await confirmDialog(`Substituir todos os dados atuais pelo backup${when} (${L.plural(result.count, 'registro', 'registros')})?`, 'Importar', false)) return;
    await replaceAllData(result.data, result.settings || undefined);
    toast('Backup importado');
    render();
  },
};

document.addEventListener('click', event => {
  const el = event.target.closest('[data-act]');
  if (!el) {
    if (!event.target.closest('#alertsPopover')) togglePopover(false);
    return;
  }
  const act = el.dataset.act;
  if (act === 'modal-backdrop') { if (event.target === modal) closeModal(); return; }
  if (el.matches('select, input')) return;
  if (act !== 'bell') togglePopover(false);
  const handler = clickActions[act];
  if (handler) { if (el.tagName === 'BUTTON') event.preventDefault(); guarded(() => handler(el)); }
});

document.addEventListener('change', event => {
  const el = event.target.closest('[data-act]');
  const handler = el && changeActions[el.dataset.act];
  if (handler) guarded(() => handler(el));
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'settingsForm') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  guarded(async () => {
    settings = { ...settings, farmName: String(data.farmName || '').trim(), userName: String(data.userName || '').trim(), id: 'app' };
    await db.put('settings', settings);
    toast('Dados da fazenda salvos');
    render();
  });
});

// Pesquisa: o campo do topo e o da página usam a mesma busca.
let searchTimer;
function runSearch(query, source) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (currentRoute().name !== 'busca') {
      if (!query.trim()) return;
      location.hash = `#/busca?q=${encodeURIComponent(query)}`;
      return;
    }
    history.replaceState(null, '', `#/busca${query ? '?q=' + encodeURIComponent(query) : ''}`);
    $('#searchResults').innerHTML = searchResultsHtml(query);
    if (source !== 'page' && $('#pageSearch')) $('#pageSearch').value = query;
    if (source !== 'top') $('#topSearch').value = query;
  }, 200);
}
$('#topSearch').addEventListener('input', e => runSearch(e.target.value, 'top'));
document.addEventListener('input', e => { if (e.target.id === 'pageSearch') runSearch(e.target.value, 'page'); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (modal.classList.contains('open')) closeModal();
  togglePopover(false);
  closeMenu();
});

window.addEventListener('hashchange', () => {
  closeMenu();
  togglePopover(false);
  if (modal.classList.contains('open')) closeModal();
  render();
  window.scrollTo(0, 0);
});

// ---------- Rede e instalação
const setNetwork = () => { $('#netStatus').textContent = navigator.onLine ? 'Disponível offline' : 'Modo offline ativo'; };
addEventListener('online', setNetwork);
addEventListener('offline', setNetwork);
setNetwork();
let installPrompt = null;
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#installBtn').classList.add('show'); });
addEventListener('appinstalled', () => toast('Aplicativo instalado com sucesso'));
// Dentro do APK os arquivos já estão no aparelho: sem instalação PWA nem service worker.
if (insideApp || matchMedia('(display-mode: standalone)').matches) $('#installBtn').style.display = 'none';
if (!insideApp && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
$('#date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

// ---------- Início
async function migrateLegacy() {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem('agro-operations') || 'null'); } catch { return; }
  if (!Array.isArray(legacy)) return;
  for (const op of L.migrateLegacy(legacy, today())) await saveRecord('operations', op);
  try { localStorage.removeItem('agro-operations'); } catch { /* sem armazenamento */ }
  if (legacy.length) toast('Operações da versão anterior foram importadas');
}

async function boot() {
  try {
    db = await openDatabase();
    const all = await db.loadAll();
    for (const s of DATA_STORES) state[s] = all[s] || [];
    settings = { ...settings, ...((all.settings || []).find(s => s.id === 'app') || {}) };
    await migrateLegacy();
    navigator.storage?.persist?.().catch(() => {});
    render();
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="card boot-error"><h3>Não foi possível abrir os dados</h3><p>${esc(err?.message || err)}</p><button class="primary" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}
boot();
