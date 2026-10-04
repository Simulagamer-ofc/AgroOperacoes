// Regras de negócio sem acesso à tela nem ao banco: tudo aqui é testável em Node.
import { ENTITIES, DATA_STORES, OP_STATUS, MACHINE_STATUS, MAINT_KINDS, MAINT_STATUS, PROD_STATUS, LOT_STATUS, MOVE_KINDS, optionList } from './schemas.js';

export const SERVICE_WARN_HOURS = 10;

// ---------- Datas e números
const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}
export const monthStart = dateStr => dateStr.slice(0, 8) + '01';
export const fmtDate = s => (isDate(s) ? s.split('-').reverse().join('/') : s || '');
export function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}
export const fmtNum = (n, digits = 2) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
export const fmtMoney = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const plural = (n, one, many) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const inRange = (date, from, to) => isDate(date) && (!from || date >= from) && (!to || date <= to);
const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.time || '').localeCompare(String(b.time || ''));

// ---------- Nomes de registros
const find = (state, store, id) => (id ? (state[store] || []).find(r => r.id === id) : undefined);

export function opPlace(state, op) {
  return find(state, 'fields', op.fieldId)?.name || op.place || 'Sem local';
}

export function recordTitle(store, r, state) {
  if (!r) return '';
  switch (store) {
    case 'operations': return `${r.type} — ${opPlace(state, r)}`;
    case 'machines': case 'fields': case 'stockItems': return r.name;
    case 'hourmeterLogs': return `${refName(state, 'machines', r.machineId)} — ${fmtNum(num(r.reading), 1)} h`;
    case 'maintenance': return `${refName(state, 'machines', r.machineId)} — ${r.description}`;
    case 'productions': return [r.cultivar, r.season, refName(state, 'fields', r.fieldId)].filter(Boolean).join(' — ');
    case 'lots': return r.code;
    case 'stockMoves': return `${MOVE_KINDS[r.kind] || r.kind} — ${refName(state, 'stockItems', r.itemId)}`;
    default: return r.name || r.id;
  }
}

export function recordSubtitle(store, r, state) {
  switch (store) {
    case 'operations': return [fmtDate(r.date), r.time, OP_STATUS[r.status], refName(state, 'machines', r.machineId)].filter(Boolean).join(' • ');
    case 'machines': return [r.kind, r.model, MACHINE_STATUS[r.status]].filter(Boolean).join(' • ');
    case 'hourmeterLogs': return fmtDate(r.date);
    case 'maintenance': return [fmtDate(r.date), MAINT_KINDS[r.kind], MAINT_STATUS[r.status]].filter(Boolean).join(' • ');
    case 'fields': return [r.areaHa ? `${fmtNum(num(r.areaHa))} ha` : '', r.crop].filter(Boolean).join(' • ');
    case 'productions': return [PROD_STATUS[r.status], r.plantingDate ? `plantio ${fmtDate(r.plantingDate)}` : ''].filter(Boolean).join(' • ');
    case 'lots': return [lotCultivar(state, r), LOT_STATUS[r.status], r.quantityKg ? `${fmtNum(num(r.quantityKg))} kg` : ''].filter(Boolean).join(' • ');
    case 'stockItems': return `${r.category} • saldo ${fmtNum(stockQty(state, r.id))} ${r.unit}`;
    case 'stockMoves': return `${fmtDate(r.date)} • ${fmtNum(num(r.qty))} ${find(state, 'stockItems', r.itemId)?.unit || ''}`;
    default: return '';
  }
}

export function refName(state, store, id) {
  const r = find(state, store, id);
  return r ? recordTitle(store, r, state) : '';
}

export const lotCultivar = (state, lot) => lot.cultivar || find(state, 'productions', lot.productionId)?.cultivar || '';

