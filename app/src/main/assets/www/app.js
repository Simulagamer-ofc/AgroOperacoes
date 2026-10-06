'use strict';
/* Agro Operações — app offline (dados salvos no dispositivo via localStorage). */

// ---------- Utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = s => s ? s.split('-').reverse().join('/') : '—';
const num = (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 2)});
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };
const byDateDesc = (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''));
const safeStorage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } }
};

// ---------- Banco de dados local ----------
const DB_KEY = 'agro-db-v1';
const COLLECTIONS = ['operations', 'machines', 'hourLogs', 'maintenances', 'fields', 'lots', 'lotEvents', 'stock', 'movements', 'afericoes', 'secagem', 'expenses'];
const emptyDb = () => ({version: 1, settings: {farm: '', owner: ''}, ...Object.fromEntries(COLLECTIONS.map(c => [c, []]))});

function loadDb() {
  let data = null;
  try { data = JSON.parse(safeStorage.get(DB_KEY) || 'null'); } catch { data = null; }
  if (!data) {
    data = emptyDb();
    // Migra operações da versão 0.1.0-beta1
    try {
      const legacy = JSON.parse(safeStorage.get('agro-operations') || '[]');
      legacy.forEach(op => data.operations.push({id: uid(), date: today(), time: op.time || '', type: op.type || 'Outra', fieldId: '', place: op.place || '', machineId: '', status: 'Programada', notes: op.notes || ''}));
    } catch { /* ignora */ }
  }
  const base = emptyDb();
  for (const c of COLLECTIONS) if (!Array.isArray(data[c])) data[c] = [];
  data.settings = {...base.settings, ...(data.settings || {})};
  return data;
}
let db = loadDb();
function save() {
  if (!safeStorage.set(DB_KEY, JSON.stringify(db))) showToast('Não foi possível salvar no dispositivo (armazenamento cheio?)');
}
save();

const find = (col, id) => db[col].find(x => x.id === id);
const upsert = (col, item) => {
  const i = db[col].findIndex(x => x.id === item.id);
  if (i >= 0) db[col][i] = item; else db[col].push(item);
  save();
};
const remove = (col, id) => { db[col] = db[col].filter(x => x.id !== id); save(); };

// ---------- Regras de negócio ----------
const OP_TYPES = ['Plantio', 'Aplicação', 'Adubação', 'Colheita', 'Preparo de solo', 'Transporte', 'Beneficiamento de sementes', 'Tratamento de sementes', 'Manutenção', 'Outra'];
const OP_STATUS = ['Programada', 'Em andamento', 'Concluída', 'Cancelada'];
const STATUS_COLOR = {'Programada': 'blue', 'Em andamento': 'green', 'Concluída': 'gray', 'Cancelada': 'red'};
const MACHINE_TYPES = ['Trator', 'Colheitadeira', 'Pulverizador', 'Plantadeira', 'Caminhão', 'Implemento', 'Secador', 'Moega', 'Silo/Armazém', 'Beneficiamento', 'Outro'];
const LOT_STATUS = ['Em campo', 'Colhido', 'Em beneficiamento', 'Aguardando análise', 'Aprovado', 'Reprovado', 'Expedido'];
const LOT_COLOR = {'Em campo': 'green', 'Colhido': 'blue', 'Em beneficiamento': 'purple', 'Aguardando análise': 'orange', 'Aprovado': 'green', 'Reprovado': 'red', 'Expedido': 'gray'};
const UNITS = ['L', 'kg', 't', 'sc', 'un', 'm³', 'big bag'];
const SERVICE_WARN_HOURS = 25;

const fieldName = id => find('fields', id)?.name || '';
const machineName = id => find('machines', id)?.name || '';
const opPlace = op => fieldName(op.fieldId) || op.place || 'Local não informado';
const openMaintenances = machineId => db.maintenances.filter(m => m.status !== 'Concluída' && (!machineId || m.machineId === machineId));
const isInactive = m => m.state === 'Inativa';
const machineStatus = m => openMaintenances(m.id).length ? 'Em manutenção' : (isInactive(m) ? 'Inativa' : 'Disponível');
const hoursToService = m => (Number(m.nextService) || 0) - (Number(m.hours) || 0);
const stockLow = s => Number(s.min) > 0 && Number(s.qty) <= Number(s.min);

function alerts() {
  const list = [];
  db.stock.filter(stockLow).forEach(s => list.push({color: 'red', icon: '!', title: `Estoque baixo: ${s.name}`, text: `Saldo ${num(s.qty)} ${s.unit} (mínimo ${num(s.min)} ${s.unit}).`, route: 'estoque'}));
  db.machines.filter(m => !isInactive(m) && Number(m.nextService) > 0 && hoursToService(m) <= SERVICE_WARN_HOURS).forEach(m => {
    const left = hoursToService(m);
    const pct = Math.max(0, Math.min(100, 100 - (left / (Number(m.interval) || 250)) * 100));
    list.push({color: 'orange', icon: '⚙', title: left <= 0 ? `Revisão vencida: ${m.name}` : `Revisão em ${num(left)} h: ${m.name}`, text: `Horímetro em ${num(m.hours)} h; revisão programada para ${num(m.nextService)} h.`, progress: pct, route: 'maquinas'});
  });
  openMaintenances().forEach(mt => list.push({color: 'orange', icon: '⚙', title: `Manutenção aberta: ${machineName(mt.machineId) || 'máquina'}`, text: `${mt.kind} — ${mt.description || 'sem descrição'} (desde ${fmtDate(mt.date)}).`, route: 'maquinas'}));
  db.lots.filter(l => l.status === 'Aguardando análise').forEach(l => list.push({color: 'purple', icon: '⌁', title: `Lote aguardando análise: ${l.code}`, text: 'Registre o resultado de germinação/vigor.', route: 'lotes/' + l.id}));
  db.operations.filter(o => o.status === 'Programada' && o.date && o.date < today()).forEach(o => list.push({color: 'red', icon: '◷', title: `Operação atrasada: ${o.type} — ${opPlace(o)}`, text: `Programada para ${fmtDate(o.date)}.`, route: 'operacoes'}));
  return list;
}

// ---------- Interface: elementos gerais ----------
const root = document.documentElement, sidebar = $('#sidebar'), overlay = $('#overlay'), modal = $('#modal'), dialog = $('#dialog'), toastEl = $('#toast'), view = $('#view');
let toastTimer;
function showToast(message) { toastEl.textContent = message; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800); }
const savedTheme = safeStorage.get('agro-theme'); if (savedTheme) root.dataset.theme = savedTheme;
$('#themeBtn').onclick = () => { const next = (root.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark'; root.dataset.theme = next; safeStorage.set('agro-theme', next); };
const closeMenu = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };
const openMenu = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
$('#menuBtn').onclick = openMenu; $('#moreBtn').onclick = openMenu; overlay.onclick = closeMenu;
$('#bellBtn').onclick = () => go('inicio', 'alertas');
$$('[data-route]').forEach(b => b.addEventListener('click', () => { go(b.dataset.route); closeMenu(); }));
$('#date').textContent = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: '2-digit', month: 'long'});
$('#searchForm').onsubmit = e => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) go('busca/' + encodeURIComponent(q)); };
function applySettings() {
  $('#farmName').textContent = db.settings.farm || 'Minha fazenda';
  const initials = (db.settings.owner || db.settings.farm || 'Agro Operações').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  $('#avatar').textContent = initials || 'AO';
}
applySettings();

// ---------- Modal e formulários genéricos ----------
function closeModal() { modal.classList.remove('open'); dialog.innerHTML = ''; }
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

/**
 * Abre um formulário.
 * fields: [{k, label, type, options, required, full, hint, step, placeholder}]
 * onSubmit(values) → retorna string de erro para manter aberto, ou nada para fechar.
 */
function openForm({title, sub, fields, values = {}, submit = 'Salvar no dispositivo', onSubmit}) {
  const input = f => {
    const v = values[f.k] ?? f.default ?? '';
    const common = `name="${f.k}" id="f_${f.k}" ${f.required ? 'required' : ''}`;
    if (f.type === 'select') {
      const opts = (typeof f.options === 'function' ? f.options() : f.options).map(o => typeof o === 'string' ? {value: o, label: o} : o);
      return `<select ${common}>${f.required ? '' : '<option value="">—</option>'}${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }
    if (f.type === 'textarea') return `<textarea ${common} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    return `<input ${common} type="${f.type || 'text'}" value="${esc(v)}" ${f.type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"` : ''} ${f.min != null ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}">`;
  };
  dialog.innerHTML = `<h3>${esc(title)}</h3>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}<form novalidate><div class="form">${fields.map(f => `<div class="field ${f.full || f.type === 'textarea' ? 'full' : ''}"><label for="f_${f.k}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input(f)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`).join('')}</div><div class="actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary" type="submit">${esc(submit)}</button></div></form>`;
  const form = $('form', dialog);
  $('[data-close]', dialog).onclick = closeModal;
  form.onsubmit = e => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const out = {};
    fields.forEach(f => { const raw = form.elements[f.k].value.trim(); out[f.k] = f.type === 'number' ? (raw === '' ? '' : Number(raw.replace(',', '.'))) : raw; });
    const err = onSubmit(out);
    if (err) { showToast(err); return; }
    closeModal(); render();
  };
  modal.classList.add('open');
  setTimeout(() => form.elements[0]?.focus(), 50);
}

