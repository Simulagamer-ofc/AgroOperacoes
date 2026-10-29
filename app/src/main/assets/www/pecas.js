'use strict';
/* MercaPlant — Catálogo de peças das máquinas.
   Cada peça: código do fabricante, nome, marca, sistema (filtros, motor, hidráulico…), códigos equivalentes
   (outras marcas), em quais modelos ou máquinas serve, quantas vão na máquina, intervalo de troca, item do estoque
   (saldo) e fornecedores com o código de cada um. Sem preço: o catálogo é para achar a peça certa. Vale por modelo: cadastrada para “John Deere 7230J”, serve para
   todos os 7230J da fazenda.
   • Peças da máquina (pelo cartão ou pela ordem): as do catálogo e as que já saíram nas ordens e ainda não estão nele.
   • Pedido ao fornecedor: junta as peças, separa por fornecedor e manda por WhatsApp ou e-mail para cotação.
   • Importar planilha do fornecedor (CSV ou Excel): código, descrição, marca e aplicação.
   • Código igual a outra peça (o fornecedor usa o mesmo código para peças diferentes): ficam separadas, com aviso.
   • Catálogo oficial do fabricante (John Deere, Caterpillar, AGCO) abre no site da marca, para consultar e copiar o código. */

const SISTEMAS_PECA = ['Filtros', 'Motor', 'Lubrificantes e fluidos', 'Transmissão', 'Hidráulico', 'Elétrico', 'Freios e direção', 'Rodagem e pneus', 'Correias e correntes', 'Rolamentos',
  'Pulverização', 'Plantio', 'Colheita', 'Peças de desgaste', 'Cabine', 'Outro'];
// Sistema sugerido pelo nome da peça (planilha importada ou cadastro)
const PC_SISTEMA_NOME = [[/bico injetor|bomba injetora/i, 'Motor'], [/filtro|elemento filtrante/i, 'Filtros'], [/[oó]leo|graxa|fluido|arla|aditivo|lubrific/i, 'Lubrificantes e fluidos'], [/correia|corrente|polia|engrenagem/i, 'Correias e correntes'],
  [/rolamento|mancal|bucha/i, 'Rolamentos'], [/bico|ponta|pulveriz|bomba de calda|diafragma|manômetro|manometro|registro|antigotejo|porta.?bico/i, 'Pulverização'],
  [/disco|ponteira|faca|navalha|dedo|lâmina|lamina|sapata|dente/i, 'Peças de desgaste'], [/pneu|câmara|camara|roda|esteira/i, 'Rodagem e pneus'],
  [/l[aâ]mpada|farol|bateria|alternador|motor de partida|sensor|chicote|fus[ií]vel|rel[eé]/i, 'Elétrico'], [/junta|pist[aã]o|bico injetor|injetor|bomba injetora|turbina|radiador|bomba d.?[aá]gua|termostato/i, 'Motor'], [/mangueira|cilindro|v[aá]lvula|hidr[aá]ul|bomba hidr/i, 'Hidráulico'],
  [/embreagem|c[aâ]mbio|transmiss|diferencial|cardan|cruzeta/i, 'Transmissão'], [/freio|pastilha|lona|dire[cç][aã]o|terminal/i, 'Freios e direção'],
  [/dosador|sulcador|disco de semente|anel|condutor de semente/i, 'Plantio'],
  [/peneira|saca.?palha|rotor|c[oô]ncavo|batedor|caracol/i, 'Colheita'], [/vidro|banco|retrovisor|palheta|ar.?condicionado/i, 'Cabine']];
const pcSistemaPeloNome = n => PC_SISTEMA_NOME.find(([re]) => re.test(n || ''))?.[1] || 'Outro';
const pcGestor = () => typeof mcpGestor !== 'function' || mcpGestor();
const pcNorm = s => semAcentoApp(s).replace(/[^a-z0-9]+/g, '');