// ---------- Valores calculados
export function hourmeterOf(state, machine) {
  const readings = [num(machine.hourmeter)];
  for (const log of state.hourmeterLogs || []) if (log.machineId === machine.id) readings.push(num(log.reading));
  for (const m of state.maintenance || []) if (m.machineId === machine.id) readings.push(num(m.hourmeter));
  return Math.max(...readings);
}

export function machineService(state, machine) {
  const next = num(machine.nextServiceAt);
  if (!next) return null;
  const current = hourmeterOf(state, machine);
  const left = next - current;
  return { next, current, left, due: left <= 0, soon: left > 0 && left <= SERVICE_WARN_HOURS, pct: Math.max(0, Math.min(100, (current / next) * 100)) };
}

export const machineInMaintenance = (state, m) =>
  m.status === 'manutencao' || (state.maintenance || []).some(x => x.machineId === m.id && x.status === 'aberta');

const MOVE_SIGN = { entrada: 1, saida: -1, consumo: -1, ajuste: 1 };
export const moveDelta = move => (MOVE_SIGN[move.kind] ?? 0) * num(move.qty);
export function stockQty(state, itemId) {
  return (state.stockMoves || []).filter(m => m.itemId === itemId).reduce((sum, m) => sum + moveDelta(m), 0);
}

export const producedKg = (state, productionId) =>
  (state.lots || []).filter(l => l.productionId === productionId).reduce((s, l) => s + num(l.quantityKg), 0);

// ---------- Alertas e indicadores
export function computeAlerts(state, today) {
  const alerts = [];
  for (const item of state.stockItems || []) {
    const qty = stockQty(state, item.id), min = num(item.minQty);
    if (qty < 0 || (min > 0 && qty <= min)) {
      alerts.push({ level: 'red', icon: '!', route: 'estoque', title: `Estoque baixo: ${item.name}`, text: `Saldo ${fmtNum(qty)} ${item.unit} (mínimo ${fmtNum(min)} ${item.unit}).` });
    }
  }
  for (const op of state.operations || []) {
    if (op.status === 'programada' && isDate(op.date) && op.date < today) {
      alerts.push({ level: 'red', icon: '◷', route: 'operacoes', title: `Operação atrasada: ${op.type}`, text: `${opPlace(state, op)} • programada para ${fmtDate(op.date)}.` });
    }
  }
  for (const m of state.machines || []) {
    if (m.status === 'inativa') continue;
    const s = machineService(state, m);
    if (s && (s.due || s.soon)) {
      alerts.push({ level: 'orange', icon: '⚙', route: 'maquinas', progress: s.pct,
        title: s.due ? `Revisão vencida: ${m.name}` : `Revisão em ${fmtNum(s.left, 1)} h: ${m.name}`,
        text: `Horímetro ${fmtNum(s.current, 1)} h • revisão prevista em ${fmtNum(s.next, 1)} h.` });
    }
  }
  for (const mt of state.maintenance || []) {
    if (mt.status === 'aberta') alerts.push({ level: 'orange', icon: '⚙', route: 'maquinas', title: `Manutenção aberta: ${refName(state, 'machines', mt.machineId)}`, text: `${mt.description} • desde ${fmtDate(mt.date)}.` });
  }
  for (const lot of state.lots || []) {
    if (lot.status === 'em_analise' && (lot.germination === '' || lot.germination === undefined || lot.germination === null)) {
      alerts.push({ level: 'purple', icon: '⌁', route: 'lotes', title: 'Lote aguardando análise', text: `${lot.code} precisa do registro de germinação.` });
    }
  }
  return alerts;
}