function confirmDialog(message, onYes, yesLabel = 'Excluir') {
  dialog.innerHTML = `<h3>Confirmar</h3><p>${esc(message)}</p><div class="actions"><button class="secondary" data-close>Cancelar</button><button class="primary" style="background:var(--red);box-shadow:none" data-yes>${esc(yesLabel)}</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-yes]', dialog).onclick = () => { onYes(); closeModal(); render(); };
  modal.classList.add('open');
}

// ---------- Formulários de cada entidade ----------
const fieldOptions = () => db.fields.map(f => ({value: f.id, label: f.name}));
const machineOptions = () => db.machines.filter(m => !isInactive(m)).map(m => ({value: m.id, label: `${m.name} (${num(m.hours)} h)`}));
const stockOptions = () => db.stock.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`}));

function operationForm(op = {}) {
  openForm({
    title: op.id ? 'Editar operação' : 'Nova operação',
    values: {date: today(), time: nowTime(), status: 'Programada', ...op},
    fields: [
      {k: 'type', label: 'Tipo de operação', type: 'select', options: OP_TYPES, required: true, full: true},
      {k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, hint: db.fields.length ? '' : 'Cadastre talhões para selecioná-los aqui'},
      {k: 'place', label: 'Outro local', placeholder: 'Ex.: Unidade de beneficiamento'},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'time', label: 'Horário', type: 'time'},
      {k: 'machineId', label: 'Máquina', type: 'select', options: machineOptions},
      {k: 'status', label: 'Situação', type: 'select', options: OP_STATUS, required: true},
      {k: 'area', label: 'Área trabalhada (ha)', type: 'number', min: 0},
      {k: 'operator', label: 'Operador / equipe'},
      {k: 'notes', label: 'Observações', type: 'textarea', placeholder: 'Insumos, dose, condições do tempo...'}
    ],
    onSubmit: v => {
      if (!v.fieldId && !v.place) return 'Informe o talhão ou o local da operação';
      upsert('operations', {...op, ...v, id: op.id || uid(), createdAt: op.createdAt || new Date().toISOString()});
      showToast('Operação salva no dispositivo');
    }
  });
}

function machineForm(m = {}) {
  openForm({
    title: m.id ? 'Editar máquina' : 'Nova máquina',
    values: {interval: 250, state: 'Ativa', ...m},
    fields: [
      {k: 'name', label: 'Identificação', required: true, placeholder: 'Ex.: Trator 7230J', full: true},
      {k: 'type', label: 'Tipo', type: 'select', options: MACHINE_TYPES, required: true},
      {k: 'model', label: 'Marca / modelo'},
      {k: 'hours', label: 'Horímetro atual (h)', type: 'number', min: 0, required: true},
      {k: 'interval', label: 'Intervalo de revisão (h)', type: 'number', min: 0},
      {k: 'nextService', label: 'Próxima revisão em (h)', type: 'number', min: 0, hint: 'Vazio = horímetro atual + intervalo'},
      {k: 'state', label: 'Situação', type: 'select', options: ['Ativa', 'Inativa'], required: true}
    ],
    onSubmit: v => {
      if (v.nextService === '' && v.interval) v.nextService = Number(v.hours) + Number(v.interval);
      upsert('machines', {...m, ...v, id: m.id || uid()});
      showToast('Máquina salva');
    }
  });
}

function hourForm(machineId) {
  if (!db.machines.length) { showToast('Cadastre uma máquina primeiro'); return machineForm(); }
  openForm({
    title: 'Registrar horímetro',
    values: {machineId, date: today()},
    fields: [
      {k: 'machineId', label: 'Máquina', type: 'select', options: machineOptions, required: true, full: true},
      {k: 'hours', label: 'Leitura do horímetro (h)', type: 'number', min: 0, required: true},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      const m = find('machines', v.machineId);
      if (!m) return 'Selecione a máquina';
      if (Number(v.hours) < Number(m.hours || 0)) return `Leitura menor que o horímetro atual (${num(m.hours)} h)`;
      db.hourLogs.push({id: uid(), machineId: m.id, date: v.date, hours: v.hours, previous: Number(m.hours || 0), notes: v.notes});
      m.hours = v.hours; save();
      showToast(`Horímetro de ${m.name}: ${num(v.hours)} h (+${num(v.hours - (db.hourLogs.at(-1).previous))} h)`);
    }
  });
}

function maintenanceForm(mt = {}) {
  if (!db.machines.length) { showToast('Cadastre uma máquina primeiro'); return machineForm(); }
  openForm({
    title: mt.id ? 'Editar manutenção' : 'Abrir manutenção',
    values: {date: today(), kind: 'Preventiva', status: 'Aberta', ...mt},
    fields: [
      {k: 'machineId', label: 'Máquina', type: 'select', options: () => db.machines.map(m => ({value: m.id, label: m.name})), required: true, full: true},
      {k: 'kind', label: 'Tipo', type: 'select', options: ['Preventiva', 'Corretiva'], required: true},
      {k: 'date', label: 'Data de abertura', type: 'date', required: true},
      {k: 'description', label: 'Serviço', placeholder: 'Ex.: Troca de óleo e filtros', full: true, required: true},
      {k: 'cost', label: 'Custo (R$)', type: 'number', min: 0},
      {k: 'status', label: 'Situação', type: 'select', options: ['Aberta', 'Em execução', 'Concluída'], required: true},
      {k: 'notes', label: 'Peças e observações', type: 'textarea'}
    ],
    onSubmit: v => {
      const item = {...mt, ...v, id: mt.id || uid()};
      if (v.status === 'Concluída' && mt.status !== 'Concluída') finishMaintenance(item, false);
      upsert('maintenances', item);
      showToast('Manutenção salva');
    }
  });
}

function finishMaintenance(mt, persist = true) {
  mt.status = 'Concluída'; mt.doneDate = mt.doneDate || today();
  const m = find('machines', mt.machineId);
  if (m) {
    mt.doneHours = Number(m.hours || 0);
    if (mt.kind === 'Preventiva' && Number(m.interval) > 0) m.nextService = Number(m.hours || 0) + Number(m.interval);
  }
  if (persist) { upsert('maintenances', mt); showToast('Manutenção concluída' + (m && mt.kind === 'Preventiva' ? ` — próxima revisão em ${num(m.nextService)} h` : '')); }
}