// Modelos da frota: máquinas e implementos com o mesmo modelo ficam juntos; sem modelo, a máquina sozinha
function pcModelos() {
  const g = new Map();
  db.machines.filter(m => !isInactive(m)).forEach(m => {
    const k = m.model && pcNorm(m.model) ? 'mod:' + pcNorm(m.model) : 'maq:' + m.id;
    if (!g.has(k)) g.set(k, {chave: k, rotulo: m.model ? m.model.trim() : m.name, tipo: m.type === 'Implemento' ? (m.tipoImpl || 'Implemento') : m.type, maquinas: []});
    g.get(k).maquinas.push(m);
  });
  return [...g.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', {numeric: true}));
}
const pcServe = (p, m) => !!m && ((p.aplica?.maquinas || []).includes(m.id) || (!!m.model && (p.aplica?.modelos || []).includes(pcNorm(m.model))));
const pcDaMaquina = m => db.pecas.filter(p => pcServe(p, m));
const pcEstoque = p => p?.itemId ? find('stock', p.itemId) : null;
const pcAplicaTexto = (p, semQtd) => {
  const mods = pcModelos().filter(g => g.chave.startsWith('mod:') ? (p.aplica?.modelos || []).includes(g.chave.slice(4)) : (p.aplica?.maquinas || []).includes(g.chave.slice(4)));
  return mods.map(g => g.rotulo + (!semQtd && g.maquinas.length > 1 ? ` (${g.maquinas.length})` : ''));
};
// Saldo do estoque: sem, abaixo do mínimo, ok
function pcSituacao(p) {
  const s = pcEstoque(p); if (!s) return {nivel: 'sem-item', texto: 'fora do estoque', cor: 'gray'};
  const q = Number(s.qty) || 0, min = Number(s.min) || 0;
  if (q <= 0) return {nivel: 'zero', texto: 'sem saldo', cor: 'red', s};
  if (min > 0 && q <= min) return {nivel: 'baixo', texto: `${num(q)} ${s.unit || 'un'} (mín. ${num(min)})`, cor: 'orange', s};
  return {nivel: 'ok', texto: `${num(q)} ${s.unit || 'un'}`, cor: 'green', s};
}
// Catálogo oficial do fabricante: abre o site da marca (consulta; o código vem para cá à mão)
function pcLinkFabricante(m) {
  const t = semAcentoApp(`${m?.model || ''} ${m?.name || ''} ${m?.catalogo?.marca || ''}`);
  if (/john ?deere|\bdeere\b|\bjd\b/.test(t)) return {marca: 'John Deere', url: 'https://partscatalog.deere.com/'};
  if (/caterpillar|\bcat\b/.test(t)) return {marca: 'Caterpillar', url: 'https://parts.cat.com/pt/catcorp'};
  if (/massey|valtra|fendt|challenger|agco|\bmf\b/.test(t)) return {marca: 'AGCO (Massey, Valtra, Fendt)', url: 'https://www.agcopartsandservice.com/eame/en/parts/brands/massey-ferguson/parts-books.html', login: true};
  const q = (m?.model || m?.name || '').trim();
  return q ? {marca: '', url: 'https://www.google.com/search?q=' + encodeURIComponent(`${q} catálogo de peças`), busca: true} : null;
}
const pcBotaoFabricante = m => { const l = pcLinkFabricante(m); return l ? `<a class="btn secondary pc-fab" href="${esc(l.url)}" target="_blank" rel="noopener">${l.busca ? '🔎 Buscar catálogo na internet' : `📘 Catálogo ${esc(l.marca)}`}</a>` : ''; };

// ---------------- Lista ----------------
function pcCartao(p) {
  const sit = pcSituacao(p), ap = pcAplicaTexto(p), g = pcGestor();
  const extras = [
    ap.length ? `Serve em: ${esc(ap.slice(0, 3).join(', '))}${ap.length > 3 ? ` e mais ${ap.length - 3}` : ''}` : (p.aplicacaoTexto ? `Aplicação: ${esc(p.aplicacaoTexto)}` : '<span class="pc-aviso">Sem máquina vinculada</span>'),
    (p.equivalentes || []).length ? `Equivalentes: ${(p.equivalentes || []).map(e => `<span class="pc-cod">${esc([e.marca, e.codigo].filter(Boolean).join(' '))}</span>`).join(' ')}` : '',
    [Number(p.qtd) > 0 ? `${num(p.qtd)} por máquina` : '', Number(p.trocaCada) > 0 ? `troca a cada ${num(p.trocaCada)} ${p.trocaUnid === 'dias' ? 'dias' : p.trocaUnid === 'km' ? 'km' : 'h'}` : ''].filter(Boolean).join(' • '),
    (p.fornecedores || []).length ? `Fornecedor: ${(p.fornecedores || []).map(f => esc([find('fornecedores', f.fornecedorId)?.nome, f.codigo && f.codigo !== p.codigo ? `(cód. ${f.codigo})` : ''].filter(Boolean).join(' '))).join(', ')}` : '',
    p.origem?.titulo ? `Catálogo ${esc(p.origem.titulo)}: ${esc(p.origem.grupo || '')}${p.origem.rep ? ` • nº ${esc(p.origem.rep)}` : ''}${p.origem.pag ? ` • desenho pág. ${p.origem.pag}` : ''}` : '',
    p.codigoRepetido ? '<span class="pc-aviso">⚠ Código igual a outra peça no fornecedor — confirme antes de comprar</span>' : ''
  ].filter(Boolean);
  return `<article class="card item-card pc-card"><header><div><h4><span class="pc-cod">${esc(p.codigo || 's/ código')}</span> ${esc(p.nome)}</h4><div class="meta">${esc([p.marca, p.sistema].filter(Boolean).join(' • '))}</div></div>${chip(sit.texto, sit.cor)}</header>
    <div class="meta">${extras.map(x => `<span>${x}</span>`).join('')}</div>
    <div class="maq-acoes">${g ? mini('🛒 Pedir', 'pc-pedir', p.id) + mini('Editar', 'nav', 'peca/' + p.id) : ''}${sit.s ? mini('Estoque', 'nav', 'estoque') : ''}
      ${g ? `<details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">${mini('Excluir do catálogo', 'pc-del', p.id, 'del')}</div></details>` : ''}</div></article>`;
}
const pcTexto = p => [p.codigo, p.nome, p.marca, p.sistema, p.aplicacaoTexto, ...(p.equivalentes || []).map(e => `${e.marca} ${e.codigo}`), ...(p.fornecedores || []).map(f => `${f.codigo || ''} ${find('fornecedores', f.fornecedorId)?.nome || ''}`), ...pcAplicaTexto(p)].filter(Boolean).join(' ');
// Peças que saíram do estoque nas ordens desta máquina e ainda não estão no catálogo
function pcUsadasForaDoCatalogo(m) {
  const ligados = new Set(db.pecas.map(p => p.itemId).filter(Boolean)), cont = new Map();
  db.maintenances.filter(mt => mt.machineId === m.id).forEach(mt => (mt.checklist || []).filter(it => it.movId).forEach(it => {
    const mv = db.movements.find(x => x.id === it.movId), s = mv && find('stock', mv.itemId);
    if (s && !ligados.has(s.id)) cont.set(s.id, {s, vezes: (cont.get(s.id)?.vezes || 0) + 1, ultima: [cont.get(s.id)?.ultima, mt.doneDate || mt.date].filter(Boolean).sort().at(-1)});
  }));
  return [...cont.values()].sort((a, b) => b.vezes - a.vezes);
}
VIEWS.pecas = arg => {
  const m = arg ? find('machines', arg) : null, g = pcGestor(), ped = pcPedido().length;
  const lista = (m ? pcDaMaquina(m) : db.pecas.slice()).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', {numeric: true}));
  const botoes = (g ? btn('Importar planilha', 'nav', 'importarpecas', 'secondary') + btn('Fornecedores', 'nav', 'fornecedores', 'secondary') + btn(`🛒 Pedido${ped ? ` (${ped})` : ''}`, 'nav', 'pedidopecas', 'secondary') : '') + (g ? btn('+ Nova peça', 'nav', 'peca/novo' + (m ? '~' + m.id : '')) : '');
  const topo = m ? head(`Peças — ${m.name}`, [m.type === 'Implemento' ? m.tipoImpl : m.type, m.model].filter(Boolean).join(' • ') || 'Peças desta máquina', btn('← Todas as peças', 'nav', 'pecas', 'secondary') + pcBotaoFabricante(m) + botoes)
    : head('Catálogo de peças', `${db.pecas.length} ${db.pecas.length === 1 ? 'peça' : 'peças'} • por modelo de máquina, com estoque e fornecedores`, botoes);
  const usadas = m && g ? pcUsadasForaDoCatalogo(m) : [];
  const blocoUsadas = usadas.length ? `<div class="section-title"><h3>Usadas nas ordens e fora do catálogo (${usadas.length})</h3></div><section class="card list">${usadas.map(u => `<div class="list-row"><div><strong>${esc(u.s.name)}</strong><small>${[u.s.codigo ? 'código ' + u.s.codigo : '', `${u.vezes} ${u.vezes === 1 ? 'vez' : 'vezes'}`, u.ultima ? 'última em ' + fmtDate(u.ultima) : ''].filter(Boolean).map(esc).join(' • ')}</small></div><div class="row-actions">${mini('+ Pôr no catálogo', 'nav', `peca/novo~${m.id}~${u.s.id}`)}</div></div>`).join('')}</section>` : '';
  const vazio = `<section class="card">${empty(m ? 'Nenhuma peça desta máquina no catálogo' : 'Catálogo vazio', m ? 'Cadastre as peças que esta máquina usa (filtros, correias, rolamentos…) ou consulte o catálogo do fabricante e copie o código.' : 'Cadastre as peças por modelo de máquina, ou importe a planilha de produtos do seu fornecedor (código, descrição e preço).', g ? {act: 'nav', id: 'peca/novo' + (m ? '~' + m.id : ''), label: '+ Nova peça'} : null)}</section>`;
  const corpo = lista.length ? (typeof catmLista === 'function' ? catmLista(m ? 'pecas-maq' : 'pecas', lista, {nome: 'peça', placeholder: 'Buscar por código, nome, marca, equivalente ou máquina', grupos: SISTEMAS_PECA, grupoDe: p => SISTEMAS_PECA.includes(p.sistema) ? p.sistema : 'Outro', cartao: pcCartao, atencao: p => ['zero', 'baixo'].includes(pcSituacao(p).nivel), texto: pcTexto})
    : `<section class="cards">${lista.map(pcCartao).join('')}</section>`) : vazio;
  return topo + blocoUsadas + corpo;
};
TITLES.pecas = 'Máquinas e manutenção';

// ---------------- Editor da peça ----------------
let pce = null; // rascunho
function pceNovo(maqId, itemId) {
  const m = maqId ? find('machines', maqId) : null, s = itemId ? find('stock', itemId) : null;
  const aplica = {modelos: [], maquinas: []};
  if (m) { if (m.model && pcNorm(m.model)) aplica.modelos.push(pcNorm(m.model)); else aplica.maquinas.push(m.id); }
  return {id: '', codigo: s?.codigo || '', nome: s?.name || '', marca: '', sistema: s ? pcSistemaPeloNome(s.name) : '', equivalentes: [], aplica, qtd: '', trocaCada: '', trocaUnid: m && typeof porKm === 'function' && porKm(m) ? 'km' : 'h', itemId: s?.id || '', fornecedores: [], obs: '', _volta: m ? 'pecas/' + m.id : 'pecas'};
}
function pceLer() {
  const f = $('#pceForm'); if (!f || !pce) return;
  const v = k => f.elements[k]?.value?.trim() ?? '';
  Object.assign(pce, {codigo: v('codigo').toUpperCase(), nome: v('nome'), marca: v('marca'), sistema: v('sistema'), qtd: v('qtd'), trocaCada: v('trocaCada'), trocaUnid: v('trocaUnid'), itemId: v('itemId'), obs: v('obs')});
  // Modelos marcados agora; os que não estão mais na frota (máquina vendida ou inativa) continuam
  const caixas = $$('[data-pce-mod]', f), presentes = new Set(caixas.map(c => c.value)), marc = caixas.filter(c => c.checked).map(c => c.value), ant = pce.aplica || {};
  pce.aplica = {modelos: [...(ant.modelos || []).filter(x => !presentes.has('mod:' + x)), ...marc.filter(v => v.startsWith('mod:')).map(v => v.slice(4))],
    maquinas: [...(ant.maquinas || []).filter(x => !presentes.has('maq:' + x)), ...marc.filter(v => v.startsWith('maq:')).map(v => v.slice(4))]};
  pce.equivalentes = $$('[data-pce-eq]', f).map(r => ({marca: $('[data-k="marca"]', r).value.trim(), codigo: $('[data-k="codigo"]', r).value.trim().toUpperCase()}));
  pce.fornecedores = $$('[data-pce-fo]', f).map(r => ({fornecedorId: $('[data-k="fornecedorId"]', r).value, codigo: $('[data-k="codigo"]', r).value.trim().toUpperCase()}));
}
VIEWS.peca = arg => {
  if (!pcGestor()) return head('Peça', 'Só para o ADM e o supervisor.', btn('← Peças', 'nav', 'pecas', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  const [id, maqId, itemId] = String(arg || 'novo').split('~');
  if (!pce || pce._arg !== arg) {
    const p = id !== 'novo' ? find('pecas', id) : null;
    if (id !== 'novo' && !p) return empty('Peça não encontrada', 'Ela pode ter sido excluída.');
    pce = p ? {...JSON.parse(JSON.stringify(p)), _volta: 'pecas'} : pceNovo(maqId, itemId); pce._arg = arg;
  }
  const p = pce;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`;
  const mods = pcModelos();
  const marcado = gr => gr.chave.startsWith('mod:') ? (p.aplica?.modelos || []).includes(gr.chave.slice(4)) : (p.aplica?.maquinas || []).includes(gr.chave.slice(4));
  const pecasEst = db.stock.slice().sort((a, b) => ((b.category === 'Peças') - (a.category === 'Peças')) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const forns = db.fornecedores.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  return head(p.id ? `Editar peça — ${p.codigo || p.nome}` : 'Nova peça', 'Cadastre uma vez por modelo: vale para todas as máquinas iguais.', btn('← Voltar', 'pce-cancelar', '', 'secondary')) +
    `<form id="pceForm" class="pce" onsubmit="return false">
    <section class="card panel"><h3 class="pce-tit">Identificação</h3><div class="form">
      <div class="field"><label for="pce_codigo">Código do fabricante</label><input id="pce_codigo" name="codigo" value="${esc(p.codigo)}" placeholder="Ex.: RE504836" autocomplete="off" class="pc-cod-in"></div>
      <div class="field"><label for="pce_nome">Nome da peça *</label><input id="pce_nome" name="nome" value="${esc(p.nome)}" placeholder="Ex.: Filtro de óleo do motor" required></div>
      <div class="field"><label for="pce_marca">Marca da peça</label><input id="pce_marca" name="marca" value="${esc(p.marca)}" placeholder="Ex.: John Deere, Fleetguard, TeeJet"></div>
      <div class="field"><label for="pce_sistema">Sistema</label><select id="pce_sistema" name="sistema"><option value="">—</option>${SISTEMAS_PECA.map(s => opt(s, s, p.sistema)).join('')}</select></div>
    </div></section>
    <section class="card panel"><h3 class="pce-tit">Serve em</h3><p class="nota">Marque o modelo: vale para todas as máquinas dele (e para as que você cadastrar depois com o mesmo modelo).</p>
      <div class="pce-mods">${mods.length ? mods.map(gr => `<label class="pce-mod"><input type="checkbox" data-pce-mod value="${esc(gr.chave)}" ${marcado(gr) ? 'checked' : ''}><span><b>${esc(gr.rotulo)}</b><small>${esc(gr.tipo)} • ${esc(gr.maquinas.map(x => x.name).join(', '))}</small></span></label>`).join('') : '<p class="nota">Nenhuma máquina cadastrada.</p>'}</div>
      ${p.aplicacaoTexto ? `<p class="nota">Aplicação na planilha do fornecedor: ${esc(p.aplicacaoTexto)}</p>` : ''}
      <div class="form"><div class="field"><label for="pce_qtd">Quantidade por máquina</label><input id="pce_qtd" name="qtd" inputmode="decimal" value="${esc(String(p.qtd ?? '').replace('.', ','))}" placeholder="Ex.: 1"></div>
        <div class="field"><label for="pce_troca">Troca a cada</label><div class="pce-troca"><input id="pce_troca" name="trocaCada" inputmode="decimal" value="${esc(String(p.trocaCada ?? '').replace('.', ','))}" placeholder="Ex.: 500"><select name="trocaUnid" aria-label="Unidade da troca">${opt('h', 'horas', p.trocaUnid)}${opt('km', 'km', p.trocaUnid)}${opt('dias', 'dias', p.trocaUnid)}</select></div></div></div></section>
    <section class="card panel"><h3 class="pce-tit">Códigos equivalentes <small>outras marcas que servem no lugar</small></h3>
      ${(p.equivalentes || []).map((e, i) => `<div class="pce-linha" data-pce-eq><input data-k="marca" value="${esc(e.marca)}" placeholder="Marca (ex.: Fleetguard)" aria-label="Marca equivalente"><input data-k="codigo" class="pc-cod-in" value="${esc(e.codigo)}" placeholder="Código" aria-label="Código equivalente"><button type="button" class="link del" data-act="pce-eq-del" data-id="${i}" aria-label="Tirar">✕</button></div>`).join('')}
      <button type="button" class="secondary" data-act="pce-eq-add">+ Código equivalente</button></section>
    <section class="card panel"><h3 class="pce-tit">Estoque</h3><div class="form"><div class="field full"><label for="pce_item">Item do estoque (saldo e baixa nas ordens)</label><select id="pce_item" name="itemId"><option value="">— não controlar no estoque —</option><option value="__novo">+ Criar no estoque (categoria Peças)</option>${pecasEst.map(s => opt(s.id, `${s.name}${s.category ? ' — ' + s.category : ''} (${num(s.qty)} ${s.unit || ''})`, p.itemId)).join('')}</select></div></div></section>
    <section class="card panel"><h3 class="pce-tit">Fornecedores</h3>
      ${(p.fornecedores || []).map((f, i) => `<div class="pce-linha forn" data-pce-fo><select data-k="fornecedorId" aria-label="Fornecedor"><option value="">Fornecedor…</option>${forns.map(x => opt(x.id, x.nome, f.fornecedorId)).join('')}</select><input data-k="codigo" class="pc-cod-in" value="${esc(f.codigo || '')}" placeholder="Código no fornecedor" aria-label="Código no fornecedor"><button type="button" class="link del" data-act="pce-fo-del" data-id="${i}" aria-label="Tirar">✕</button></div>`).join('')}
      <div class="btn-row"><button type="button" class="secondary" data-act="pce-fo-add">+ Fornecedor nesta peça</button><button type="button" class="link" data-act="pce-fo-novo">Cadastrar fornecedor novo</button></div></section>
    <section class="card panel"><div class="form"><div class="field full"><label for="pce_obs">Observações</label><textarea id="pce_obs" name="obs" rows="2" placeholder="Ex.: usar com o kit de vedação; conferir o número de série">${esc(p.obs || '')}</textarea></div></div>
      <div class="actions"><button type="button" class="secondary" data-act="pce-cancelar">Cancelar</button><button type="button" class="primary" data-act="pce-salvar">Salvar peça</button></div></section></form>`;
};
VIEWS.peca.after = () => {
  const f = $('#pceForm'); if (!f) return;
  // Nome digitado sugere o sistema (enquanto o sistema não foi escolhido)
  const nome = f.elements.nome, sis = f.elements.sistema; let mexeu = !!sis.value;
  sis.addEventListener('change', () => { mexeu = true; });
  nome.addEventListener('input', () => { if (!mexeu) sis.value = pcSistemaPeloNome(nome.value) === 'Outro' ? '' : pcSistemaPeloNome(nome.value); });
};
TITLES.peca = 'Máquinas e manutenção';
const pceVolta = () => { const v = pce?._volta || 'pecas'; pce = null; go(v); };
Object.assign(ACTIONS, {
  'pce-eq-add': () => { if (!pce) return; pceLer(); pce.equivalentes.push({marca: '', codigo: ''}); render(); setTimeout(() => $$('[data-pce-eq] [data-k="marca"]').at(-1)?.focus(), 0); },
  'pce-eq-del': i => { if (!pce) return; pceLer(); pce.equivalentes.splice(Number(i), 1); render(); },
  'pce-fo-add': () => { if (!pce) return; pceLer(); pce.fornecedores.push({fornecedorId: db.fornecedores.length === 1 ? db.fornecedores[0].id : '', codigo: ''}); render(); },
  'pce-fo-del': i => { if (!pce) return; pceLer(); pce.fornecedores.splice(Number(i), 1); render(); },
  'pce-fo-novo': () => { if (!pce) return; pceLer(); fornecedorForm({}, f => { pce.fornecedores.push({fornecedorId: f.id, codigo: ''}); }); },
  'pce-cancelar': () => pceVolta(),
  'pce-salvar': () => {
    if (!pcGestor() || !pce) return;
    pceLer(); const p = pce;
    if (!p.nome) { showToast('Informe o nome da peça', true); $('#pce_nome')?.focus(); return; }
    const cod = pcNorm(p.codigo), mesmoCod = cod ? db.pecas.filter(x => x.id !== p.id && pcNorm(x.codigo) === cod) : [];
    const igual = mesmoCod.find(x => pcNorm(x.nome) === pcNorm(p.nome));
    if (igual) { showToast(`${p.codigo} — ${igual.nome} já está no catálogo. Edite aquela peça.`, true); return; }
    // Mesmo código e nome diferente: o fornecedor usa o código em mais de uma peça — fica separada, com aviso nas duas
    if (mesmoCod.length) { p.codigoRepetido = true; mesmoCod.forEach(x => { if (!x.codigoRepetido) { x.codigoRepetido = true; upsert('pecas', x); } }); p._aviso = `Atenção: o código ${p.codigo} também está em ${mesmoCod[0].nome}. As duas ficam com aviso para confirmar.`; }
    if (p.fornecedores.some(f => !f.fornecedorId)) { showToast('Escolha o fornecedor de cada linha (ou tire a linha)', true); return; }
    p.equivalentes = p.equivalentes.filter(e => e.codigo);
    const q = numeroBR(p.qtd), t = numeroBR(p.trocaCada);
    p.qtd = q > 0 ? q : ''; p.trocaCada = t > 0 ? t : '';
    if (p.itemId === '__novo') {
      const s = {id: uid(), name: p.nome, category: 'Peças', unit: 'un', qty: 0, min: '', codigo: p.codigo, fornecedor: find('fornecedores', p.fornecedores[0]?.fornecedorId)?.nome || ''};
      db.stock.push(s); p.itemId = s.id;
    }
    const {_arg, _volta, _aviso, ...dados} = p;
    const novo = !dados.id; if (novo) { dados.id = uid(); dados.criadoEm = new Date().toISOString(); }
    upsert('pecas', dados); showToast(_aviso || (novo ? 'Peça cadastrada no catálogo' : 'Peça salva')); pceVolta();
  },
  'pc-del': id => { const p = find('pecas', id); if (!p) return; confirmDialog(`Excluir ${p.codigo || p.nome} do catálogo? O item do estoque continua.`, () => { remove('pecas', id); pcPedidoSalvar(pcPedido().filter(x => x.pecaId !== id)); showToast('Peça excluída do catálogo'); }); }
});

// ---------------- Fornecedores ----------------
function fornecedorForm(f = {}, depois) {
  openForm({
    title: f.id ? 'Editar fornecedor' : 'Novo fornecedor', sub: 'Para mandar o pedido de cotação por WhatsApp ou e-mail.', values: f,
    fields: [{k: 'nome', label: 'Nome', required: true, placeholder: 'Ex.: FAGRO'}, {k: 'whatsapp', label: 'WhatsApp', placeholder: 'Ex.: (17) 99162-7334', type: 'tel'},
      {k: 'email', label: 'E-mail', type: 'email', placeholder: 'Ex.: vendas@fornecedor.com.br'}, {k: 'cidade', label: 'Cidade / UF', placeholder: 'Ex.: Pindorama-SP'},
      {k: 'contato', label: 'Pessoa de contato', mais: true}, {k: 'obs', label: 'Observações', type: 'textarea', mais: true, placeholder: 'Ex.: marcas que vende, prazo de entrega'}],
    onSubmit: v => {
      v.nome = v.nome.replace(/\s+/g, ' ').trim(); if (!v.nome) return 'Informe o nome';
      if (db.fornecedores.some(x => x.id !== f.id && pcNorm(x.nome) === pcNorm(v.nome))) return `Já existe o fornecedor ${v.nome}`;
      const r = {...f, ...v, id: f.id || uid()}; upsert('fornecedores', r); showToast('Fornecedor salvo'); depois?.(r);
    }
  });
}
VIEWS.fornecedores = () => {
  const g = pcGestor(), l = db.fornecedores.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const nPecas = f => db.pecas.filter(p => (p.fornecedores || []).some(x => x.fornecedorId === f.id)).length;
  return head('Fornecedores de peças', 'Quem vende as peças da frota: o pedido de cotação vai direto pelo WhatsApp ou e-mail.', btn('← Peças', 'nav', 'pecas', 'secondary') + (g ? btn('+ Novo fornecedor', 'fo-novo') : '')) +
    (l.length ? `<section class="card list">${l.map(f => `<div class="list-row"><div><strong>${esc(f.nome)}</strong><small>${esc([f.cidade, f.whatsapp, f.email, `${nPecas(f)} ${nPecas(f) === 1 ? 'peça' : 'peças'} no catálogo`].filter(Boolean).join(' • '))}</small></div><div class="row-actions">${g ? mini('Editar', 'fo-editar', f.id) + mini('Excluir', 'fo-del', f.id, 'del') : ''}</div></div>`).join('')}</section>`
      : `<section class="card">${empty('Nenhum fornecedor', 'Cadastre as revendas e distribuidores de peças (ex.: FAGRO, concessionária, loja de filtros).', g ? {act: 'fo-novo', label: '+ Novo fornecedor'} : null)}</section>`);
};
TITLES.fornecedores = 'Máquinas e manutenção';
Object.assign(ACTIONS, {
  'fo-novo': () => fornecedorForm(), 'fo-editar': id => fornecedorForm(find('fornecedores', id)),
  'fo-del': id => { const f = find('fornecedores', id); if (!f) return; const n = db.pecas.filter(p => (p.fornecedores || []).some(x => x.fornecedorId === id)).length;
    confirmDialog(`Excluir ${f.nome}?${n ? ` Sai também das ${n} ${n === 1 ? 'peça' : 'peças'} em que ele aparece.` : ''}`, () => { db.pecas.forEach(p => { if ((p.fornecedores || []).some(x => x.fornecedorId === id)) { p.fornecedores = p.fornecedores.filter(x => x.fornecedorId !== id); upsert('pecas', p); } }); remove('fornecedores', id); }); }
});

// ---------------- Pedido de peças (lista para o fornecedor; sem preço no sistema) ----------------
// Lista de compra deste aparelho: [{pecaId, qtd, fornecedorId}]
const PC_PEDIDO = 'mp-pedido-pecas';
function pcPedido() { try { return JSON.parse(localStorage.getItem(PC_PEDIDO) || '[]').filter(x => find('pecas', x.pecaId)); } catch { return pcPedidoMem; } }
let pcPedidoMem = [];
function pcPedidoSalvar(l) { pcPedidoMem = l; try { localStorage.setItem(PC_PEDIDO, JSON.stringify(l)); } catch { /* fica só na memória */ } }
function pcPedir(id, qtd) {
  const p = find('pecas', id); if (!p) return;
  const l = pcPedido(), ja = l.find(x => x.pecaId === id);
  if (ja) ja.qtd = Number(ja.qtd || 0) + (qtd || 1);
  else l.push({pecaId: id, qtd: qtd || Math.max(1, Number(p.qtd) || 1), fornecedorId: p.fornecedores?.[0]?.fornecedorId || ''});
  pcPedidoSalvar(l);
}
// Abaixo do mínimo ou zerado e que não está no pedido
const pcFaltando = () => { const no = new Set(pcPedido().map(x => x.pecaId)); return db.pecas.filter(p => !no.has(p.id) && ['zero', 'baixo'].includes(pcSituacao(p).nivel)); };
function pcMensagem(forn, linhas) {
  const faz = db.settings.farm || 'nossa fazenda', quem = db.settings.owner || '';
  return `Olá${forn ? ', ' + forn.nome : ''}! Preciso destas peças para a ${faz}:\n` +
    linhas.map(({p, l}) => { const fo = (p.fornecedores || []).find(x => x.fornecedorId === l.fornecedorId); const eq = (p.equivalentes || []).slice(0, 2).map(e => [e.marca, e.codigo].filter(Boolean).join(' ')).join(', ');
      const maq = pcAplicaTexto(p, true).slice(0, 2).join(', ') || p.origem?.titulo || '';
      return `• ${num(l.qtd)} un — ${p.codigo || 's/ código'}${fo?.codigo && fo.codigo !== p.codigo ? ` (seu código ${fo.codigo})` : ''} — ${p.nome}${p.marca ? ' ' + p.marca : ''}${maq ? ` — para ${maq}` : ''}${p.origem?.grupo ? ` (${p.origem.grupo}${p.origem.rep ? `, nº ${p.origem.rep}` : ''})` : ''}${eq ? ` [equivalente: ${eq}]` : ''}${p.codigoRepetido ? ' [confirmar: código igual a outra peça]' : ''}`; }).join('\n') +
    `\n\nPor favor, confirme se tem e o prazo de entrega.${quem ? `\nObrigado, ${quem}.` : ' Obrigado.'}`;
}
const pcFone = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length >= 10 && d.length <= 11) d = '55' + d; return d; };
VIEWS.pedidopecas = () => {
  if (!pcGestor()) return head('Pedido de peças', 'Só para o ADM e o supervisor.', btn('← Peças', 'nav', 'pecas', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  const l = pcPedido(), falt = pcFaltando();
  const grupos = new Map(); l.forEach(x => { const k = x.fornecedorId || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push({l: x, p: find('pecas', x.pecaId)}); });
  const sugest = falt.length ? `<section class="card panel pc-falta"><div><strong>${falt.length} ${falt.length === 1 ? 'peça está' : 'peças estão'} sem saldo ou abaixo do mínimo</strong><small>${esc(falt.slice(0, 4).map(p => p.codigo || p.nome).join(', '))}${falt.length > 4 ? '…' : ''}</small></div>${btn('Incluir no pedido', 'pcp-faltando', '', 'secondary')}</section>` : '';
  const linha = ({l: x, p}) => { const fo = (p.fornecedores || []).find(f => f.fornecedorId === x.fornecedorId);
    return `<div class="pcp-linha" data-pcp="${esc(p.id)}"><input data-pcp-qtd inputmode="decimal" value="${esc(String(x.qtd).replace('.', ','))}" aria-label="Quantidade de ${esc(p.nome)}"><div><strong><span class="pc-cod">${esc(p.codigo || 's/ código')}</span> ${esc(p.nome)}</strong><small>${esc(pcAplicaTexto(p).slice(0, 2).join(', ') || p.origem?.titulo || p.marca || '')}${fo?.codigo && fo.codigo !== p.codigo ? ` • cód. no fornecedor ${esc(fo.codigo)}` : ''}${p.codigoRepetido ? ' • <span class="pc-aviso">⚠ confirmar código</span>' : ''}</small></div>
      <select data-pcp-forn aria-label="Fornecedor"><option value="">Sem fornecedor</option>${db.fornecedores.map(f => `<option value="${esc(f.id)}" ${f.id === x.fornecedorId ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select><button type="button" class="link del" data-act="pcp-tirar" data-id="${esc(p.id)}" aria-label="Tirar do pedido">✕</button></div>`; };
  const grupo = ([fid, ls]) => {
    const f = fid ? find('fornecedores', fid) : null, msg = pcMensagem(f, ls), fone = pcFone(f?.whatsapp);
    return `<section class="card panel pcp-grupo"><header class="pcp-cab"><div><h3>${esc(f?.nome || 'Sem fornecedor escolhido')}</h3><small>${esc([f?.cidade, f?.whatsapp, f?.email].filter(Boolean).join(' • ') || (f ? '' : 'Escolha o fornecedor de cada peça, ou copie a lista'))}</small></div></header>
      ${ls.map(linha).join('')}
      <details class="pcp-msg"><summary>Ver a mensagem</summary><pre>${esc(msg)}</pre></details>
      <div class="btn-row">${fone ? `<a class="btn primary" href="https://wa.me/${fone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${f?.email ? `<a class="btn secondary" href="mailto:${esc(f.email)}?subject=${encodeURIComponent('Pedido de peças — ' + (db.settings.farm || 'fazenda'))}&body=${encodeURIComponent(msg)}">E-mail</a>` : ''}<button class="secondary" data-act="pcp-copiar" data-id="${esc(fid)}">Copiar</button></div></section>`;
  };
  return head('Pedido de peças', 'Junte as peças, confira as quantidades e mande para cada fornecedor com os códigos certos.', btn('← Peças', 'nav', 'pecas', 'secondary') + (l.length ? btn('Limpar pedido', 'pcp-limpar', '', 'secondary') : '')) + sugest +
    (l.length ? [...grupos.entries()].sort(([a], [b]) => (a === '') - (b === '')).map(grupo).join('') : `<section class="card">${empty('Pedido vazio', 'Toque em “🛒 Pedir” nas peças do catálogo, ou inclua as que estão abaixo do mínimo no estoque.', {act: 'nav', id: 'pecas', label: '← Catálogo de peças'})}</section>`);
};
TITLES.pedidopecas = 'Máquinas e manutenção';
document.addEventListener('change', e => {
  const r = e.target?.closest?.('[data-pcp]'); if (!r) return;
  const l = pcPedido(), x = l.find(y => y.pecaId === r.dataset.pcp); if (!x) return;
  if (e.target.matches('[data-pcp-qtd]')) { const q = numeroBR(e.target.value); x.qtd = q > 0 ? q : 1; }
  if (e.target.matches('[data-pcp-forn]')) x.fornecedorId = e.target.value;
  pcPedidoSalvar(l); render();
});
Object.assign(ACTIONS, {
  'pc-pedir': id => { pcPedir(id); const n = pcPedido().length; showToast(`No pedido (${n} ${n === 1 ? 'peça' : 'peças'}) — veja em 🛒 Pedido`); render(); },
  'pcp-faltando': () => { pcFaltando().forEach(p => { const s = pcEstoque(p), falta = Math.max(1, (Number(s?.min) || 0) - (Number(s?.qty) || 0), Number(p.qtd) || 1); pcPedir(p.id, falta); }); render(); },
  'pcp-tirar': id => { pcPedidoSalvar(pcPedido().filter(x => x.pecaId !== id)); render(); },
  'pcp-limpar': () => confirmDialog('Limpar o pedido?', () => { pcPedidoSalvar([]); }, 'Limpar'),
  'pcp-copiar': fid => {
    const ls = pcPedido().filter(x => (x.fornecedorId || '') === (fid || '')).map(x => ({l: x, p: find('pecas', x.pecaId)}));
    const msg = pcMensagem(fid ? find('fornecedores', fid) : null, ls);
    (navigator.clipboard?.writeText(msg) || Promise.reject()).then(() => showToast('Mensagem copiada'), () => showToast('Não deu para copiar: abra “Ver a mensagem” e copie', true));
  }
});

// ---------------- Importar planilha do fornecedor ----------------
// CSV do Excel brasileiro costuma vir em Windows-1252; UTF-8 quando dá
const pcTexto8 = b => { try { return new TextDecoder('utf-8', {fatal: true}).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } };
function pcLerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const amostra = linhas.slice(0, 5).join('\n'), sep = [';', '\t', ','].sort((a, b) => amostra.split(b).length - amostra.split(a).length)[0];
  return linhas.map(l => { const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c; }
    out.push(cur.trim()); return out; });
}
async function pcLerXlsx(buf) {
  if (typeof tmUnzip !== 'function') throw new Error('xlsx');
  const arqs = await tmUnzip(buf), txt = n => { const a = arqs.find(x => x.nome === n); return a ? new TextDecoder().decode(a.dados) : ''; };
  const xml = s => new DOMParser().parseFromString(s, 'text/xml'), tags = (el, t) => [...el.getElementsByTagNameNS('*', t)];
  const ss = txt('xl/sharedStrings.xml') ? tags(xml(txt('xl/sharedStrings.xml')), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
  const folha = arqs.map(a => a.nome).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))[0];
  if (!folha) throw new Error('xlsx');
  const col = r => { let n = 0; for (const ch of r.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return tags(xml(txt(folha)), 'row').map(row => { const out = [];
    tags(row, 'c').forEach(c => { const t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '', i = col(c.getAttribute('r') || 'A1');
      out[i] = t === 's' ? ss[Number(v)] ?? '' : t === 'inlineStr' ? tags(c, 't').map(x => x.textContent).join('') : v; });
    return Array.from(out, x => String(x ?? '').trim()); });
}
const PC_CAMPOS = [['codigo', 'Código *', /^(c[oó]d(igo)?|ref(er[eê]ncia)?|part ?n(o|umber)|sku|item)/i], ['nome', 'Descrição *', /^(descri|produto|nome|item desc)/i], ['marca', 'Marca', /^(marca|fabricante|brand)/i],
  ['aplicacao', 'Aplicação / modelo', /(aplica|modelo|m[aá]quina|equip)/i], ['equivalente', 'Código equivalente', /(equival|similar|original|oem|cruzad)/i]];
let pci = null; // {arquivo, linhas, cab, mapa, fornecedorId, filtro}
function pciCabecalho(linhas) {
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const l = linhas[i]; const casa = PC_CAMPOS.filter(([, , re]) => l.some(c => re.test(c))).length;
    if (casa >= 2) return i;
  }
  return 0;
}
const pciFiltradas = () => !pci ? [] : pci.linhas.slice(pci.cab + 1).filter(l => l.some(c => c) && (!pci.filtro || semAcentoApp(l.join(' ')).includes(semAcentoApp(pci.filtro))));
const pciValor = (l, k) => pci.mapa[k] === '' || pci.mapa[k] == null ? '' : String(l[Number(pci.mapa[k])] ?? '').trim();
VIEWS.importarpecas = () => {
  if (!pcGestor()) return head('Importar planilha', 'Só para o ADM e o supervisor.', btn('← Peças', 'nav', 'pecas', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  const topo = head('Importar planilha de peças', 'Tabela de produtos do fornecedor (Excel ou CSV): código, descrição, marca e aplicação. Preço não entra.', btn('← Peças', 'nav', 'pecas', 'secondary'));
  if (!pci) return topo + `<section class="card panel tmi-escolher"><label class="tmi-arquivo"><input type="file" data-pci-arquivo accept=".xlsx,.csv,.txt"><span class="primary">Escolher planilha</span></label>
    <p class="nota">Peça ao fornecedor a tabela de produtos em Excel (.xlsx) ou CSV. Na próxima tela você diz qual coluna é o código e a descrição, e escolhe só as linhas que interessam (ex.: “filtro”, “7230”). Peça que já está no catálogo (mesmo código e mesma descrição) não é duplicada; o mesmo código com outra descrição entra separado, com aviso para confirmar.</p></section>`;
  const cab = pci.linhas[pci.cab] || [], ncol = Math.max(...pci.linhas.slice(0, 50).map(l => l.length));
  const nomeCol = i => cab[i] ? `${String.fromCharCode(65 + (i % 26))} — ${cab[i]}` : `Coluna ${String.fromCharCode(65 + (i % 26))}`;
  const fl = pciFiltradas(), lim = fl.length > 3000, prev = fl.slice(0, 8);
  const existe = new Set(db.pecas.map(p => pcNorm(p.codigo) + '|' + pcNorm(p.nome))), novos = fl.slice(0, 3000).filter(l => pciValor(l, 'codigo') && !existe.has(pcNorm(pciValor(l, 'codigo')) + '|' + pcNorm(pciValor(l, 'nome')))).length;
  return topo + `<section class="card panel"><p class="nota" style="margin-top:0"><b>${esc(pci.arquivo)}</b>: ${pci.linhas.length - pci.cab - 1} linhas.</p>
    <div class="form pci-mapa">${PC_CAMPOS.map(([k, rot]) => `<div class="field"><label>${esc(rot)}</label><select data-pci-col="${k}"><option value="">— não usar —</option>${Array.from({length: ncol}, (_, i) => `<option value="${i}" ${String(pci.mapa[k]) === String(i) ? 'selected' : ''}>${esc(nomeCol(i))}</option>`).join('')}</select></div>`).join('')}
      <div class="field"><label>Fornecedor</label><select data-pci-forn><option value="">— sem fornecedor —</option>${db.fornecedores.map(f => `<option value="${esc(f.id)}" ${f.id === pci.fornecedorId ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select><button type="button" class="link" data-act="pci-forn-novo">Cadastrar fornecedor novo</button></div>
      <div class="field"><label for="pci_filtro">Só as linhas que contêm</label><input id="pci_filtro" data-pci-filtro value="${esc(pci.filtro || '')}" placeholder="Ex.: filtro, 7230, TeeJet (vazio = todas)"></div></div></section>
    <section class="card panel"><h3 class="pce-tit">Prévia (${fl.length} ${fl.length === 1 ? 'linha' : 'linhas'}${lim ? ' — entram as 3.000 primeiras' : ''})</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Descrição</th><th>Marca</th><th>Aplicação</th></tr></thead><tbody>
      ${prev.map(l => `<tr><td><span class="pc-cod">${esc(pciValor(l, 'codigo'))}</span></td><td>${esc(pciValor(l, 'nome'))}</td><td>${esc(pciValor(l, 'marca'))}</td><td>${esc(pciValor(l, 'aplicacao'))}</td></tr>`).join('') || '<tr><td colspan="4">Nenhuma linha com esse filtro.</td></tr>'}</tbody></table></div>
      <p class="nota">${novos} ${novos === 1 ? 'peça nova' : 'peças novas'} e ${Math.min(fl.length, 3000) - novos} já no catálogo. A aplicação que bater com o modelo de uma máquina da fazenda já fica vinculada.</p>
      <div class="btn-row">${btn('Escolher outra planilha', 'pci-outra', '', 'secondary')}${btn(`Importar ${Math.min(fl.length, 3000)}`, 'pci-importar')}</div></section>`;
};
TITLES.importarpecas = 'Máquinas e manutenção';
document.addEventListener('change', async e => {
  const t = e.target;
  if (t?.matches?.('[data-pci-arquivo]')) {
    const a = t.files?.[0]; if (!a) return;
    try {
      const linhas = /\.xlsx$/i.test(a.name) ? await pcLerXlsx(await a.arrayBuffer()) : pcLerCsv(pcTexto8(await a.arrayBuffer()));
      if (linhas.length < 2) { showToast('A planilha está vazia', true); return; }
      const cab = pciCabecalho(linhas), mapa = {};
      PC_CAMPOS.forEach(([k, , re]) => { const i = (linhas[cab] || []).findIndex((c, j) => re.test(c) && !Object.values(mapa).includes(j)); mapa[k] = i >= 0 ? i : ''; });
      pci = {arquivo: a.name, linhas, cab, mapa, fornecedorId: db.fornecedores.length === 1 ? db.fornecedores[0].id : '', filtro: ''};
      render();
    } catch (err) { console.warn(err); showToast('Não consegui ler esta planilha. Salve como .xlsx ou .csv e tente de novo.', true); }
  } else if (t?.matches?.('[data-pci-col]')) { pci.mapa[t.dataset.pciCol] = t.value; render(); }
  else if (t?.matches?.('[data-pci-forn]')) pci.fornecedorId = t.value;
  else if (t?.matches?.('[data-pci-filtro]')) { pci.filtro = t.value.trim(); render(); }
});
Object.assign(ACTIONS, {
  'pci-outra': () => { pci = null; render(); },
  'pci-forn-novo': () => fornecedorForm({}, f => { if (pci) pci.fornecedorId = f.id; }),
  'pci-importar': () => {
    if (!pci || !pcGestor()) return;
    if (pci.mapa.codigo === '' || pci.mapa.nome === '') { showToast('Diga qual coluna é o código e qual é a descrição', true); return; }
    const linhas = pciFiltradas().slice(0, 3000), mods = pcModelos().filter(g => g.chave.startsWith('mod:') && g.chave.length > 7);
    // Código → peças com esse código (ou equivalente). Mesmo código e mesma descrição = a mesma peça; descrição diferente = outra peça, com aviso
    const porCod = new Map(), por = (k, p) => { if (!k) return; if (!porCod.has(k)) porCod.set(k, []); if (!porCod.get(k).includes(p)) porCod.get(k).push(p); };
    db.pecas.forEach(p => { por(pcNorm(p.codigo), p); (p.equivalentes || []).forEach(e => por(pcNorm(e.codigo), p)); });
    let novas = 0, repetidas = 0;
    linhas.forEach(l => {
      const codigo = pciValor(l, 'codigo').toUpperCase(), nome = pciValor(l, 'nome'); if (!codigo || !nome) return;
      const aplic = pciValor(l, 'aplicacao'), equiv = pciValor(l, 'equivalente').toUpperCase();
      const cands = [...(porCod.get(pcNorm(codigo)) || []), ...(equiv ? porCod.get(pcNorm(equiv)) || [] : [])];
      let p = cands.find(x => pcNorm(x.nome) === pcNorm(nome));
      if (!p) {
        const ap = pcNorm(aplic), modelos = ap ? mods.filter(g => ap.includes(g.chave.slice(4))).map(g => g.chave.slice(4)) : [];
        p = {id: uid(), codigo, nome, marca: pciValor(l, 'marca'), sistema: pcSistemaPeloNome(nome), equivalentes: equiv && pcNorm(equiv) !== pcNorm(codigo) ? [{marca: '', codigo: equiv}] : [], aplica: {modelos, maquinas: []}, aplicacaoTexto: aplic.slice(0, 200), qtd: '', trocaCada: '', trocaUnid: 'h', itemId: '', fornecedores: [], obs: '', criadoEm: new Date().toISOString()};
        const mesmo = porCod.get(pcNorm(codigo)) || [];
        if (mesmo.length) { p.codigoRepetido = true; mesmo.forEach(x => { x.codigoRepetido = true; }); repetidas++; }
        db.pecas.push(p); por(pcNorm(codigo), p); novas++;
      }
      if (pci.fornecedorId) {
        p.fornecedores = p.fornecedores || [];
        const f = p.fornecedores.find(x => x.fornecedorId === pci.fornecedorId);
        if (f) f.codigo = codigo; else p.fornecedores.push({fornecedorId: pci.fornecedorId, codigo});
      }
    });
    save(); pci = null;
    showToast(`${novas} ${novas === 1 ? 'peça nova' : 'peças novas'} no catálogo${repetidas ? ` • ${repetidas} com código igual a outra peça (com aviso)` : ''}`);
    go('pecas');
  }
});

// Abas e acesso
ABAS.maquinas.push(['pecas', 'Peças']); GRUPO_DA_ROTA.pecas = 'maquinas';
if (typeof NV_ROTA_TELA === 'object') Object.assign(NV_ROTA_TELA, {pecas: 'maquinas', peca: 'maquinas', fornecedores: 'maquinas', pedidopecas: 'maquinas', importarpecas: 'maquinas'});