export function computeKpis(state, today) {
  const ops = state.operations || [];
  const todayOps = ops.filter(o => o.date === today && o.status !== 'cancelada');
  const scheduled = todayOps.filter(o => o.status === 'programada').length;
  const running = ops.filter(o => o.status === 'andamento');
  const machines = (state.machines || []).filter(m => m.status !== 'inativa');
  const inMaintenance = machines.filter(m => machineInMaintenance(state, m)).length;
  const dueSoon = machines.filter(m => { const s = machineService(state, m); return s && (s.due || s.soon); }).length;
  const alerts = computeAlerts(state, today);
  const kinds = [...new Set(running.map(o => o.type))];
  return {
    scheduled, scheduledHint: `${plural(todayOps.length, 'operação', 'operações')} hoje`,
    running: running.length, runningHint: kinds.length ? kinds.join(', ') : 'Nenhuma no momento',
    maintenance: inMaintenance, maintenanceHint: dueSoon ? `${plural(dueSoon, 'revisão pendente', 'revisões pendentes')}` : 'Nenhuma revisão pendente',
    alerts: alerts.length, alertsHint: alerts.length ? [...new Set(alerts.map(a => ({ estoque: 'estoque', maquinas: 'máquinas', lotes: 'lotes', operacoes: 'operações' })[a.route]))].join(', ') : 'Tudo em dia',
  };
}

// ---------- Busca
export function searchAll(state, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const store of DATA_STORES) {
    for (const r of state[store] || []) {
      const title = recordTitle(store, r, state), subtitle = recordSubtitle(store, r, state);
      const haystack = normalize([title, subtitle, r.notes, r.model, r.crop, r.cultivar, r.place, r.description, r.category].join(' '));
      if (terms.every(t => haystack.includes(t))) results.push({ store, id: r.id, title, subtitle });
    }
  }
  return results;
}

// ---------- Formulários
export function normalizeRecord(store, raw) {
  const out = {};
  for (const field of ENTITIES[store].fields) {
    const v = raw[field.key];
    if (field.type === 'number') out[field.key] = v === undefined || String(v).trim() === '' ? '' : num(v);
    else out[field.key] = typeof v === 'string' ? v.trim() : v ?? '';
  }
  return out;
}

export function validateRecord(store, record, state) {
  const errors = [];
  for (const field of ENTITIES[store].fields) {
    const v = record[field.key];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (field.required && empty) { errors.push(`Preencha “${field.label}”.`); continue; }
    if (empty) continue;
    if (field.type === 'date' && !isDate(v)) errors.push(`“${field.label}” precisa ser uma data válida.`);
    if (field.type === 'select' && field.options && !optionList(field.options).some(([value]) => String(value) === String(v))) errors.push(`Escolha uma opção válida em “${field.label}”.`);
    if (field.type === 'select' && field.ref && !find(state, field.ref, v)) errors.push(`O item escolhido em “${field.label}” não existe mais.`);
    if (field.type === 'number') {
      const signed = field.signedFor && record.kind === field.signedFor;
      if (!signed && field.min !== undefined && num(v) < field.min) errors.push(`“${field.label}” não pode ser negativo.`);
      if (field.max !== undefined && num(v) > field.max) errors.push(`“${field.label}” deve ser no máximo ${field.max}.`);
      if (field.key === 'qty' && !signed && num(v) <= 0) errors.push('A quantidade deve ser maior que zero.');
      if (field.key === 'qty' && signed && num(v) === 0) errors.push('O ajuste não pode ser zero.');
    }
    if (field.unique) {
      const dup = (state[store] || []).some(r => r.id !== record.id && normalize(r[field.key]) === normalize(v));
      if (dup) errors.push(`Já existe um registro com “${field.label}” igual a “${v}”.`);
    }
  }
  return errors;
}

export function findReferences(state, store, id) {
  const refs = [];
  for (const [other, entity] of Object.entries(ENTITIES)) {
    for (const field of entity.fields) {
      if (field.ref !== store) continue;
      const count = (state[other] || []).filter(r => r[field.key] === id).length;
      if (count) refs.push({ store: other, label: entity.plural, count });
    }
  }
  return refs;
}