function fieldForm(f = {}) {
  openForm({
    title: f.id ? 'Editar talhão' : 'Novo talhão',
    values: f,
    fields: [
      {k: 'name', label: 'Nome / número', required: true, placeholder: 'Ex.: Talhão 07'},
      {k: 'area', label: 'Área (ha)', type: 'number', min: 0, required: true},
      {k: 'crop', label: 'Cultura atual', placeholder: 'Ex.: Soja'},
      {k: 'cultivar', label: 'Cultivar'},
      {k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'},
      {k: 'plantingDate', label: 'Data de plantio', type: 'date'},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => { upsert('fields', {...f, ...v, id: f.id || uid()}); showToast('Talhão salvo'); }
  });
}

function lotForm(l = {}) {
  openForm({
    title: l.id ? 'Editar lote' : 'Novo lote de sementes',
    values: {status: 'Em campo', ...l},
    fields: [
      {k: 'code', label: 'Código do lote', required: true, placeholder: 'Ex.: SM-027'},
      {k: 'species', label: 'Espécie', placeholder: 'Ex.: Soja'},
      {k: 'cultivar', label: 'Cultivar', required: true},
      {k: 'category', label: 'Categoria', type: 'select', options: ['Genética', 'Básica', 'C1', 'C2', 'S1', 'S2']},
      {k: 'fieldId', label: 'Talhão de origem', type: 'select', options: fieldOptions},
      {k: 'season', label: 'Safra'},
      {k: 'weight', label: 'Peso (kg)', type: 'number', min: 0},
      {k: 'status', label: 'Situação', type: 'select', options: LOT_STATUS, required: true},
      {k: 'germination', label: 'Germinação (%)', type: 'number', min: 0},
      {k: 'vigor', label: 'Vigor (%)', type: 'number', min: 0},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      const dup = db.lots.find(x => x.code.toLowerCase() === v.code.toLowerCase() && x.id !== l.id);
      if (dup) return 'Já existe um lote com esse código';
      const item = {...l, ...v, id: l.id || uid()};
      if (!l.id) db.lotEvents.push({id: uid(), lotId: item.id, date: today(), title: 'Lote cadastrado', text: `Situação inicial: ${v.status}`});
      else if (l.status !== v.status) db.lotEvents.push({id: uid(), lotId: item.id, date: today(), title: `Situação: ${v.status}`, text: `Anterior: ${l.status}`});
      if (l.germination !== v.germination && v.germination !== '') db.lotEvents.push({id: uid(), lotId: item.id, date: today(), title: 'Análise registrada', text: `Germinação ${num(v.germination)}%` + (v.vigor !== '' ? ` • vigor ${num(v.vigor)}%` : '')});
      upsert('lots', item);
      showToast('Lote salvo');
    }
  });
}

function lotEventForm(lotId) {
  openForm({
    title: 'Registrar evento do lote',
    values: {date: today()},
    fields: [
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'title', label: 'Evento', required: true, placeholder: 'Ex.: Colheita, secagem, tratamento, expedição'},
      {k: 'text', label: 'Detalhes', type: 'textarea'}
    ],
    onSubmit: v => { db.lotEvents.push({id: uid(), lotId, ...v}); save(); showToast('Evento registrado'); }
  });
}

function stockForm(s = {}) {
  openForm({
    title: s.id ? 'Editar item' : 'Novo item de estoque',
    values: {unit: 'L', qty: 0, ...s},
    fields: [
      {k: 'name', label: 'Produto / insumo', required: true, full: true},
      {k: 'category', label: 'Categoria', type: 'select', options: ['Defensivo', 'Fertilizante', 'Semente', 'Tratamento de sementes', 'Combustível', 'Peças', 'Embalagem', 'Outro']},
      {k: 'unit', label: 'Unidade', type: 'select', options: UNITS, required: true},
      ...(s.id ? [] : [{k: 'qty', label: 'Saldo inicial', type: 'number', min: 0, required: true}]),
      {k: 'min', label: 'Estoque mínimo', type: 'number', min: 0, hint: 'Gera alerta quando o saldo ficar abaixo'},
      {k: 'location', label: 'Local de armazenagem'}
    ],
    onSubmit: v => { upsert('stock', {...s, ...v, id: s.id || uid()}); showToast('Item salvo'); }
  });
}

function movementForm(itemId) {
  if (!db.stock.length) { showToast('Cadastre um item de estoque primeiro'); return stockForm(); }
  openForm({
    title: 'Movimentar estoque',
    values: {itemId, kind: 'Saída', date: today()},
    fields: [
      {k: 'itemId', label: 'Item', type: 'select', options: stockOptions, required: true, full: true},
      {k: 'kind', label: 'Movimento', type: 'select', options: ['Entrada', 'Saída', 'Ajuste de inventário'], required: true},
      {k: 'qty', label: 'Quantidade', type: 'number', min: 0, required: true, hint: 'No ajuste, informe o saldo contado'},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'fieldId', label: 'Talhão (consumo)', type: 'select', options: fieldOptions},
      {k: 'notes', label: 'Documento / observações', type: 'textarea'}
    ],
    onSubmit: v => {
      const s = find('stock', v.itemId);
      if (!s) return 'Selecione o item';
      const before = Number(s.qty || 0);
      if (v.kind === 'Saída' && v.qty > before) return `Saldo insuficiente (${num(before)} ${s.unit})`;
      s.qty = v.kind === 'Entrada' ? before + v.qty : v.kind === 'Saída' ? before - v.qty : v.qty;
      db.movements.push({id: uid(), ...v, before, after: s.qty});
      save();
      showToast(`${s.name}: saldo ${num(s.qty)} ${s.unit}`);
    }
  });
}

