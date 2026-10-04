// Definição dos cadastros: campos dos formulários, opções e textos.
export const OP_TYPES = ['Plantio', 'Aplicação', 'Colheita', 'Preparo de solo', 'Adubação', 'Manutenção', 'Transporte', 'Beneficiamento de sementes', 'Outro'];
export const OP_STATUS = { programada: 'Programada', andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
export const MACHINE_KINDS = ['Trator', 'Colheitadeira', 'Pulverizador', 'Plantadeira', 'Caminhão', 'Implemento', 'Veículo', 'Outro'];
export const MACHINE_STATUS = { ativa: 'Ativa', manutencao: 'Em manutenção', inativa: 'Inativa' };
export const MAINT_KINDS = { preventiva: 'Preventiva', corretiva: 'Corretiva' };
export const MAINT_STATUS = { aberta: 'Aberta', concluida: 'Concluída' };
export const PROD_STATUS = { planejado: 'Planejado', plantado: 'Plantado', colhido: 'Colhido' };
export const LOT_STATUS = { em_analise: 'Em análise', aprovado: 'Aprovado', reprovado: 'Reprovado', expedido: 'Expedido' };
export const STOCK_CATEGORIES = ['Semente', 'Tratamento de sementes', 'Defensivo', 'Fertilizante', 'Combustível', 'Peça', 'Embalagem', 'Outro'];
export const UNITS = ['kg', 'L', 'un', 'sc', 't', 'm³'];
export const MOVE_KINDS = { entrada: 'Entrada', saida: 'Saída', consumo: 'Consumo', ajuste: 'Ajuste (+/-)' };

const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

export const ENTITIES = {
  operations: {
    singular: 'operação', plural: 'Operações', newLabel: 'Nova operação', savedMsg: 'Operação salva', route: 'operacoes',
    fields: [
      f('type', 'Tipo de operação', 'select', { options: OP_TYPES, required: true, full: true }),
      f('date', 'Data', 'date', { required: true, default: 'today' }),
      f('time', 'Horário', 'time'),
      f('fieldId', 'Talhão', 'select', { ref: 'fields' }),
      f('place', 'Outro local', 'text', { placeholder: 'Ex.: oficina, armazém' }),
      f('machineId', 'Máquina', 'select', { ref: 'machines' }),
      f('status', 'Situação', 'select', { options: OP_STATUS, required: true, default: 'programada' }),
      f('notes', 'Observações', 'textarea', { full: true, placeholder: 'Equipe, insumos ou observações' }),
    ],
  },
  machines: {
    singular: 'máquina', plural: 'Máquinas', newLabel: 'Nova máquina', savedMsg: 'Máquina salva', route: 'maquinas',
    fields: [
      f('name', 'Nome', 'text', { required: true, unique: true, placeholder: 'Ex.: Trator 7230J' }),
      f('kind', 'Tipo', 'select', { options: MACHINE_KINDS, required: true }),
      f('model', 'Marca / modelo', 'text'),
      f('hourmeter', 'Horímetro atual', 'number', { unit: 'h', min: 0 }),
      f('nextServiceAt', 'Próxima revisão no horímetro', 'number', { unit: 'h', min: 0 }),
      f('status', 'Situação', 'select', { options: MACHINE_STATUS, required: true, default: 'ativa' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  hourmeterLogs: {
    singular: 'registro de horímetro', plural: 'Registros de horímetro', newLabel: 'Registrar horímetro', savedMsg: 'Horímetro registrado', route: 'maquinas',
    fields: [
      f('machineId', 'Máquina', 'select', { ref: 'machines', required: true, full: true }),
      f('date', 'Data', 'date', { required: true, default: 'today' }),
      f('reading', 'Leitura do horímetro', 'number', { unit: 'h', required: true, min: 0 }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  maintenance: {
    singular: 'manutenção', plural: 'Manutenções', newLabel: 'Abrir manutenção', savedMsg: 'Manutenção salva', route: 'maquinas',
    fields: [
      f('machineId', 'Máquina', 'select', { ref: 'machines', required: true, full: true }),
      f('kind', 'Tipo', 'select', { options: MAINT_KINDS, required: true, default: 'preventiva' }),
      f('date', 'Data', 'date', { required: true, default: 'today' }),
      f('description', 'Serviço', 'text', { required: true, full: true, placeholder: 'Ex.: troca de filtros e óleo' }),
      f('hourmeter', 'Horímetro', 'number', { unit: 'h', min: 0 }),
      f('cost', 'Custo', 'number', { unit: 'R$', min: 0 }),
      f('status', 'Situação', 'select', { options: MAINT_STATUS, required: true, default: 'aberta' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  fields: {
    singular: 'talhão', plural: 'Talhões', newLabel: 'Novo talhão', savedMsg: 'Talhão salvo', route: 'talhoes',
    fields: [
      f('name', 'Nome', 'text', { required: true, unique: true, placeholder: 'Ex.: Talhão 08' }),
      f('areaHa', 'Área', 'number', { unit: 'ha', min: 0 }),
      f('crop', 'Cultura atual', 'text', { placeholder: 'Ex.: Soja' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  productions: {
    singular: 'campo de produção', plural: 'Campos de produção', newLabel: 'Novo campo de produção', savedMsg: 'Campo de produção salvo', route: 'sementes',
    fields: [
      f('fieldId', 'Talhão', 'select', { ref: 'fields', required: true }),
      f('cultivar', 'Cultivar', 'text', { required: true }),
      f('season', 'Safra', 'text', { placeholder: 'Ex.: 2026/27' }),
      f('plantingDate', 'Data de plantio', 'date'),
      f('areaHa', 'Área', 'number', { unit: 'ha', min: 0 }),
      f('expectedKg', 'Produção prevista', 'number', { unit: 'kg', min: 0 }),
      f('status', 'Situação', 'select', { options: PROD_STATUS, required: true, default: 'planejado' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  lots: {
    singular: 'lote', plural: 'Lotes', newLabel: 'Novo lote', savedMsg: 'Lote salvo', route: 'lotes',
    fields: [
      f('code', 'Código do lote', 'text', { required: true, unique: true, placeholder: 'Ex.: SM-027' }),
      f('productionId', 'Campo de produção', 'select', { ref: 'productions' }),
      f('cultivar', 'Cultivar (se diferente do campo)', 'text'),
      f('harvestDate', 'Data de colheita', 'date'),
      f('quantityKg', 'Quantidade', 'number', { unit: 'kg', min: 0 }),
      f('germination', 'Germinação', 'number', { unit: '%', min: 0, max: 100 }),
      f('status', 'Situação', 'select', { options: LOT_STATUS, required: true, default: 'em_analise' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  stockItems: {
    singular: 'item de estoque', plural: 'Itens de estoque', newLabel: 'Novo item', savedMsg: 'Item salvo', route: 'estoque',
    fields: [
      f('name', 'Nome', 'text', { required: true, unique: true, full: true }),
      f('category', 'Categoria', 'select', { options: STOCK_CATEGORIES, required: true }),
      f('unit', 'Unidade', 'select', { options: UNITS, required: true }),
      f('minQty', 'Estoque mínimo', 'number', { min: 0 }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
  stockMoves: {
    singular: 'movimentação', plural: 'Movimentações de estoque', newLabel: 'Movimentar estoque', savedMsg: 'Movimentação salva', route: 'estoque',
    fields: [
      f('itemId', 'Item', 'select', { ref: 'stockItems', required: true, full: true }),
      f('kind', 'Tipo', 'select', { options: MOVE_KINDS, required: true, default: 'entrada' }),
      f('date', 'Data', 'date', { required: true, default: 'today' }),
      f('qty', 'Quantidade', 'number', { required: true, signedFor: 'ajuste' }),
      f('lotId', 'Lote relacionado', 'select', { ref: 'lots' }),
      f('notes', 'Observações', 'textarea', { full: true }),
    ],
  },
};

export const DATA_STORES = Object.keys(ENTITIES);
export const STORES = [...DATA_STORES, 'settings'];

export function optionList(options) {
  if (!options) return [];
  return Array.isArray(options) ? options.map(o => [o, o]) : Object.entries(options);
}