// ---------- Relatórios
export function buildReport(state, from, to) {
  const ops = (state.operations || []).filter(o => inRange(o.date, from, to));
  const byStatus = Object.fromEntries(Object.keys(OP_STATUS).map(s => [s, ops.filter(o => o.status === s).length]));
  const typeCount = {};
  for (const o of ops) if (o.status !== 'cancelada') typeCount[o.type] = (typeCount[o.type] || 0) + 1;
  const byType = Object.entries(typeCount).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  const hours = (state.machines || []).map(m => {
    const logs = (state.hourmeterLogs || []).filter(l => l.machineId === m.id && isDate(l.date));
    const inside = logs.filter(l => inRange(l.date, from, to)).map(l => num(l.reading));
    if (!inside.length) return { name: m.name, hours: 0 };
    const before = logs.filter(l => from && l.date < from).map(l => num(l.reading));
    const base = before.length ? Math.max(...before) : num(m.hourmeter) > 0 && num(m.hourmeter) <= Math.min(...inside) ? num(m.hourmeter) : Math.min(...inside);
    return { name: m.name, hours: Math.max(0, Math.max(...inside) - base) };
  }).filter(h => h.hours > 0).sort((a, b) => b.hours - a.hours);

  const maint = (state.maintenance || []).filter(m => inRange(m.date, from, to));
  const moves = (state.stockMoves || []).filter(m => inRange(m.date, from, to));
  const stock = (state.stockItems || []).map(item => {
    const own = moves.filter(m => m.itemId === item.id);
    return {
      name: item.name, unit: item.unit,
      entrada: own.filter(m => m.kind === 'entrada').reduce((s, m) => s + num(m.qty), 0),
      saida: own.filter(m => m.kind === 'saida' || m.kind === 'consumo').reduce((s, m) => s + num(m.qty), 0),
    };
  }).filter(r => r.entrada || r.saida);
  const lots = (state.lots || []).filter(l => inRange(l.harvestDate, from, to));

  return {
    operations: { total: ops.length, byStatus, byType },
    hours,
    maintenance: { total: maint.length, open: maint.filter(m => m.status === 'aberta').length, cost: maint.reduce((s, m) => s + num(m.cost), 0) },
    stock,
    lots: { total: lots.length, kg: lots.reduce((s, l) => s + num(l.quantityKg), 0), byStatus: Object.fromEntries(Object.keys(LOT_STATUS).map(s => [s, lots.filter(l => l.status === s).length])) },
  };
}

// ---------- Rastreabilidade
export function lotTrace(state, lotId) {
  const lot = find(state, 'lots', lotId);
  if (!lot) return null;
  const production = find(state, 'productions', lot.productionId) || null;
  const field = production ? find(state, 'fields', production.fieldId) || null : null;
  const moves = (state.stockMoves || []).filter(m => m.lotId === lot.id).slice().sort(byDateDesc)
    .map(m => ({ ...m, itemName: refName(state, 'stockItems', m.itemId), unit: find(state, 'stockItems', m.itemId)?.unit || '' }));
  const fieldOps = field ? (state.operations || []).filter(o => o.fieldId === field.id).slice().sort(byDateDesc).slice(0, 20) : [];
  const lotOps = (state.operations || []).filter(o => o.notes && normalize(o.notes).includes(normalize(lot.code)) && !fieldOps.includes(o)).sort(byDateDesc);
  return { lot, cultivar: lotCultivar(state, lot), production, field, moves, operations: [...lotOps, ...fieldOps] };
}

// ---------- Exportação e backup
export function toCsv(columns, rows) {
  const cell = v => {
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v ?? '');
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(c => cell(c.label)), ...rows.map(r => columns.map(c => cell(c.value(r))))].map(line => line.join(';')).join('\r\n');
}

export function exportColumns(store, state) {
  return ENTITIES[store].fields.map(field => ({
    label: field.unit ? `${field.label} (${field.unit})` : field.label,
    value: r => {
      const v = r[field.key];
      if (field.ref) return refName(state, field.ref, v);
      if (field.type === 'date') return fmtDate(v);
      if (field.type === 'number') return v === '' || v === undefined ? '' : num(v);
      if (field.options && !Array.isArray(field.options)) return field.options[v] || v || '';
      return v ?? '';
    },
  }));
}