// ---------- Componentes de lista ----------
const chip = (text, color) => `<span class="chip ${color || 'gray'}">${esc(text)}</span>`;
const empty = (title, text, action) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}${action ? `<div><button class="primary" data-act="${action.act}">${esc(action.label)}</button></div>` : ''}</div>`;
const head = (title, text, buttons = '') => `<section class="view-head"><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div><div class="btns">${buttons}</div></section>`;
const btn = (label, act, id = '', cls = 'primary') => `<button class="${cls}" data-act="${act}" ${id ? `data-id="${esc(id)}"` : ''}>${esc(label)}</button>`;
const mini = (label, act, id, cls = '') => `<button class="${cls}" data-act="${act}" data-id="${esc(id)}">${esc(label)}</button>`;

function operationRow(o, actions = true) {
  const color = STATUS_COLOR[o.status] || 'blue';
  const parts = [fmtDate(o.date) + (o.time ? ' ' + o.time : ''), machineName(o.machineId), o.area ? `${num(o.area)} ha` : '', o.operator, o.notes].filter(Boolean);
  const acts = !actions ? chip(o.status, color) : `<div class="row-actions">${chip(o.status, color)}${o.status === 'Programada' ? mini('▶ Iniciar', 'op-start', o.id) : ''}${o.status === 'Em andamento' ? mini('✓ Concluir', 'op-done', o.id, 'ok') : ''}${mini('Editar', 'op-edit', o.id)}${mini('Excluir', 'op-del', o.id, 'del')}</div>`;
  return `<div class="row"><span class="status ${color === 'gray' ? 'green' : color}"></span><div><strong>${esc(o.type)} — ${esc(opPlace(o))}</strong><small>${esc(parts.join(' • '))}</small></div>${acts}</div>`;
}

// ---------- Telas ----------
const VIEWS = {};
const TITLES = {inicio: 'Visão geral', operacoes: 'Operações do dia', maquinas: 'Máquinas e manutenção', talhoes: 'Talhões', sementes: 'Produção de sementes', lotes: 'Lotes e rastreabilidade', estoque: 'Estoque e insumos', relatorios: 'Relatórios', cadastros: 'Cadastros e backup', busca: 'Pesquisa'};

VIEWS.inicio = (anchor) => {
  const t = today();
  const todays = db.operations.filter(o => o.date === t);
  const running = db.operations.filter(o => o.status === 'Em andamento');
  const al = alerts();
  const isEmpty = COLLECTIONS.every(c => !db[c].length);
  const upcoming = db.operations.filter(o => o.status === 'Em andamento' || (o.date >= t && o.status === 'Programada') || o.date === t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 8);
  // Alertas de manutenção e estoque (os demais alertas continuam na lista “Atenção”)
  const mtAbertas = db.maintenances.filter(m => m.status !== 'Concluída').length;
  const revisoes = db.machines.filter(m => !isInactive(m) && Number(m.nextService) > 0 && hoursToService(m) <= SERVICE_WARN_HOURS).length;
  const estBaixo = db.stock.filter(stockLow).length;
  const partes = [mtAbertas && `${mtAbertas} ${mtAbertas === 1 ? 'manutenção' : 'manutenções'}`, revisoes && `${revisoes} ${revisoes === 1 ? 'revisão' : 'revisões'}`, estBaixo && `${estBaixo} estoque baixo`].filter(Boolean);
  const tipos = [...new Set(todays.map(o => o.type))];
  return `
    <section class="hero"><img class="hero-arte" src="img/centro-operacoes.jpg" alt="" aria-hidden="true">
      <div class="hero-txt"><h2>Centro de operações</h2><p>${esc(db.settings.farm ? `Planeje, registre e conclua o trabalho no campo — ${db.settings.farm}.` : 'Planeje, registre e conclua o trabalho no campo.')}</p></div>
      <button class="primary hero-cta" data-act="op-new">+ Nova operação</button></section>
    <section class="kpis nexus">
      <article class="card kpi"><div class="label">Operações hoje</div><div class="value">${todays.length}</div><div class="hint">${esc(tipos.join(', ') || 'Nenhuma operação hoje')}</div></article>
      <article class="card kpi"><div class="label">Em andamento</div><div class="value">${running.length}</div><div class="hint">${running.length === 1 ? 'Operação aberta' : 'Operações abertas'}</div></article>
      <article class="card kpi"><div class="label">Alertas de manutenção e estoque</div><div class="value">${mtAbertas + revisoes + estBaixo}</div><div class="hint">${esc(partes.join(' · ') || 'Tudo em dia')}</div></article>
    </section>
    <div class="nx-acoes"><button data-act="hour-new">◷ Registrar horímetro</button><button data-act="mt-new">⚙ Abrir manutenção</button><button data-act="mov-new">⇄ Movimentar estoque</button><button data-act="af-nova">◎ Nova aferição</button></div>
    ${isEmpty ? `<section class="card" style="margin-top:18px">${empty('Nenhum dado cadastrado ainda', 'Comece cadastrando talhões, máquinas e insumos — ou carregue dados de exemplo para conhecer o aplicativo.', {act: 'seed', label: 'Carregar dados de exemplo'})}</section>` : (typeof painelNexus === 'function' ? painelNexus() : '')}
    <section class="grid nexus">
      <article class="card panel"><div class="section-title" style="margin:0 0 4px"><h3>Operações de hoje</h3><button data-act="nav" data-id="operacoes">Ver todas</button></div>
        ${upcoming.length ? upcoming.map(o => operationRow(o, false)).join('') : empty('Sem operações para hoje', 'Toque em “Nova operação” para registrar.')}
      </article>
      <article class="card panel" id="alertas"><h3>Atenção</h3>
        ${al.length ? al.map(a => `<div class="alert clickable" data-act="nav" data-id="${esc(a.route)}"><span class="alert-icon ${a.color}">${a.icon}</span><div style="flex:1"><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small>${a.progress != null ? `<div class="progress"><span style="width:${a.progress}%"></span></div>` : ''}</div></div>`).join('') : empty('Tudo em dia', 'Nenhuma pendência encontrada.')}
      </article>
    </section>
    ${!isEmpty && typeof painelGraficos === 'function' ? painelGraficos() : ''}`;
};
VIEWS.inicio.after = anchor => { if (anchor) document.getElementById(anchor)?.scrollIntoView({behavior: 'smooth'}); };

let opFilter = 'hoje';
VIEWS.operacoes = () => {
  const t = today();
  const filters = {hoje: ['Hoje', o => o.date === t || o.status === 'Em andamento'], proximas: ['Próximas', o => o.date > t && o.status === 'Programada'], abertas: ['Em aberto', o => o.status === 'Programada' || o.status === 'Em andamento'], concluidas: ['Concluídas', o => o.status === 'Concluída'], todas: ['Todas', () => true]};
  const list = db.operations.filter(filters[opFilter][1]).sort(byDateDesc);
  return head('Operações', 'Planeje, inicie e conclua as atividades de campo.', btn('+ Nova operação', 'op-new')) +
    `<div class="filters">${Object.entries(filters).map(([k, [label, fn]]) => `<button class="${k === opFilter ? 'active' : ''}" data-act="op-filter" data-id="${k}">${label} (${db.operations.filter(fn).length})</button>`).join('')}</div>` +
    `<section class="card list">${list.length ? list.map(o => operationRow(o)).join('') : empty('Nenhuma operação neste filtro', '', {act: 'op-new', label: '+ Nova operação'})}</section>`;
};

VIEWS.maquinas = () => {
  const ms = db.machines.slice().sort((a, b) => a.name.localeCompare(b.name));
  const mts = db.maintenances.slice().sort((a, b) => (a.status === 'Concluída') - (b.status === 'Concluída') || b.date.localeCompare(a.date));
  return head('Máquinas e manutenção', 'Horímetro, revisões programadas e ordens de manutenção.', btn('Registrar horímetro', 'hour-new', '', 'secondary') + btn('Abrir manutenção', 'mt-new', '', 'secondary') + btn('+ Nova máquina', 'mc-new')) +
    (ms.length ? `<section class="cards">${ms.map(m => {
      const st = machineStatus(m), left = hoursToService(m), temRev = Number(m.nextService) > 0;
      const color = st === 'Em manutenção' ? 'orange' : st === 'Inativa' ? 'gray' : 'green';
      // Barra até a próxima revisão: horas desde a última revisão ÷ intervalo
      const intervalo = Number(m.interval) || 250, pct = temRev ? Math.max(0, Math.min(100, 100 - left / intervalo * 100)) : 0;
      const corRev = !temRev ? '' : left <= 0 ? 'rev-vencida' : left <= SERVICE_WARN_HOURS ? 'rev-alerta' : 'rev-ok';
      const textoRev = !temRev ? 'Sem revisão programada' : left <= 0 ? `! Revisão vencida há ${num(-left)} h` : `Revisão em ${num(left)} h (${num(m.nextService)} h)`;
      const af = db.afericoes.filter(a => a.maquina?.id === m.id).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))[0];
      const cfgN = m.config ? Object.keys(m.config).length : 0;
      const extras = [cfgN ? `Configuração para aferição: ${cfgN} ${cfgN === 1 ? 'parâmetro' : 'parâmetros'}` : '', m.catalogo ? `Catálogo: ${esc(m.catalogo.marca)} ${esc(m.catalogo.nome)}` : '', af ? `Última aferição: ${fmtDate(af.data)} — ${esc({OK: 'dentro da referência', ATENCAO: 'atenção', FORA_DO_PADRAO: 'fora da referência', SEM_REFERENCIA: 'não avaliada', DADOS_INSUFICIENTES: 'dados insuficientes'}[af.resultado.status] || '')}` : ''].filter(Boolean);
      return `<article class="card item-card maq-card"><header><div><h4>${esc(m.name)}</h4><div class="meta">${esc([m.type, m.model].filter(Boolean).join(' • '))}</div></div>${chip(st, color)}</header>
        <div class="maq-horas"><span class="big">${num(m.hours)} h</span><small>último registro ${fmtDate(db.hourLogs.filter(h => h.machineId === m.id).sort(byDateDesc)[0]?.date)}</small></div>
        <div class="maq-rev ${corRev}"><small>${textoRev}</small>${temRev ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}</div>
        ${extras.length ? `<div class="meta">${extras.map(x => `<span>${x}</span>`).join('')}</div>` : ''}
        <div class="maq-acoes">${mini('◷ Horímetro', 'hour-new', m.id)}${mini('⚙ Manutenção', 'mt-new', m.id)}
          <details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">
            ${mini('◎ Aferição e calibragem', 'af-nova', m.id)}${mini('⚙ Configuração para aferição', 'mc-config', m.id)}${m.catalogo ? mini('Ficha técnica', 'mc-ficha', m.id) : ''}${mini(m.catalogo ? 'Trocar vínculo do catálogo' : 'Vincular ao catálogo', 'mc-cat', m.id)}${mini('Editar', 'mc-edit', m.id)}${mini('Excluir', 'mc-del', m.id, 'del')}
          </div></details></div></article>`;
    }).join('')}</section>` : `<section class="card">${empty('Nenhuma máquina cadastrada', 'Cadastre tratores, colheitadeiras e implementos para controlar horímetro e revisões.', {act: 'mc-new', label: '+ Nova máquina'})}</section>`) +
    `<div class="section-title"><h3>Ordens de manutenção</h3></div><section class="card list">${mts.length ? mts.map(mt => {
      const color = mt.status === 'Concluída' ? 'gray' : mt.status === 'Em execução' ? 'blue' : 'orange';
      return `<div class="row"><span class="status ${color === 'gray' ? 'green' : color}"></span><div><strong>${esc(mt.kind)} — ${esc(machineName(mt.machineId) || 'Máquina removida')}</strong><small>${esc([mt.description, 'aberta ' + fmtDate(mt.date), mt.doneDate ? 'concluída ' + fmtDate(mt.doneDate) : '', mt.cost ? 'R$ ' + num(mt.cost, 2) : ''].filter(Boolean).join(' • '))}</small></div><div class="row-actions">${chip(mt.status, color)}${mt.status !== 'Concluída' ? mini('✓ Concluir', 'mt-done', mt.id, 'ok') : ''}${mini('Editar', 'mt-edit', mt.id)}${mini('Excluir', 'mt-del', mt.id, 'del')}</div></div>`;
    }).join('') : empty('Nenhuma manutenção registrada', '')}</section>`;
};

VIEWS.talhoes = () => {
  const fs = db.fields.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', {numeric: true}));
  const total = fs.reduce((s, f) => s + Number(f.area || 0), 0);
  return head('Talhões', `${fs.length} talhões • ${num(total)} ha cadastrados`, btn('+ Novo talhão', 'fd-new')) +
    (fs.length ? `<section class="cards">${fs.map(f => {
      const ops = db.operations.filter(o => o.fieldId === f.id).sort(byDateDesc);
      const lots = db.lots.filter(l => l.fieldId === f.id);
      return `<article class="card item-card"><header><div><h4>${esc(f.name)}</h4><div class="meta">${esc([f.crop, f.cultivar, f.season].filter(Boolean).join(' • ') || 'Sem cultura informada')}</div></div>${chip(num(f.area) + ' ha', 'green')}</header>
        <div class="meta"><span>Plantio: ${fmtDate(f.plantingDate)}</span><span>Operações: ${ops.length}${ops[0] ? ` • última: ${esc(ops[0].type)} em ${fmtDate(ops[0].date)}` : ''}</span><span>Lotes de semente: ${esc(lots.map(l => l.code).join(', ') || '—')}</span></div>
        <div class="row-actions" style="justify-content:flex-start">${mini('+ Operação', 'op-field', f.id)}${mini('Histórico', 'fd-hist', f.id)}${mini('Editar', 'fd-edit', f.id)}${mini('Excluir', 'fd-del', f.id, 'del')}</div></article>`;
    }).join('')}</section>` : `<section class="card">${empty('Nenhum talhão cadastrado', 'Cadastre os talhões para vincular operações, consumo de insumos e lotes de sementes.', {act: 'fd-new', label: '+ Novo talhão'})}</section>`);
};

VIEWS.talhao = id => {
  const f = find('fields', id);
  if (!f) return empty('Talhão não encontrado', '');
  const ops = db.operations.filter(o => o.fieldId === id).sort(byDateDesc);
  const movs = db.movements.filter(m => m.fieldId === id && m.kind === 'Saída').sort(byDateDesc);
  const gastos = db.expenses.filter(g => g.fieldId === id && Number(g.value) > 0).sort(byDateDesc), totG = gastos.reduce((s, g) => s + Number(g.value), 0);
  return head(f.name, `${num(f.area)} ha • ${[f.crop, f.cultivar, f.season].filter(Boolean).join(' • ')}`, btn('← Talhões', 'nav', 'talhoes', 'secondary') + btn('+ Operação', 'op-field', id)) +
    `<div class="section-title"><h3>Operações (${ops.length})</h3></div><section class="card list">${ops.length ? ops.map(o => operationRow(o)).join('') : empty('Nenhuma operação neste talhão', '')}</section>` +
    `<div class="section-title"><h3>Insumos aplicados</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Item</th><th class="num">Quantidade</th><th class="num">Por ha</th></tr></thead><tbody>${movs.map(m => { const s = find('stock', m.itemId); return `<tr><td>${fmtDate(m.date)}</td><td>${esc(s?.name || 'Item removido')}</td><td class="num">${num(m.qty)} ${esc(s?.unit || '')}</td><td class="num">${Number(f.area) ? num(m.qty / f.area) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="4">Nenhuma saída de estoque vinculada a este talhão.</td></tr>'}</tbody></table></div></section>` +
    `<div class="section-title"><h3>Gastos (R$ ${num(totG, 2)}${Number(f.area) > 0 && totG ? ` • R$ ${num(totG / f.area, 2)}/ha` : ''})</h3><button data-act="gs-talhao" data-id="${esc(id)}">+ Lançar gasto</button></div><section class="card panel">${gastos.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th></tr></thead><tbody>${gastos.map(g => `<tr><td>${fmtDate(g.date)}</td><td>${esc(g.description)}</td><td>${esc(g.category)}</td><td class="num">R$ ${num(g.value, 2)}</td></tr>`).join('')}</tbody></table></div>` : 'Nenhum gasto vinculado a este talhão.'}</section>`;
};

VIEWS.sementes = () => {
  const counts = LOT_STATUS.map(s => [s, db.lots.filter(l => l.status === s)]);
  const totalKg = db.lots.reduce((s, l) => s + Number(l.weight || 0), 0);
  const approved = db.lots.filter(l => l.status === 'Aprovado' || l.status === 'Expedido');
  return head('Produção de sementes', `${db.lots.length} lotes • ${num(totalKg / 1000, 1)} t registradas`, btn('+ Novo lote', 'lot-new')) +
    `<section class="kpis">
      <article class="card kpi"><div class="badge green">◉</div><div class="label">Em campo</div><div class="value">${db.lots.filter(l => l.status === 'Em campo').length}</div><div class="hint">lotes em produção</div></article>
      <article class="card kpi"><div class="badge purple">⚙</div><div class="label">Pós-colheita</div><div class="value">${db.lots.filter(l => ['Colhido', 'Em beneficiamento'].includes(l.status)).length}</div><div class="hint">colhidos ou em beneficiamento</div></article>
      <article class="card kpi"><div class="badge orange">⌁</div><div class="label">Aguardando análise</div><div class="value">${db.lots.filter(l => l.status === 'Aguardando análise').length}</div><div class="hint">germinação e vigor</div></article>
      <article class="card kpi"><div class="badge blue">✓</div><div class="label">Aprovados / expedidos</div><div class="value">${approved.length}</div><div class="hint">${num(approved.reduce((s, l) => s + Number(l.weight || 0), 0) / 1000, 1)} t</div></article>
    </section>` +
    `<div class="section-title"><h3>Lotes por etapa</h3></div>` +
    (db.lots.length ? `<section class="card list">${counts.filter(([, ls]) => ls.length).map(([s, ls]) => ls.map(l => `<div class="row"><span class="status ${LOT_COLOR[s] === 'gray' ? 'green' : LOT_COLOR[s]}"></span><div><strong>${esc(l.code)} — ${esc([l.species, l.cultivar].filter(Boolean).join(' '))}</strong><small>${esc([l.category, fieldName(l.fieldId), l.season, l.weight ? num(l.weight) + ' kg' : '', l.germination !== '' && l.germination != null ? 'germ. ' + num(l.germination) + '%' : ''].filter(Boolean).join(' • '))}</small></div><div class="row-actions">${chip(s, LOT_COLOR[s])}${mini('Rastrear', 'nav', 'lotes/' + l.id)}${mini('Editar', 'lot-edit', l.id)}</div></div>`).join('')).join('')}</section>` : `<section class="card">${empty('Nenhum lote cadastrado', 'Registre os lotes de sementes desde o campo até a expedição.', {act: 'lot-new', label: '+ Novo lote'})}</section>`);
};

VIEWS.lotes = id => {
  if (id) return lotDetail(id);
  const lots = db.lots.slice().sort((a, b) => b.code.localeCompare(a.code, 'pt-BR', {numeric: true}));
  return head('Lotes e rastreabilidade', 'Histórico completo de cada lote: origem, operações, análises e eventos.', btn('+ Novo lote', 'lot-new')) +
    (lots.length ? `<section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lote</th><th>Cultivar</th><th>Origem</th><th class="num">Peso (kg)</th><th class="num">Germ.</th><th>Situação</th></tr></thead><tbody>${lots.map(l => `<tr class="clickable" data-act="nav" data-id="lotes/${esc(l.id)}" style="cursor:pointer"><td><strong>${esc(l.code)}</strong></td><td>${esc(l.cultivar)}</td><td>${esc(fieldName(l.fieldId) || '—')}</td><td class="num">${l.weight ? num(l.weight) : '—'}</td><td class="num">${l.germination !== '' && l.germination != null ? num(l.germination) + '%' : '—'}</td><td>${chip(l.status, LOT_COLOR[l.status])}</td></tr>`).join('')}</tbody></table></div></section>` : `<section class="card">${empty('Nenhum lote cadastrado', '', {act: 'lot-new', label: '+ Novo lote'})}</section>`);
};

function lotDetail(id) {
  const l = find('lots', id);
  if (!l) return empty('Lote não encontrado', '');
  const f = find('fields', l.fieldId);
  const events = [
    ...db.lotEvents.filter(e => e.lotId === id).map(e => ({...e, color: 'purple', icon: '⌁'})),
    ...(f ? db.operations.filter(o => o.fieldId === f.id && (o.status === 'Concluída' || o.status === 'Em andamento')).map(o => ({date: o.date, title: `${o.type} — ${f.name}`, text: [o.status, machineName(o.machineId), o.notes].filter(Boolean).join(' • '), color: 'green', icon: '◷'})) : []),
    ...(f ? db.movements.filter(m => m.fieldId === f.id && m.kind === 'Saída').map(m => { const s = find('stock', m.itemId); return {date: m.date, title: `Insumo aplicado: ${s?.name || 'item'}`, text: `${num(m.qty)} ${s?.unit || ''} no ${f.name}`, color: 'blue', icon: '□'}; }) : [])
  ].sort(byDateDesc);
  return head(`Lote ${l.code}`, [l.species, l.cultivar, l.category, l.season].filter(Boolean).join(' • '), btn('← Lotes', 'nav', 'lotes', 'secondary') + btn('Editar', 'lot-edit', id, 'secondary') + btn('+ Evento', 'lot-event', id)) +
    `<section class="kpis">
      <article class="card kpi"><div class="label">Situação</div><div class="value" style="font-size:1.1rem">${chip(l.status, LOT_COLOR[l.status])}</div></article>
      <article class="card kpi"><div class="label">Talhão de origem</div><div class="value" style="font-size:1.2rem">${esc(f?.name || '—')}</div><div class="hint">${f ? num(f.area) + ' ha' : ''}</div></article>
      <article class="card kpi"><div class="label">Peso</div><div class="value">${l.weight ? num(l.weight) : '—'}</div><div class="hint">kg</div></article>
      <article class="card kpi"><div class="label">Germinação / vigor</div><div class="value">${l.germination !== '' && l.germination != null ? num(l.germination) + '%' : '—'}</div><div class="hint">${l.vigor !== '' && l.vigor != null ? 'vigor ' + num(l.vigor) + '%' : 'vigor não informado'}</div></article>
    </section>
    <div class="section-title"><h3>Linha do tempo</h3></div>
    <section class="card panel"><div class="timeline">${events.length ? events.map(e => `<div class="tl-item"><span class="tl-dot ${e.color}">${e.icon}</span><div><strong>${esc(e.title)}</strong><small>${fmtDate(e.date)}${e.text ? ' • ' + esc(e.text) : ''}</small></div></div>`).join('') : 'Nenhum evento registrado.'}</div></section>`;
}

VIEWS.estoque = () => {
  const items = db.stock.slice().sort((a, b) => stockLow(b) - stockLow(a) || a.name.localeCompare(b.name));
  const movs = db.movements.slice().sort(byDateDesc).slice(0, 15);
  return head('Estoque e insumos', `${items.length} itens • ${items.filter(stockLow).length} abaixo do mínimo`, btn('Movimentar', 'mov-new', '', 'secondary') + btn('+ Novo item', 'st-new')) +
    (items.length ? `<section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Categoria</th><th class="num">Saldo</th><th class="num">Mínimo</th><th></th></tr></thead><tbody>${items.map(s => `<tr><td><strong>${esc(s.name)}</strong>${stockLow(s) ? ' ' + chip('baixo', 'red') : ''}<br><small style="color:var(--muted)">${esc(s.location || '')}</small></td><td>${esc(s.category || '—')}</td><td class="num"><strong>${num(s.qty)}</strong> ${esc(s.unit)}</td><td class="num">${s.min !== '' && s.min != null ? num(s.min) + ' ' + esc(s.unit) : '—'}</td><td><div class="row-actions">${mini('⇄', 'mov-new', s.id)}${mini('Editar', 'st-edit', s.id)}${mini('Excluir', 'st-del', s.id, 'del')}</div></td></tr>`).join('')}</tbody></table></div></section>` : `<section class="card">${empty('Nenhum item cadastrado', 'Cadastre defensivos, fertilizantes, sementes, combustível e peças.', {act: 'st-new', label: '+ Novo item'})}</section>`) +
    `<div class="section-title"><h3>Últimas movimentações</h3></div><section class="card list">${movs.length ? movs.map(m => { const s = find('stock', m.itemId); const color = m.kind === 'Entrada' ? 'green' : m.kind === 'Saída' ? 'orange' : 'blue'; return `<div class="row"><span class="status ${color}"></span><div><strong>${esc(m.kind)} — ${esc(s?.name || 'Item removido')}</strong><small>${esc([fmtDate(m.date), `${num(m.qty)} ${s?.unit || ''}`, `saldo ${num(m.before)} → ${num(m.after)}`, fieldName(m.fieldId), m.notes].filter(Boolean).join(' • '))}</small></div>${chip(m.kind, color)}</div>`; }).join('') : empty('Nenhuma movimentação', '')}</section>`;
};

let reportDays = 30;
VIEWS.relatorios = () => {
  const from = daysAgo(reportDays);
  const ops = db.operations.filter(o => o.date >= from && o.date <= today() && o.status !== 'Cancelada');
  const byType = OP_TYPES.map(t => [t, ops.filter(o => o.type === t)]).filter(([, l]) => l.length);
  const maxType = Math.max(1, ...byType.map(([, l]) => l.length));
  const hoursBy = db.machines.map(m => [m, db.hourLogs.filter(h => h.machineId === m.id && h.date >= from).reduce((s, h) => s + (Number(h.hours) - Number(h.previous || 0)), 0)]).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);
  const maxH = Math.max(1, ...hoursBy.map(([, h]) => h));
  const consumption = db.stock.map(s => [s, db.movements.filter(m => m.itemId === s.id && m.kind === 'Saída' && m.date >= from).reduce((t, m) => t + Number(m.qty), 0)]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const maintCost = db.maintenances.filter(m => m.date >= from).reduce((s, m) => s + Number(m.cost || 0), 0);
  const outrosGastos = db.expenses.filter(g => g.date >= from && g.date <= today()).reduce((s, g) => s + Number(g.value || 0), 0);
  const area = ops.filter(o => o.status === 'Concluída').reduce((s, o) => s + Number(o.area || 0), 0);
  return head('Relatórios', `Resumo dos últimos ${reportDays} dias (desde ${fmtDate(from)})`, btn('Exportar operações (CSV)', 'csv', 'operations', 'secondary') + btn('Exportar estoque (CSV)', 'csv', 'stock', 'secondary')) +
    `<div class="filters">${[7, 30, 90, 365].map(d => `<button class="${d === reportDays ? 'active' : ''}" data-act="rep-days" data-id="${d}">${d === 365 ? '12 meses' : d + ' dias'}</button>`).join('')}</div>
    <section class="kpis">
      <article class="card kpi"><div class="label">Operações no período</div><div class="value">${ops.length}</div><div class="hint">${ops.filter(o => o.status === 'Concluída').length} concluídas</div></article>
      <article class="card kpi"><div class="label">Área trabalhada</div><div class="value">${num(area)}</div><div class="hint">ha em operações concluídas</div></article>
      <article class="card kpi"><div class="label">Horas de máquina</div><div class="value">${num(hoursBy.reduce((s, [, h]) => s + h, 0))}</div><div class="hint">pelos registros de horímetro</div></article>
      <article class="card kpi"><div class="label">Custo de manutenção</div><div class="value">R$ ${num(maintCost, 2)}</div><div class="hint">${db.maintenances.filter(m => m.date >= from).length} ordens</div></article>
      <article class="card kpi clickable" data-act="nav" data-id="gastos" style="cursor:pointer"><div class="label">Outros gastos</div><div class="value">R$ ${num(outrosGastos, 2)}</div><div class="hint">combustível, peças, mão de obra e demais • ver detalhes</div></article>
    </section>
    <section class="grid">
      <article class="card panel"><h3>Operações por tipo</h3>${byType.length ? `<table class="tbl"><tbody>${byType.map(([t, l]) => `<tr><td>${esc(t)}</td><td style="width:45%"><div class="bar"><span style="width:${l.length / maxType * 100}%"></span></div></td><td class="num">${l.length}</td></tr>`).join('')}</tbody></table>` : 'Sem operações no período.'}</article>
      <article class="card panel"><h3>Horas trabalhadas por máquina</h3>${hoursBy.length ? `<table class="tbl"><tbody>${hoursBy.map(([m, h]) => `<tr><td>${esc(m.name)}</td><td style="width:45%"><div class="bar"><span style="width:${h / maxH * 100}%;background:var(--orange)"></span></div></td><td class="num">${num(h)} h</td></tr>`).join('')}</tbody></table>` : 'Sem registros de horímetro no período.'}</article>
    </section>
    <div class="section-title"><h3>Consumo de insumos</h3></div>
    <section class="card panel">${consumption.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Consumo</th><th class="num">Saldo atual</th></tr></thead><tbody>${consumption.map(([s, q]) => `<tr><td>${esc(s.name)}</td><td class="num">${num(q)} ${esc(s.unit)}</td><td class="num">${num(s.qty)} ${esc(s.unit)}</td></tr>`).join('')}</tbody></table></div>` : 'Nenhuma saída de estoque no período.'}</section>`;
};

VIEWS.cadastros = () => {
  const counts = [['Operações', 'operations'], ['Máquinas', 'machines'], ['Registros de horímetro', 'hourLogs'], ['Manutenções', 'maintenances'], ['Talhões', 'fields'], ['Lotes', 'lots'], ['Itens de estoque', 'stock'], ['Movimentações', 'movements'], ['Gastos', 'expenses']];
  return head('Cadastros e backup', 'Dados da propriedade e cópia de segurança dos registros deste dispositivo.') +
    `<section class="settings">
      <article class="card panel"><h3>Propriedade</h3><p>Nome exibido no aplicativo e nos arquivos exportados.</p>
        <form id="settingsForm"><div class="form"><div class="field full"><label for="s_farm">Fazenda / unidade</label><input id="s_farm" value="${esc(db.settings.farm)}" placeholder="Ex.: Fazenda Boa Vista"></div><div class="field full"><label for="s_owner">Responsável</label><input id="s_owner" value="${esc(db.settings.owner)}" placeholder="Nome do responsável"></div></div><div class="actions"><button class="primary" type="submit">Salvar</button></div></form>
      </article>
      <article class="card panel"><h3>Registros no dispositivo</h3><table class="tbl"><tbody>${counts.map(([l, c]) => `<tr><td>${l}</td><td class="num">${db[c].length}</td></tr>`).join('')}</tbody></table></article>
      <article class="card panel"><h3>Backup</h3><p>Os dados ficam somente neste aparelho. Exporte um backup regularmente e guarde em local seguro (Drive, e-mail, computador).</p>
        <div class="btn-row">${btn('⬇ Exportar backup', 'backup')}${btn('⬆ Restaurar backup', 'restore', '', 'secondary')}</div><input type="file" id="restoreInput" accept="application/json,.json" hidden></article>
      <article class="card panel"><h3>Dados de exemplo e limpeza</h3><p>Carregue exemplos para treinar a equipe, ou apague todos os registros deste dispositivo.</p>
        <div class="btn-row">${btn('Carregar exemplos', 'seed', '', 'secondary')}<button class="danger" data-act="wipe">Apagar todos os dados</button></div></article>
    </section>`;
};
VIEWS.cadastros.after = () => {
  $('#settingsForm').onsubmit = e => { e.preventDefault(); db.settings.farm = $('#s_farm').value.trim(); db.settings.owner = $('#s_owner').value.trim(); save(); applySettings(); showToast('Dados da propriedade salvos'); };
  $('#restoreInput').onchange = e => { const file = e.target.files[0]; if (file) file.text().then(restoreBackup).catch(() => showToast('Não foi possível ler o arquivo')); e.target.value = ''; };
};

VIEWS.busca = q => {
  q = decodeURIComponent(q || '');
  const n = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const term = n(q);
  const hit = (...vals) => vals.some(v => n(v).includes(term));
  const ops = db.operations.filter(o => hit(o.type, opPlace(o), o.notes, o.operator, machineName(o.machineId))).sort(byDateDesc);
  const ms = db.machines.filter(m => hit(m.name, m.type, m.model));
  const fs = db.fields.filter(f => hit(f.name, f.crop, f.cultivar, f.season));
  const ls = db.lots.filter(l => hit(l.code, l.cultivar, l.species, l.status));
  const ss = db.stock.filter(s => hit(s.name, s.category, s.location));
  const gs = db.expenses.filter(g => hit(g.description, g.category, g.supplier, g.doc, machineName(g.machineId), fieldName(g.fieldId))).sort(byDateDesc);
  const total = ops.length + ms.length + fs.length + ls.length + ss.length + gs.length;
  const group = (title, items) => items.length ? `<div class="section-title"><h3>${title} (${items.length})</h3></div><section class="card list">${items.join('')}</section>` : '';
  const simple = (title, sub, route) => `<div class="row clickable" data-act="nav" data-id="${esc(route)}" style="cursor:pointer"><span class="status blue"></span><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><span class="chip">Abrir</span></div>`;
  return head(`Resultados para “${q}”`, `${total} registro(s) encontrado(s)`) + (total ? '' : `<section class="card">${empty('Nada encontrado', 'Tente outro termo.')}</section>`) +
    group('Operações', ops.map(o => operationRow(o))) +
    group('Máquinas', ms.map(m => simple(m.name, `${m.type || ''} • ${num(m.hours)} h`, 'maquinas'))) +
    group('Talhões', fs.map(f => simple(f.name, `${num(f.area)} ha • ${f.crop || ''}`, 'talhao/' + f.id))) +
    group('Lotes', ls.map(l => simple(l.code, `${l.cultivar} • ${l.status}`, 'lotes/' + l.id))) +
    group('Estoque', ss.map(s => simple(s.name, `${num(s.qty)} ${s.unit}`, 'estoque'))) +
    group('Gastos', gs.map(g => simple(g.description, `${fmtDate(g.date)} • ${g.category} • R$ ${num(g.value, 2)}`, 'gastos')));
};

// ---------- Backup, CSV e exemplos ----------
function downloadFile(name, mime, content) {
  if (window.AndroidBridge?.saveFile) { window.AndroidBridge.saveFile(name, mime, content); return; }
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('Arquivo exportado: ' + name);
}
// Chamado pelo app Android após salvar o arquivo
window.onNativeFileSaved = ok => showToast(ok ? 'Arquivo salvo com sucesso' : 'Exportação cancelada');

function exportBackup() {
  const payload = JSON.stringify({app: 'agro-operacoes', exportedAt: new Date().toISOString(), data: db}, null, 1);
  downloadFile(`agro-operacoes-backup-${today()}.json`, 'application/json', payload);
}
function restoreBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { showToast('Arquivo inválido'); return; }
  const data = parsed?.app === 'agro-operacoes' ? parsed.data : null;
  if (!data || !COLLECTIONS.some(c => Array.isArray(data[c]))) { showToast('Este arquivo não é um backup do Agro Operações'); return; }
  const n = COLLECTIONS.reduce((s, c) => s + (data[c]?.length || 0), 0);
  confirmDialog(`Restaurar backup de ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('pt-BR') : 'data desconhecida'} com ${n} registros? Os dados atuais deste dispositivo serão substituídos.`, () => {
    db = {...emptyDb(), ...data}; for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
    save(); applySettings(); showToast('Backup restaurado');
  }, 'Restaurar');
}

const CSV_DEFS = {
  operations: ['operacoes', [['Data', o => fmtDate(o.date)], ['Hora', o => o.time], ['Tipo', o => o.type], ['Local', opPlace], ['Máquina', o => machineName(o.machineId)], ['Área (ha)', o => o.area], ['Operador', o => o.operator], ['Situação', o => o.status], ['Observações', o => o.notes]], db => db.operations.slice().sort(byDateDesc)],
  stock: ['estoque', [['Item', s => s.name], ['Categoria', s => s.category], ['Saldo', s => s.qty], ['Unidade', s => s.unit], ['Mínimo', s => s.min], ['Local', s => s.location]], db => db.stock]
};
function exportCsv(kind) {
  const [name, cols, rows] = CSV_DEFS[kind];
  const cell = v => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.map(c => c[0]).join(';'), ...rows(db).map(r => cols.map(c => cell(c[1](r))).join(';'))].join('\r\n');
  downloadFile(`agro-${name}-${today()}.csv`, 'text/csv', csv);
}