export function makeBackup(state, settings, version, now = new Date()) {
  return { app: 'agro-operacoes', version, exportedAt: now.toISOString(), settings, data: Object.fromEntries(DATA_STORES.map(s => [s, state[s] || []])) };
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'agro-operacoes' || typeof obj.data !== 'object' || !obj.data) {
    return { ok: false, error: 'O arquivo não é um backup do Agro Operações.' };
  }
  const data = {};
  for (const store of DATA_STORES) {
    const list = obj.data[store] ?? [];
    if (!Array.isArray(list) || list.some(r => !r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id)) {
      return { ok: false, error: `Os dados de “${ENTITIES[store].plural}” estão corrompidos.` };
    }
    data[store] = list;
  }
  const settings = obj.settings && typeof obj.settings === 'object' ? { farmName: String(obj.settings.farmName || ''), userName: String(obj.settings.userName || '') } : null;
  const count = DATA_STORES.reduce((s, k) => s + data[k].length, 0);
  return { ok: true, data, settings, count, exportedAt: obj.exportedAt || '' };
}

// Operações salvas pela versão 0.1 (localStorage, sem id e sem situação).
export function migrateLegacy(list, today) {
  if (!Array.isArray(list)) return [];
  const now = new Date().toISOString();
  return list.filter(o => o && typeof o === 'object' && o.type).map(o => ({
    id: uid(), type: String(o.type), date: isDate(o.date) ? o.date : today, time: String(o.time || ''), fieldId: '', place: String(o.place || ''),
    machineId: '', status: 'programada', notes: String(o.notes || ''), createdAt: now, updatedAt: now,
  }));
}

export const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'AO';