function loadSamples() {
  const f1 = uid(), f2 = uid(), f3 = uid(), m1 = uid(), m2 = uid(), m3 = uid(), s1 = uid(), s2 = uid(), s3 = uid(), l1 = uid(), l2 = uid();
  db.fields.push({id: f1, name: 'Talhão 07', area: 84.5, crop: 'Soja', cultivar: 'BMX Zeus', season: '2026/27', plantingDate: today()}, {id: f2, name: 'Talhão 08', area: 62, crop: 'Soja', cultivar: 'NS 7709', season: '2026/27'}, {id: f3, name: 'Talhão 12', area: 110, crop: 'Milho', cultivar: 'P3898', season: '2026/27'});
  db.machines.push({id: m1, name: 'Trator 7230J', type: 'Trator', model: 'John Deere 7230J', hours: 1492, interval: 250, nextService: 1500}, {id: m2, name: 'Colheitadeira 01', type: 'Colheitadeira', model: 'S540', hours: 3120, interval: 250, nextService: 3250}, {id: m3, name: 'Pulverizador 4730', type: 'Pulverizador', model: 'JD 4730', hours: 860, interval: 200, nextService: 1000});
  db.hourLogs.push({id: uid(), machineId: m1, date: daysAgo(1), hours: 1492, previous: 1480});
  // Histórico das últimas semanas (exemplo) para os indicadores da Visão Geral
  [[m1, 1480, [9, 7, 11, 8, 10, 6]], [m2, 3120, [12, 14, 9, 13, 0, 0]], [m3, 860, [6, 0, 8, 5, 7, 9]]].forEach(([id, h, semanas]) => {
    let atual = h;
    semanas.forEach((d, i) => { if (!d) return; db.hourLogs.push({id: uid(), machineId: id, date: daysAgo(3 + i * 7), hours: atual, previous: atual - d}); atual -= d; });
  });
  [[f3, 'Colheita', m2, 55, 6], [f3, 'Colheita', m2, 55, 8], [f1, 'Preparo de solo', m1, 42, 13], [f2, 'Adubação', m1, 31, 15], [f2, 'Preparo de solo', m1, 31, 20], [f1, 'Aplicação', m3, 84.5, 22], [f3, 'Aplicação', m3, 110, 27]]
    .forEach(([fieldId, type, machineId, area, d]) => db.operations.push({id: uid(), date: daysAgo(d), time: '07:00', type, fieldId, machineId, status: 'Concluída', area}));
  db.maintenances.push({id: uid(), machineId: m2, kind: 'Preventiva', date: today(), description: 'Troca de filtros e inspeção', status: 'Aberta'},
    {id: uid(), machineId: m1, kind: 'Preventiva', date: daysAgo(20), doneDate: daysAgo(19), description: 'Revisão de 1.250 h — óleo e filtros', status: 'Concluída', cost: 3200},
    {id: uid(), machineId: m3, kind: 'Corretiva', date: daysAgo(9), doneDate: daysAgo(8), description: 'Troca de mangueiras da barra', status: 'Concluída', cost: 1650});
  db.operations.push(
    {id: uid(), date: today(), time: '07:10', type: 'Plantio', fieldId: f1, machineId: m1, status: 'Em andamento', area: 40, operator: 'Equipe A', notes: 'Plantadeira 30 linhas'},
    {id: uid(), date: today(), time: '09:00', type: 'Tratamento de sementes', place: 'Unidade de beneficiamento', status: 'Programada', notes: 'Lote SM-026'},
    {id: uid(), date: today(), time: '06:30', type: 'Aplicação', fieldId: f3, machineId: m3, status: 'Concluída', area: 110, notes: 'Concluída 10:35'},
    {id: uid(), date: daysAgo(-1), time: '07:00', type: 'Plantio', fieldId: f2, machineId: m1, status: 'Programada'});
  db.stock.push({id: s1, name: 'Tratamento TS-04', category: 'Tratamento de sementes', unit: 'L', qty: 18, min: 20, location: 'Galpão 2'}, {id: s2, name: 'Óleo diesel S10', category: 'Combustível', unit: 'L', qty: 4200, min: 1500, location: 'Tanque'}, {id: s3, name: 'Fertilizante 04-14-08', category: 'Fertilizante', unit: 't', qty: 36, min: 10, location: 'Armazém'});
  db.expenses.push({id: uid(), date: daysAgo(4), category: 'Combustível', description: 'Diesel S10 — 1.500 L', value: 9150, machineId: '', fieldId: '', season: '2026/27'},
    {id: uid(), date: daysAgo(15), category: 'Mão de obra', description: 'Diárias de plantio', value: 2400, fieldId: f1, season: '2026/27'},
    {id: uid(), date: daysAgo(2), category: 'Peças', description: 'Pontas de pulverização', value: 980, machineId: m3, season: '2026/27'});
  db.movements.push({id: uid(), itemId: s3, kind: 'Saída', qty: 12, date: today(), fieldId: f1, before: 48, after: 36, notes: 'Adubação de plantio'});
  db.lots.push({id: l1, code: 'SM-024', species: 'Soja', cultivar: 'BMX Zeus', category: 'C1', fieldId: f1, season: '2025/26', weight: 42000, status: 'Aguardando análise', germination: '', vigor: ''}, {id: l2, code: 'SM-026', species: 'Soja', cultivar: 'NS 7709', category: 'S1', fieldId: f2, season: '2025/26', weight: 38500, status: 'Em beneficiamento', germination: 92, vigor: 86});
  db.lotEvents.push({id: uid(), lotId: l1, date: daysAgo(12), title: 'Colheita', text: 'Umidade 13%'}, {id: uid(), lotId: l1, date: daysAgo(5), title: 'Amostra enviada ao laboratório', text: ''}, {id: uid(), lotId: l2, date: daysAgo(10), title: 'Análise registrada', text: 'Germinação 92% • vigor 86%'});
  save(); showToast('Dados de exemplo carregados'); render();
}

// ---------- Ações (delegação de eventos) ----------
const ACTIONS = {
  'nav': id => go(id),
  'op-new': () => operationForm(), 'op-field': id => operationForm({fieldId: id}),
  'op-edit': id => operationForm(find('operations', id)),
  'op-del': id => confirmDialog('Excluir esta operação?', () => remove('operations', id)),
  'op-start': id => { const o = find('operations', id); o.status = 'Em andamento'; o.startedAt = new Date().toISOString(); if (!o.time) o.time = nowTime(); save(); showToast('Operação iniciada'); render(); },
  'op-done': id => { const o = find('operations', id); o.status = 'Concluída'; o.finishedAt = new Date().toISOString(); save(); showToast('Operação concluída'); render(); },
  'op-filter': id => { opFilter = id; render(); },
  'mc-new': () => machineForm(), 'mc-edit': id => machineForm(find('machines', id)),
  'mc-del': id => confirmDialog('Excluir esta máquina? Os registros de horímetro dela também serão removidos.', () => { remove('machines', id); db.hourLogs = db.hourLogs.filter(h => h.machineId !== id); save(); }),
  'hour-new': id => hourForm(id),
  'mt-new': id => maintenanceForm(id ? {machineId: id} : {}), 'mt-edit': id => maintenanceForm(find('maintenances', id)),
  'mt-done': id => { finishMaintenance(find('maintenances', id)); render(); },
  'mt-del': id => confirmDialog('Excluir esta ordem de manutenção?', () => remove('maintenances', id)),
  'fd-new': () => fieldForm(), 'fd-edit': id => fieldForm(find('fields', id)), 'fd-hist': id => go('talhao/' + id),
  'fd-del': id => confirmDialog('Excluir este talhão? Operações e lotes vinculados ficarão sem talhão.', () => remove('fields', id)),
  'lot-new': () => lotForm(), 'lot-edit': id => lotForm(find('lots', id)), 'lot-event': id => lotEventForm(id),
  'st-new': () => stockForm(), 'st-edit': id => stockForm(find('stock', id)),
  'st-del': id => confirmDialog('Excluir este item e suas movimentações?', () => { remove('stock', id); db.movements = db.movements.filter(m => m.itemId !== id); save(); }),
  'mov-new': id => movementForm(id),
  'rep-days': id => { reportDays = Number(id); render(); },
  'csv': id => exportCsv(id),
  'backup': exportBackup,
  'restore': () => $('#restoreInput').click(),
  'seed': () => confirmDialog('Adicionar dados de exemplo aos registros deste dispositivo?', loadSamples, 'Carregar'),
  'wipe': () => confirmDialog('Apagar TODOS os dados deste dispositivo? Faça um backup antes. Esta ação não pode ser desfeita.', () => { const settings = db.settings; db = emptyDb(); db.settings = settings; save(); showToast('Dados apagados'); }, 'Apagar tudo')
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  e.preventDefault();
  ACTIONS[el.dataset.act](el.dataset.id);
});