// ---------- Dados de exemplo
export function sampleData(today) {
  const d = n => addDays(today, n);
  const ts = new Date().toISOString();
  const stamp = list => list.map(r => ({ notes: '', ...r, createdAt: ts, updatedAt: ts }));
  return {
    fields: stamp([
      { id: 'ex-t07', name: 'Talhão 07', areaHa: 48.5, crop: 'Soja' },
      { id: 'ex-t08', name: 'Talhão 08', areaHa: 36, crop: 'Soja' },
      { id: 'ex-t12', name: 'Talhão 12', areaHa: 52.3, crop: 'Milho' },
    ]),
    machines: stamp([
      { id: 'ex-m1', name: 'Trator 7230J', kind: 'Trator', model: 'John Deere 7230J', hourmeter: 1450, nextServiceAt: 1500, status: 'ativa' },
      { id: 'ex-m2', name: 'Colheitadeira 01', kind: 'Colheitadeira', model: 'S680', hourmeter: 3210, nextServiceAt: 3500, status: 'ativa' },
      { id: 'ex-m3', name: 'Pulverizador 4730', kind: 'Pulverizador', model: 'John Deere 4730', hourmeter: 980, nextServiceAt: 1200, status: 'ativa' },
      { id: 'ex-m4', name: 'Plantadeira 30 linhas', kind: 'Implemento', model: 'DB90', hourmeter: '', nextServiceAt: '', status: 'ativa' },
    ]),
    hourmeterLogs: stamp([
      { id: 'ex-h1', machineId: 'ex-m1', date: d(-1), reading: 1484 },
      { id: 'ex-h2', machineId: 'ex-m1', date: today, reading: 1492, notes: 'Plantio Talhão 08' },
      { id: 'ex-h3', machineId: 'ex-m3', date: today, reading: 986 },
    ]),
    maintenance: stamp([
      { id: 'ex-mt1', machineId: 'ex-m2', kind: 'preventiva', date: today, description: 'Troca de filtros e inspeção', hourmeter: 3210, cost: 1850, status: 'aberta' },
      { id: 'ex-mt2', machineId: 'ex-m3', kind: 'corretiva', date: d(-12), description: 'Troca de bico', hourmeter: 960, cost: 320, status: 'concluida' },
    ]),
    productions: stamp([
      { id: 'ex-p1', fieldId: 'ex-t07', cultivar: 'BRS 1003', season: '2025/26', plantingDate: d(-150), areaHa: 48.5, expectedKg: 120000, status: 'colhido' },
      { id: 'ex-p2', fieldId: 'ex-t08', cultivar: 'BRS 1010', season: '2026/27', plantingDate: today, areaHa: 36, expectedKg: 90000, status: 'plantado' },
    ]),
    lots: stamp([
      { id: 'ex-l1', code: 'SM-024', productionId: 'ex-p1', cultivar: '', harvestDate: d(-30), quantityKg: 42000, germination: '', status: 'em_analise' },
      { id: 'ex-l2', code: 'SM-025', productionId: 'ex-p1', cultivar: '', harvestDate: d(-28), quantityKg: 38500, germination: 92, status: 'aprovado' },
      { id: 'ex-l3', code: 'SM-026', productionId: 'ex-p1', cultivar: '', harvestDate: d(-25), quantityKg: 40000, germination: 90, status: 'aprovado' },
    ]),
    stockItems: stamp([
      { id: 'ex-e1', name: 'Tratamento TS-04', category: 'Tratamento de sementes', unit: 'L', minQty: 40 },
      { id: 'ex-e2', name: 'Diesel S10', category: 'Combustível', unit: 'L', minQty: 500 },
      { id: 'ex-e3', name: 'Semente BRS 1003', category: 'Semente', unit: 'kg', minQty: 0 },
      { id: 'ex-e4', name: 'Filtro de óleo', category: 'Peça', unit: 'un', minQty: 2 },
    ]),
    stockMoves: stamp([
      { id: 'ex-s1', itemId: 'ex-e1', kind: 'entrada', date: d(-20), qty: 120, lotId: '' },
      { id: 'ex-s2', itemId: 'ex-e1', kind: 'consumo', date: d(-2), qty: 85, lotId: 'ex-l3', notes: 'Tratamento do lote SM-026' },
      { id: 'ex-s3', itemId: 'ex-e2', kind: 'entrada', date: d(-15), qty: 3000, lotId: '' },
      { id: 'ex-s4', itemId: 'ex-e2', kind: 'consumo', date: d(-1), qty: 640, lotId: '' },
      { id: 'ex-s5', itemId: 'ex-e3', kind: 'entrada', date: d(-28), qty: 38500, lotId: 'ex-l2', notes: 'Entrada do lote SM-025' },
      { id: 'ex-s6', itemId: 'ex-e3', kind: 'saida', date: d(-3), qty: 12000, lotId: 'ex-l2', notes: 'Venda — Cooperativa' },
      { id: 'ex-s7', itemId: 'ex-e4', kind: 'entrada', date: d(-40), qty: 4, lotId: '' },
    ]),
    operations: stamp([
      { id: 'ex-o1', type: 'Plantio', date: today, time: '07:10', fieldId: 'ex-t08', place: '', machineId: 'ex-m1', status: 'andamento', notes: 'Plantadeira 30 linhas' },
      { id: 'ex-o2', type: 'Beneficiamento de sementes', date: today, time: '09:00', fieldId: '', place: 'Unidade de beneficiamento', machineId: '', status: 'programada', notes: 'Tratamento do lote SM-026' },
      { id: 'ex-o3', type: 'Manutenção', date: today, time: '13:00', fieldId: '', place: 'Oficina', machineId: 'ex-m2', status: 'programada', notes: 'Troca de filtros' },
      { id: 'ex-o4', type: 'Aplicação', date: today, time: '06:30', fieldId: 'ex-t12', place: '', machineId: 'ex-m3', status: 'concluida' },
      { id: 'ex-o5', type: 'Colheita', date: d(-30), time: '08:00', fieldId: 'ex-t07', place: '', machineId: 'ex-m2', status: 'concluida', notes: 'Lote SM-024' },
    ]),
  };
}