// ---------- Roteamento por hash (permite voltar com o botão do Android) ----------
function parseRoute() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return {name: VIEWS[name] ? name : 'inicio', arg: rest.join('/')};
}
function go(route, anchor) {
  const target = '#/' + route;
  if (location.hash === target) render(anchor); else { pendingAnchor = anchor; location.hash = target; }
}
let pendingAnchor;
function render(anchor = pendingAnchor) {
  pendingAnchor = undefined;
  const {name, arg} = parseRoute();
  const key = name === 'talhao' ? 'talhoes' : name;
  view.innerHTML = VIEWS[name](arg || anchor);
  $('#viewTitle').textContent = TITLES[key] || (name === 'talhao' ? 'Talhões' : 'Agro Operações');
  document.title = `${TITLES[key] || 'Nexus Agro'} — Nexus Agro`;
  $$('[data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === key));
  VIEWS[name].after?.(anchor);
  const h2 = view.querySelector('.view-head h2'), igual = t => semAcentoApp(t).replace(/[^a-z]/g, '');
  if (h2 && igual(h2.textContent) === igual($('#viewTitle').textContent)) h2.classList.add('repetido');
}
const semAcentoApp = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Menus "⋯ Mais": fecham ao tocar fora ou ao escolher uma opção
document.addEventListener('click', e => $$('.menu-mais[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.menu-lista button')) d.open = false; }));
let lastRoute = '';
addEventListener('hashchange', () => { const r = location.hash; if (r !== lastRoute) { lastRoute = r; render(); scrollTo(0, 0); } });
lastRoute = location.hash;
// Renderiza depois que todos os scripts (inclusive afericao.js) foram carregados
addEventListener('DOMContentLoaded', () => render());

// ---------- Rede, instalação e service worker ----------
const setNetwork = () => { $('#netStatus').textContent = navigator.onLine ? 'Disponível offline' : 'Modo offline ativo'; };
addEventListener('online', setNetwork); addEventListener('offline', setNetwork); setNetwork();
let installPrompt = null; const installBtn = $('#installBtn');
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; installBtn.classList.add('show'); });
installBtn.onclick = async () => { if (!installPrompt) { showToast('Abra o menu do navegador e escolha “Instalar aplicativo”'); return; } installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installBtn.classList.remove('show'); };
addEventListener('appinstalled', () => showToast('Aplicativo instalado com sucesso'));
// No app Android os arquivos já vêm do APK; o service worker serve apenas à versão web (PWA).
if ('serviceWorker' in navigator && !window.AndroidBridge) addEventListener('load', () => navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(() => {}));
