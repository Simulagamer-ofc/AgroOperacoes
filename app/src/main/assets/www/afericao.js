'use strict';
/* Nexus Agro — Catálogo de máquinas e Aferição/Calibragem (usa referencias/avaliador.js, offline). */

// ---------- Dados offline ----------
const DADOS = {};
const ARQ = {regras: 'dados/regras-afericao.json', catalogo: 'dados/catalogo-modelos.json', finame: 'dados/finame.json'};
async function dados(nome) {
  if (!DADOS[nome]) DADOS[nome] = fetch(ARQ[nome]).then(r => { if (!r.ok) throw new Error(ARQ[nome]); return r.json(); });
  return DADOS[nome];
}
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const AV = () => window.NexusAvaliador;

const STATUS_INFO = {
  OK: {rotulo: 'Dentro da referência', cor: 'green'},
  ATENCAO: {rotulo: 'Atenção', cor: 'orange'},
  FORA_DO_PADRAO: {rotulo: 'Fora da referência', cor: 'red'},
  SEM_REFERENCIA: {rotulo: 'Não foi possível avaliar', cor: 'gray'},
  DADOS_INSUFICIENTES: {rotulo: 'Dados insuficientes', cor: 'gray'}
};
const FAMILIA_EQUIP = {
  pulverizador_barra: 'Pulverizador de barras (autopropelido ou tratorizado)',
  semeadora_precisao: 'Semeadora/plantadeira de precisão',
  semeadora_fluxo_continuo: 'Semeadora de fluxo contínuo',
  adubadora_linha: 'Adubadora em linha',
  distribuidor_lanco: 'Distribuidor a lanço',
  colhedora: 'Colhedora',
  outro: 'Outro equipamento'
};
// Só sugere a família quando o catálogo do fabricante é inequívoco.
const FAMILIA_DO_CATALOGO = {pulverizador_autopropelido: 'pulverizador_barra', pulverizador_barra_tratorizado: 'pulverizador_barra', colhedora_graos: 'colhedora'};
const TIPO_MAQUINA_DO_CATALOGO = f => !f ? 'Outro' : f === 'trator' ? 'Trator' : f.startsWith('colhedora') ? 'Colheitadeira' : f.startsWith('pulverizador') ? 'Pulverizador' : f === 'semeadora' ? 'Plantadeira' : 'Implemento';

const TIPOS = {
  bicos: {titulo: 'Vazão de bicos', familias: ['pulverizador_barra'], validada: true, desc: 'Compara a vazão de cada ponta com a tabela do fabricante (Embrapa, ±10%).'},
  taxa: {titulo: 'Taxa de aplicação (L/ha)', familias: ['pulverizador_barra'], desc: 'Calcula L/ha pela vazão, velocidade e espaçamento.'},
  sensor: {titulo: 'Sensor de velocidade / fluxômetro', familias: ['pulverizador_barra'], desc: 'Compara a leitura do controlador com um instrumento de referência.'},
  longitudinal: {titulo: 'Distribuição de sementes na linha', familias: ['semeadora_precisao'], desc: 'Classifica espaçamentos em duplos, aceitáveis e falhos.'},
  dose: {titulo: 'Dose de adubo ou semente (kg/ha)', familias: ['semeadora_precisao', 'semeadora_fluxo_continuo', 'adubadora_linha', 'distribuidor_lanco'], desc: 'Calcula kg/ha pela massa coletada em percurso conhecido.'},
  transversal: {titulo: 'Distribuição a lanço (CV transversal)', familias: ['distribuidor_lanco'], desc: 'Calcula o coeficiente de variação das bandejas.'},
  perdas: {titulo: 'Perdas na colheita', familias: ['colhedora'], validada: true, desc: 'Média de pontos com armação de 2 m² (Embrapa Soja: até 60 kg/ha, só soja).'}
};
const PRODUTOS = [['soja', 'Soja'], ['milho', 'Milho'], ['trigo', 'Trigo'], ['feijao', 'Feijão'], ['arroz', 'Arroz'], ['algodao', 'Algodão'], ['cafe', 'Café'], ['cana', 'Cana-de-açúcar'], ['outro', 'Outro']];

function numeros(txt) {
  const tokens = String(txt || '').trim().split(/[\s;]+/).filter(Boolean);
  const vals = [], erros = [];
  for (const t of tokens) { const v = Number(t.replace(',', '.')); if (Number.isFinite(v)) vals.push(v); else erros.push(t); }
  return {vals, erros};
}
const umNum = v => { if (v === '' || v == null) return undefined; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
const triEstado = v => v === 'sim' ? true : v === 'nao' ? false : undefined;
const statusChip = s => chip(STATUS_INFO[s]?.rotulo || s, STATUS_INFO[s]?.cor || 'gray');

// ---------- Catálogo ----------
let catBusca = '', catMarca = '', catFonte = 'fabricante';
function textoModelo(c, x) { return semAcento([c.marcas[x.m].marca, x.n, x.l, x.c, x.f].join(' ')); }

async function buscarCatalogo(q, marca, fonte, limite = 60) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (fonte === 'finame') {
    const f = await dados('finame');
    const out = [];
    for (const p of f.produtos) {
      const fab = f.fabricantes[p[0]];
      if (marca && !semAcento(fab[1]).includes(semAcento(marca))) continue;
      const t = semAcento(`${fab[1]} ${p[1]} ${p[2]} ${p[3]}`);
      if (termos.every(x => t.includes(x))) { out.push({fonte: 'finame', id: 'finame-' + p[1], marca: fab[1], cnpj: fab[0], uf: fab[2], codigoFiname: p[1], nome: p[2], modelo: p[3]}); if (out.length >= limite) break; }
    }
    return out;
  }
  const c = await dados('catalogo');
  const out = [];
  for (const x of c.modelos) {
    if (marca && c.marcas[x.m].marca !== marca) continue;
    if (termos.every(t => textoModelo(c, x).includes(t))) { out.push({fonte: 'fabricante', id: x.i, marca: c.marcas[x.m].marca, nome: x.n, modelo: x.l || '', familia: x.f, temFicha: !!x.e, temDocs: !!x.d}); if (out.length >= limite) break; }
  }
  return out;
}

async function modeloPorId(id) {
  if (id.startsWith('finame-')) {
    const f = await dados('finame'); const cod = id.slice(7);
    const p = f.produtos.find(p => p[1] === cod); if (!p) return null;
    const fab = f.fabricantes[p[0]];
    return {fonte: 'finame', id, marca: fab[1], cnpj: fab[0], uf: fab[2], codigoFiname: p[1], nome: p[2], modelo: p[3], fonteInfo: f.fonte};
  }
  const c = await dados('catalogo');
  const x = c.modelos.find(m => m.i === id); if (!x) return null;
  return {fonte: 'fabricante', id, marca: c.marcas[x.m].marca, nome: x.n, modelo: x.l || '', familia: x.f, categoria: x.c, url: x.u,
    especificacoes: x.e || [], origem: x.o, documentos: x.d || [], dataConsulta: c.marcas[x.m].dataConsulta};
}

const linhaResultado = r => `<div class="row clickable" data-act="nav" data-id="catalogo/${esc(encodeURIComponent(r.id))}" style="cursor:pointer"><span class="status ${r.fonte === 'finame' ? 'purple' : 'blue'}"></span><div><strong>${esc(r.marca)} — ${esc(r.nome)}</strong><small>${esc([r.modelo, r.codigoFiname ? 'FINAME ' + r.codigoFiname : '', r.temFicha ? 'ficha técnica' : '', r.temDocs ? 'manuais/folhetos' : ''].filter(Boolean).join(' • '))}</small></div>${chip(r.fonte === 'finame' ? 'BNDES' : 'Fabricante', r.fonte === 'finame' ? 'purple' : 'blue')}</div>`;

VIEWS.catalogo = arg => {
  if (arg) { setTimeout(() => detalheCatalogo(decodeURIComponent(arg)), 0); return '<div class="empty">Carregando…</div>'; }
  setTimeout(atualizarCatalogo, 0);
  return head('Catálogo de máquinas e implementos', 'Disponível sem internet. Fontes: sites oficiais dos fabricantes e lista oficial do BNDES/FINAME.') +
    `<div class="filters"><button class="${catFonte === 'fabricante' ? 'active' : ''}" data-act="cat-fonte" data-id="fabricante">Fichas dos fabricantes</button><button class="${catFonte === 'finame' ? 'active' : ''}" data-act="cat-fonte" data-id="finame">Lista oficial BNDES/FINAME</button></div>
     <section class="card panel"><div class="form"><div class="field"><label for="catQ">Buscar (marca, modelo, tipo ou código FINAME)</label><input id="catQ" type="search" value="${esc(catBusca)}" placeholder="Ex.: Imperador 3000, plantadeira 13 linhas, 0123456"></div>
     <div class="field"><label for="catMarca">${catFonte === 'finame' ? 'Fabricante contém' : 'Marca'}</label>${catFonte === 'finame' ? `<input id="catMarca" value="${esc(catMarca)}" placeholder="Ex.: Kuhn">` : '<select id="catMarca"><option value="">Todas</option></select>'}</div></div></section>
     <div class="section-title"><h3 id="catTotal">Resultados</h3></div><section class="card list" id="catLista"><div class="empty">Carregando catálogo…</div></section>`;
};
VIEWS.catalogo.after = () => {
  const q = $('#catQ'), mk = $('#catMarca');
  if (!q) return;
  let t; const disparar = () => { clearTimeout(t); t = setTimeout(() => { catBusca = q.value; catMarca = mk.value; atualizarCatalogo(); }, 200); };
  q.oninput = disparar; mk.oninput = disparar; mk.onchange = disparar;
  if (catFonte === 'fabricante') dados('catalogo').then(c => {
    mk.innerHTML = '<option value="">Todas</option>' + c.marcas.map(m => `<option ${m.marca === catMarca ? 'selected' : ''}>${esc(m.marca)}</option>`).join('');
  }).catch(() => {});
};
async function atualizarCatalogo() {
  const lista = $('#catLista'); if (!lista) return;
  try {
    const res = await buscarCatalogo(catBusca, catMarca, catFonte);
    $('#catTotal').textContent = res.length >= 60 ? 'Primeiros 60 resultados — refine a busca' : `${res.length} resultado(s)`;
    lista.innerHTML = res.length ? res.map(linhaResultado).join('') : empty('Nada encontrado', 'Tente outro termo ou a outra fonte.');
  } catch (e) { lista.innerHTML = empty('Catálogo indisponível', 'Não foi possível carregar os dados offline.'); }
}
async function detalheCatalogo(id) {
  const m = await modeloPorId(id);
  if (!m) { view.innerHTML = empty('Modelo não encontrado', ''); return; }
  const secoes = {};
  (m.especificacoes || []).forEach(([s, c, v]) => (secoes[s || 'Especificações'] ||= []).push([c, v]));
  view.innerHTML = head(`${m.marca} — ${m.nome}`, [m.modelo, m.categoria, m.codigoFiname ? 'Código FINAME ' + m.codigoFiname : ''].filter(Boolean).join(' • '),
    btn('← Catálogo', 'nav', 'catalogo', 'secondary') + btn('Cadastrar como máquina', 'cat-cadastrar', id)) +
    (m.fonte === 'finame'
      ? `<section class="card panel"><h3>Identificação oficial (BNDES/FINAME)</h3><table class="tbl"><tbody>
          <tr><td>Fabricante</td><td>${esc(m.marca)}</td></tr><tr><td>CNPJ</td><td>${esc(m.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'))}</td></tr>
          <tr><td>Produto</td><td>${esc(m.nome)}</td></tr><tr><td>Modelo</td><td>${esc(m.modelo || '—')}</td></tr><tr><td>Código FINAME</td><td>${esc(m.codigoFiname)}</td></tr></tbody></table>
          <p class="nota">Fonte: lista de produtos credenciados do BNDES (fechamento ${fmtDate(m.fonteInfo?.dataFechamentoLista)}). Identificação apenas; não contém especificações técnicas. Nome e modelo podem estar truncados na origem.</p></section>`
      : `${Object.keys(secoes).length ? Object.entries(secoes).map(([s, linhas]) => `<section class="card panel" style="margin-bottom:14px"><h3>${esc(s)}</h3><div class="tbl-wrap"><table class="tbl"><tbody>${linhas.map(([c, v]) => `<tr><td>${esc(c)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')
          : `<section class="card">${empty('Sem ficha técnica em texto', 'O fabricante publica as especificações em folheto, imagem ou manual — veja os documentos abaixo.')}</section>`}
         ${m.documentos.length ? `<section class="card panel"><h3>Manuais e documentos do fabricante</h3>${m.documentos.map(([t, u]) => `<div class="row"><span class="status blue"></span><div><strong>${esc(t)}</strong><small>${esc(u)}</small></div><a class="secondary" href="${esc(u)}" target="_blank" rel="noopener">Abrir</a></div>`).join('')}<p class="nota">Os documentos são abertos no site do fabricante (requer internet).</p></section>` : ''}
         <p class="nota">Dado do fabricante — texto copiado literalmente de <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a> em ${fmtDate(m.dataConsulta)} (${esc(m.origem || 'página do produto')}). Serve para identificação e consulta: para regulagem, confirme no manual do modelo e ano da sua máquina.</p>`);
}

async function vincularMaquina(machineId) {
  const mq = find('machines', machineId);
  dialog.innerHTML = `<h3>Vincular ao catálogo</h3><p class="sub">${esc(mq?.name || '')}</p><div class="filters"><button class="active" data-vf="fabricante">Fabricantes</button><button data-vf="finame">BNDES/FINAME</button></div>
    <div class="field"><input id="vq" type="search" placeholder="Marca e modelo" value="${esc(mq?.model || '')}"></div><div class="list" id="vres" style="padding:0;max-height:50vh;overflow:auto"></div>
    <div class="actions">${mq?.catalogo ? '<button class="danger" id="vdesv">Desvincular</button>' : ''}<button class="secondary" data-close>Fechar</button></div>`;
  modal.classList.add('open');
  let fonte = 'fabricante';
  const atual = async () => {
    const r = await buscarCatalogo($('#vq').value, '', fonte, 30);
    $('#vres').innerHTML = r.length ? r.map(x => `<div class="row clickable" data-pick="${esc(x.id)}" style="cursor:pointer"><span class="status ${x.fonte === 'finame' ? 'purple' : 'blue'}"></span><div><strong>${esc(x.marca)} — ${esc(x.nome)}</strong><small>${esc([x.modelo, x.codigoFiname].filter(Boolean).join(' • '))}</small></div></div>`).join('') : '<div class="empty">Nada encontrado.</div>';
  };
  $('#vq').oninput = atual;
  $$('[data-vf]', dialog).forEach(b => b.onclick = () => { fonte = b.dataset.vf; $$('[data-vf]', dialog).forEach(x => x.classList.toggle('active', x === b)); atual(); });
  $('[data-close]', dialog).onclick = closeModal;
  if ($('#vdesv')) $('#vdesv').onclick = () => { delete mq.catalogo; save(); closeModal(); render(); showToast('Vínculo removido'); };
  $('#vres').onclick = async e => {
    const el = e.target.closest('[data-pick]'); if (!el) return;
    const m = await modeloPorId(el.dataset.pick);
    mq.catalogo = {id: m.id, fonte: m.fonte, marca: m.marca, nome: m.nome, modelo: m.modelo, familia: m.familia || null, codigoFiname: m.codigoFiname || null, vinculadoEm: new Date().toISOString()};
    if (!mq.model) mq.model = `${m.marca} ${m.nome}`;
    save(); closeModal(); render(); showToast('Máquina vinculada ao catálogo');
  };
  atual();
}

Object.assign(ACTIONS, {
  'cat-fonte': id => { catFonte = id; catMarca = ''; render(); },
  'cat-cadastrar': async id => {
    const m = await modeloPorId(id);
    machineForm({name: m.nome, model: `${m.marca} ${m.nome}`.trim(), type: TIPO_MAQUINA_DO_CATALOGO(m.familia),
      catalogo: {id: m.id, fonte: m.fonte, marca: m.marca, nome: m.nome, modelo: m.modelo, familia: m.familia || null, codigoFiname: m.codigoFiname || null, vinculadoEm: new Date().toISOString()}});
  },
  'mc-cat': id => vincularMaquina(id),
  'mc-ficha': id => { const m = find('machines', id); if (m?.catalogo) go('catalogo/' + encodeURIComponent(m.catalogo.id)); }
});

// ---------- Aferição e calibragem ----------
let wz = null;
function criarWizard(machineId, tipo) {
  const mq = machineId ? find('machines', machineId) : null;
  const w = {passo: 1, machineId: machineId || '', familia: FAMILIA_DO_CATALOGO[mq?.catalogo?.familia] || '', tipo: '', produto: '', destino: '',
    data: today(), hora: nowTime(), responsavel: db.settings.owner || '', fieldId: '', instrumento: '', observacoes: ''};
  if (tipo && TIPOS[tipo]) escolherTipo(w, tipo);
  return w;
}
function novoWizard(machineId, tipo) { wz = criarWizard(machineId, tipo); go('afericao/nova'); }
// Ao escolher a avaliação, o tipo de equipamento é definido sozinho quando só existe um possível
function escolherTipo(w, tipo) {
  w.tipo = tipo;
  const fams = TIPOS[tipo].familias;
  if (!fams.includes(w.familia)) w.familia = fams.length === 1 ? fams[0] : '';
}

// Ícone e pergunta de cada avaliação (linguagem do operador)
const TIPO_UI = {
  bicos: {icone: '💧', curto: 'Bicos do pulverizador', para: 'Vazão de cada ponta × tabela do fabricante'},
  taxa: {icone: '🧪', curto: 'Taxa de aplicação', para: 'Quantos L/ha o pulverizador está aplicando'},
  sensor: {icone: '⏱', curto: 'Sensor ou fluxômetro', para: 'Controlador × instrumento de referência'},
  longitudinal: {icone: '🌱', curto: 'Plantio na linha', para: 'Duplos, falhas e espaçamentos aceitáveis'},
  dose: {icone: '⚖', curto: 'Dose de adubo ou semente', para: 'Quantos kg/ha a máquina está soltando'},
  transversal: {icone: '↔', curto: 'Distribuidor a lanço', para: 'Uniformidade nas bandejas (CV)'},
  perdas: {icone: '🌾', curto: 'Perdas na colheita', para: 'kg/ha de grãos perdidos atrás da colhedora'}
};
// Tipo de máquina cadastrado que costuma servir a cada família (para sugerir primeiro)
const TIPO_MAQ_FAMILIA = {pulverizador_barra: ['Pulverizador'], semeadora_precisao: ['Plantadeira'], semeadora_fluxo_continuo: ['Plantadeira'],
  adubadora_linha: ['Plantadeira', 'Implemento'], distribuidor_lanco: ['Implemento'], colhedora: ['Colheitadeira']};
// Listas de medições: rótulo de cada item, quantidade inicial e mínimo recomendado
const LISTAS = {
  vazoes: {item: 'Bico', inicial: 6},
  massasG: {item: 'Ponto', inicial: 5, minimo: 5, nota: 'Mínimo de 5 pontos (Embrapa Soja).'},
  massasPlataformaG: {item: 'Ponto', inicial: 5},
  espacamentos: {item: 'Esp.', inicial: 10, minimo: 50, nota: 'Recomenda-se medir pelo menos 50 espaçamentos.'},
  valoresSobrepostos: {item: 'Bandeja', inicial: 10}
};

const cartaoTipo = (k, ativo, acao = 'af-tipo') => {
  const t = TIPOS[k], u = TIPO_UI[k];
  return `<button class="af-tipo ${ativo ? 'on' : ''}" data-act="${acao}" data-id="${k}" aria-pressed="${!!ativo}"><span class="af-ico" aria-hidden="true">${u.icone}</span>
    <span><strong>${esc(u.curto)}</strong><small>${esc(u.para)}</small>${t.validada ? '<em class="af-val">✓ referência validada</em>' : '<em>calcula; conclui só com referência</em>'}</span></button>`;
};

VIEWS.afericao = arg => {
  if (arg === 'nova') { if (!wz) wz = criarWizard(); return passoWizard(); }
  if (arg) return relatorio(arg);
  const lista = db.afericoes.slice().sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
  return head('Aferição e calibragem', 'Escolha o que vai aferir. O resultado só é concluído com referência técnica validada. Funciona sem internet.') +
    `<section class="af-tipos">${Object.keys(TIPOS).map(k => cartaoTipo(k, false, 'af-nova-tipo')).join('')}</section>` +
    `<div class="section-title"><h3>Registros (${lista.length})</h3></div><section class="card list">${lista.length ? lista.map(a => {
      const p = principal(a.resultado);
      return `<div class="row clickable" data-act="nav" data-id="afericao/${esc(a.id)}" style="cursor:pointer"><span class="status ${STATUS_INFO[a.resultado.status]?.cor === 'gray' ? 'blue' : STATUS_INFO[a.resultado.status]?.cor}"></span><div><strong>${esc(TIPOS[a.tipo]?.titulo || a.tipo)} — ${esc(a.maquina?.name || 'equipamento não cadastrado')}</strong><small>${esc([fmtDate(a.data) + ' ' + a.hora, a.responsavel, p?.regraId ? 'regra ' + p.regraId + ' v' + p.regraVersao : ''].filter(Boolean).join(' • '))}</small></div>${statusChip(a.resultado.status)}</div>`;
    }).join('') : empty('Nenhuma aferição registrada', 'Toque no que você vai aferir, acima, para começar.')}</section>`;
};

const PASSOS = ['O que aferir', 'Medição', 'Resultado'];
const passos = n => `<div class="steps">${PASSOS.map((t, i) => `<span class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
const sel = (k, opts, v, vazio = '—') => `<select data-wz="${k}" id="wz_${k}"><option value="">${vazio}</option>${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
const inp = (k, v, attrs = '') => `<input data-wz="${k}" id="wz_${k}" value="${esc(v ?? '')}" ${attrs}>`;
const num_ = (k, v, attrs = '') => inp(k, v, `inputmode="decimal" enterkeyhint="next" ${attrs}`);
const campo = (k, label, html, hint = '', full = false) => `<div class="field ${full ? 'full' : ''}"><label for="wz_${k}">${esc(label)}</label>${html}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
// Pergunta Sim/Não em botões (o valor gravado continua 'sim' | 'nao' | vazio = não informado)
const pergunta = (k, label, hint = '') => `<div class="field full af-sn"><span class="af-sn-txt">${esc(label)}</span><div class="af-sn-btns" role="group" aria-label="${esc(label)}">
  <button type="button" class="${wz[k] === 'sim' ? 'on sim' : ''}" data-act="af-sn" data-id="${k}|sim" aria-pressed="${wz[k] === 'sim'}">Sim</button><button type="button" class="${wz[k] === 'nao' ? 'on nao' : ''}" data-act="af-sn" data-id="${k}|nao" aria-pressed="${wz[k] === 'nao'}">Não</button></div>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
// Lista de medições: um campo por item; Enter vai para o próximo e cria um novo no fim
function listaMedidas(k, label, unidade, hint = '') {
  const cfg = LISTAS[k], vals = String(wz[k] || '').trim().split(/[\s;]+/).filter(Boolean);
  const inicial = (k === 'vazoes' && typeof qtdBicosConfig === 'function' && qtdBicosConfig(wz)) || cfg.inicial;
  const n = Math.max(vals.length + (vals.length ? 1 : 0), inicial);
  return `<div class="field full af-lista" data-lista="${k}"><label>${esc(label)}${unidade ? ` <span class="af-un">(${esc(unidade)})</span>` : ''}</label>
    <div class="af-lm">${Array.from({length: n}, (_, i) => linhaMedida(k, i, vals[i])).join('')}</div>
    <div class="af-lm-pe"><button type="button" class="secondary" data-act="af-lm-add" data-id="${k}">+ ${esc(cfg.item === 'Esp.' ? 'Espaçamento' : cfg.item)}</button><span class="af-lm-resumo" id="res_${k}"></span></div>
    <details class="af-colar"><summary>Colar vários valores de uma vez</summary><textarea data-lm-colar="${k}" rows="3" inputmode="decimal" placeholder="Ex.: 0,82 0,80 0,79 — separados por espaço, linha ou “;”"></textarea></details>
    ${hint || cfg.nota ? `<span class="hint">${esc([hint, cfg.nota].filter(Boolean).join(' '))}</span>` : ''}</div>`;
}
const linhaMedida = (k, i, v = '') => `<label class="af-lm-item"><span>${esc(LISTAS[k].item)} ${i + 1}</span><input data-lm="${k}" value="${esc(v)}" inputmode="decimal" enterkeyhint="next" autocomplete="off"><b class="af-lm-tag"></b></label>`;
const secao = (titulo, corpo) => corpo ? `<h3 class="af-sec">${esc(titulo)}</h3><div class="form">${corpo}</div>` : '';
const nav = (voltar, avancar = 'Próximo →') => `<div class="actions">${voltar ? '<button class="secondary" data-act="af-voltar">← Voltar</button>' : '<button class="secondary" data-act="af-cancelar">Cancelar</button>'}<button class="primary" data-act="af-avancar">${avancar}</button></div>`;

function passoWizard() {
  const w = wz;
  const topo = head(w.tipo ? `Aferição: ${TIPO_UI[w.tipo].curto.toLowerCase()}` : 'Nova aferição', w.passo === 1 ? 'Escolha o que vai aferir e em qual máquina.' : TIPOS[w.tipo]?.desc || '') + passos(w.passo);
  if (w.passo === 1) {
    const fams = w.tipo ? TIPOS[w.tipo].familias : [];
    const comp = TIPO_MAQ_FAMILIA[w.familia] || fams.flatMap(f => TIPO_MAQ_FAMILIA[f] || []);
    const ord = db.machines.slice().sort((a, b) => comp.includes(b.type) - comp.includes(a.type) || a.name.localeCompare(b.name));
    const maqs = ord.map(m => [m.id, `${m.name}${m.catalogo ? ' — ' + m.catalogo.marca + ' ' + m.catalogo.nome : ''}`]);
    const resumoExtra = [w.data === today() ? 'hoje' : fmtDate(w.data), w.hora, w.responsavel, fieldName(w.fieldId)].filter(Boolean).join(' • ');
    // Escolhida a avaliação, só ela fica à vista (com “Trocar”) e a máquina aparece logo abaixo
    const cartoes = w.tipo ? `<section class="af-tipos um">${cartaoTipo(w.tipo, true, 'af-tipo-trocar')}</section><button class="link af-trocar" data-act="af-tipo-trocar">Trocar avaliação</button>`
      : `<section class="af-tipos">${Object.keys(TIPOS).sort((a, z) => (w.familia ? TIPOS[z].familias.includes(w.familia) - TIPOS[a].familias.includes(w.familia) : 0)).map(k => cartaoTipo(k, false)).join('')}</section>`;
    return topo + cartoes +
      (w.tipo ? `<section class="card panel" style="margin-top:14px"><div class="form">
        ${fams.length > 1 ? `<div class="field full"><label>Equipamento</label><div class="filters af-fam">${fams.map(f => `<button type="button" class="${w.familia === f ? 'active' : ''}" data-act="af-familia" data-id="${f}">${esc(FAMILIA_EQUIP[f])}</button>`).join('')}</div></div>` : ''}
        ${campo('machineId', 'Máquina', sel('machineId', maqs, w.machineId, 'Não cadastrada'), db.machines.length ? 'Fica no histórico da máquina.' : 'Cadastre em Máquinas e Manutenção para manter o histórico.', true)}
        ${w.tipo === 'perdas' ? campo('produto', 'Cultura', sel('produto', PRODUTOS, w.produto, 'Selecione'), 'A referência de perdas depende da cultura.', true) : ''}
        <details class="field full af-extra"><summary>Detalhes do registro <span>${esc(resumoExtra)}</span></summary><div class="form" style="margin-top:10px">
          ${w.tipo !== 'perdas' ? campo('produto', 'Cultura / produto', sel('produto', PRODUTOS, w.produto)) : ''}
          ${campo('fieldId', 'Talhão / local', sel('fieldId', db.fields.map(f => [f.id, f.name]), w.fieldId))}
          ${campo('data', 'Data', inp('data', w.data, 'type="date"'))}${campo('hora', 'Hora', inp('hora', w.hora, 'type="time"'))}
          ${campo('responsavel', 'Responsável', inp('responsavel', w.responsavel), '', true)}
        </div></details>
      </div>${nav(false)}</section>` : `<div class="actions"><button class="secondary" data-act="af-cancelar">Cancelar</button></div>`);
  }
  if (w.passo === 2) {
    const S = {
      bicos: () => [
        pergunta('pressaoColetaIgualCatalogo', 'A coleta foi feita na mesma pressão da tabela do fabricante?') +
        pergunta('mesmoTempoColeta', 'Todos os bicos foram coletados no mesmo tempo e pressão?') +
        pergunta('pontasMesmoModelo', 'As pontas são todas do mesmo modelo?'),
        campo('modeloPonta', 'Modelo da ponta', inp('modeloPonta', w.modeloPonta, 'placeholder="Ex.: XR 110 02"')) +
        campo('pressao', 'Pressão na coleta (bar)', num_('pressao', w.pressao)) +
        campo('corIso', 'Cor da ponta (ISO 10625)', `<select data-wz="corIso" id="wz_corIso"><option value="">—</option></select>`, 'Só identifica a classe de vazão.') +
        campo('vazaoCatalogo', 'Vazão da tabela do fabricante (L/min)', num_('vazaoCatalogo', w.vazaoCatalogo), 'Do catálogo do modelo exato, na pressão da coleta. Não é preenchida pelo sistema.'),
        campo('unidadeVazao', 'Unidade das vazões medidas', sel('unidadeVazao', [['L/min', 'L/min'], ['mL/min', 'mL/min']], w.unidadeVazao || 'L/min', 'L/min'), '', true) +
        listaMedidas('vazoes', 'Vazão medida em cada bico', w.unidadeVazao || 'L/min')],
      perdas: () => [
        pergunta('incluiGraosEmVagens', 'Foram recolhidos os grãos soltos e os de dentro das vagens?'),
        campo('areaM2', 'Área de cada ponto (m²)', num_('areaM2', w.areaM2), 'Armação Embrapa: 4,0 m × 0,5 m = 2,0 m².' + (() => { const L = configDaMaquina(w.machineId).larguraPlataformaM; return L ? ` Com a plataforma de ${num(L, 2)} m (configuração da máquina), uma armação na largura toda precisa de ${num(2 / L, 2)} m de profundidade para dar 2 m².` : ''; })(), true),
        listaMedidas('massasG', 'Grãos coletados atrás da colhedora', 'g por ponto') +
        `<details class="field full af-colar"><summary>Separar perdas da plataforma (opcional)</summary>${listaMedidas('massasPlataformaG', 'Grãos na frente da colhedora', 'g por ponto', 'Permite separar perdas da plataforma e internas.')}</details>`],
      longitudinal: () => ['',
        campo('sementesPorMetro', 'Sementes por metro planejadas', num_('sementesPorMetro', w.sementesPorMetro), 'Define o espaçamento ideal (Xref = 100 ÷ sementes/m).', true) + `<p class="nota field full" id="infoPopulacao"></p>`,
        listaMedidas('espacamentos', 'Espaçamentos medidos entre sementes', 'cm')],
      transversal: () => [
        pergunta('fertilizanteNitrogenado', 'O produto contém nitrogênio?') +
        pergunta('cvComSobreposicao', 'Os valores já consideram a sobreposição das passadas?'), '',
        listaMedidas('valoresSobrepostos', 'Valor de cada bandeja, na ordem', 'massa ou volume')],
      sensor: () => [
        pergunta('comparadoComInstrumentoReferencia', 'A leitura foi comparada com um instrumento de referência (trena + cronômetro, coleta volumétrica…)?'),
        campo('ponto', 'O que foi verificado', sel('ponto', [['sensor_velocidade', 'Sensor de velocidade'], ['fluxometro', 'Fluxômetro']], w.ponto, 'Selecione'), '', true),
        campo('leituraControlador', 'Leitura do controlador', num_('leituraControlador', w.leituraControlador)) +
        campo('referencia', 'Valor do instrumento de referência', num_('referencia', w.referencia), 'Mesma unidade da leitura.')],
      taxa: () => ['',
        campo('espacamentoBicosM', 'Espaçamento entre bicos (m)', num_('espacamentoBicosM', w.espacamentoBicosM)) +
        campo('taxaPlanejada', 'Taxa planejada (L/ha)', num_('taxaPlanejada', w.taxaPlanejada)),
        campo('vazaoMediaBico', 'Vazão média por bico (L/min)', num_('vazaoMediaBico', w.vazaoMediaBico), '', true) +
        campo('velocidadeKmH', 'Velocidade (km/h)', num_('velocidadeKmH', w.velocidadeKmH), 'Ou cronometre abaixo: distância e tempo.', true) +
        campo('distVel', 'Distância cronometrada (m)', num_('distVel', w.distVel)) + campo('tempoVel', 'Tempo (s)', num_('tempoVel', w.tempoVel))],
      dose: () => ['',
        campo('dosePlanejada', 'Dose planejada (kg/ha)', num_('dosePlanejada', w.dosePlanejada), '', true),
        campo('distanciaM', 'Distância percorrida na coleta (m)', num_('distanciaM', w.distanciaM)) +
        (w.familia !== 'distribuidor_lanco' ? campo('linhasColetadas', 'Linhas coletadas', num_('linhasColetadas', w.linhasColetadas), 'Quantas linhas você recolheu.') +
          campo('espLinhasM', 'Espaçamento entre linhas (m)', num_('espLinhasM', w.espLinhasM)) : '') +
        campo('larguraM', 'Largura coletada (m)', num_('larguraM', w.larguraM), w.familia !== 'distribuidor_lanco' ? 'Calculada: linhas coletadas × espaçamento (pode corrigir).' : 'Largura da faixa coletada.', true) +
        campo('massaKg', 'Massa coletada (kg)', num_('massaKg', w.massaKg), '', true)]
    }[w.tipo]();
    return topo + `<section class="card panel">
      ${secao('Antes de medir, confirme', S[0])}${secao('Referência', S[1])}${secao('Medições', S[2])}
      <details class="af-extra" style="margin-top:14px"><summary>Instrumento e observações (opcional)</summary><div class="form" style="margin-top:10px">
        ${campo('instrumento', 'Instrumento usado', inp('instrumento', w.instrumento, 'placeholder="Ex.: proveta 1000 mL, balança digital…"'), '', true)}
        <div class="field full"><label for="wz_observacoes">Observações</label><textarea data-wz="observacoes" id="wz_observacoes" rows="2">${esc(w.observacoes || '')}</textarea></div>
      </div></details>
    ${nav(true, 'Avaliar →')}</section>`;
  }
  const r = w.resultado;
  return topo + `<section class="card panel">${blocoResultado(r, w)}<div class="actions"><button class="secondary" data-act="af-voltar">← Corrigir medições</button><button class="primary" data-act="af-salvar">Salvar registro</button></div></section>`;
}

let limitesBico = null; // limites da regra validada PULV-BICO-CAT-01, lidos do banco (prévia enquanto digita)
VIEWS.afericao.after = () => {
  const maq = $('#wz_machineId');
  if (maq) maq.onchange = () => {
    coletarWizard();
    const sug = FAMILIA_DO_CATALOGO[find('machines', wz.machineId)?.catalogo?.familia];
    if (sug && wz.tipo && TIPOS[wz.tipo].familias.includes(sug)) wz.familia = sug;
    render();
  };
  const cor = $('#wz_corIso');
  if (cor) dados('regras').then(b => {
    const t = b.tabelasReferencia.find(x => x.id === 'ISO10625-CORES');
    cor.innerHTML = '<option value="">—</option>' + t.linhas.map(l => `<option value="${l.tamanho}" ${l.tamanho === wz.corIso ? 'selected' : ''}>${esc(l.cor)} — classe ${num(l.vazao, 2)} L/min a 3 bar</option>`).join('');
  });
  $$('.af-lista').forEach(el => atualizarResumoLista(el.dataset.lista));
  for (const k of Object.keys(wz?._origem || {})) { const el = $('#wz_' + k); if (el && !el.parentElement.querySelector('.cfg-origem')) el.insertAdjacentHTML('afterend', '<small class="cfg-origem fabricante">⚙ da configuração da máquina</small>'); }
  const lin = $('#wz_linhasColetadas'), esp = $('#wz_espLinhasM'), larg = $('#wz_larguraM');
  if (lin && esp && larg) { const calc = () => { const n = umNum(lin.value), e = umNum(esp.value); if (n > 0 && e > 0) larg.value = String(Math.round(n * e * 1000) / 1000).replace('.', ','); }; lin.oninput = calc; esp.oninput = calc; }
  const spm = $('#wz_sementesPorMetro'), info = $('#infoPopulacao');
  if (spm && info) { const e = configDaMaquina(wz.machineId).espacamentoLinhasM; const upd = () => { const v = umNum(spm.value); info.textContent = e && v > 0 ? `Com ${num(e * 100, 0)} cm entre linhas (configuração da máquina): ${num(AV().calculos.populacao(v, e), 0)} sementes/ha.` : ''; }; spm.oninput = upd; upd(); }
  if (wz?.tipo === 'bicos' && !limitesBico) dados('regras').then(b => { const r = b.regras.find(x => x.id === 'PULV-BICO-CAT-01' && x.statusValidacao === 'validada'); limitesBico = r ? [r.limiteMin, r.limiteMax] : false; atualizarResumoLista('vazoes'); });
};
// Prévia enquanto digita: quantidade, média e (bicos) desvio de cada ponta em relação à tabela. O resultado oficial vem do avaliador.
function atualizarResumoLista(k) {
  const box = document.querySelector(`[data-lista="${k}"]`); if (!box) return;
  const ins = $$(`input[data-lm="${k}"]`, box), vals = ins.map(i => umNum(i.value)).filter(v => v !== undefined);
  const media = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const cfg = LISTAS[k];
  $(`#res_${k}`).textContent = vals.length ? `${vals.length} ${vals.length === 1 ? 'valor' : 'valores'}${cfg.minimo && vals.length < cfg.minimo ? ` (recomendado: ${cfg.minimo})` : ''} • média ${num(media, 3)}` : '';
  const cat = umNum($('#wz_vazaoCatalogo')?.value), f = $('#wz_unidadeVazao')?.value === 'mL/min' ? 1 / 1000 : 1;
  ins.forEach(i => {
    const tag = i.parentElement.querySelector('.af-lm-tag'), v = umNum(i.value);
    tag.textContent = ''; tag.className = 'af-lm-tag';
    if (k !== 'vazoes' || v === undefined || !(cat > 0) || !limitesBico) return;
    const d = (v * f - cat) / cat * 100;
    tag.textContent = `${d > 0 ? '+' : ''}${num(d, 1)}%`;
    tag.classList.add(d < limitesBico[0] || d > limitesBico[1] ? 'fora' : 'ok');
  });
}
document.addEventListener('input', e => {
  const k = e.target.dataset?.lm || (e.target.id === 'wz_vazaoCatalogo' || e.target.id === 'wz_unidadeVazao' ? 'vazoes' : null);
  if (k) atualizarResumoLista(k);
});
document.addEventListener('change', e => { if (e.target.id === 'wz_unidadeVazao') atualizarResumoLista('vazoes'); });
document.addEventListener('keydown', e => {
  const k = e.target.dataset?.lm; if (!k || e.key !== 'Enter') return;
  e.preventDefault();
  const ins = $$(`input[data-lm="${k}"]`), i = ins.indexOf(e.target);
  if (i < ins.length - 1) { ins[i + 1].focus(); return; }
  adicionarMedida(k).focus();
});
function adicionarMedida(k) {
  const box = document.querySelector(`[data-lista="${k}"] .af-lm`);
  box.insertAdjacentHTML('beforeend', linhaMedida(k, box.children.length));
  return box.lastElementChild.querySelector('input');
}

function coletarWizard() {
  $$('[data-wz]').forEach(el => { wz[el.dataset.wz] = el.value; });
  // Listas: campos individuais (ou o texto colado, se houver) viram a mesma lista de texto usada pelo cálculo
  $$('[data-lista]').forEach(el => {
    const k = el.dataset.lista, colado = el.querySelector(`[data-lm-colar="${k}"]`)?.value.trim();
    wz[k] = colado || $$(`input[data-lm="${k}"]`, el).map(i => i.value.trim()).filter(Boolean).join(' ');
  });
  const cfg = configDaMaquina(wz.machineId);
  for (const [k, ck] of Object.entries(wz._origem || {})) {
    const v = cfg[ck], atual = typeof v === 'number' ? umNum(wz[k]) : wz[k];
    if (atual !== v) delete wz._origem[k];
  }
}

function validarPasso() {
  const w = wz;
  if (w.passo === 1) {
    if (!w.tipo) return 'Escolha o que vai aferir';
    if (!w.familia || !TIPOS[w.tipo].familias.includes(w.familia)) return 'Escolha o equipamento';
    if (w.tipo === 'perdas' && !w.produto) return 'Informe a cultura (a referência de perdas depende dela)';
  }
  if (w.passo === 2) {
    const lista = {bicos: 'vazoes', perdas: 'massasG', longitudinal: 'espacamentos', transversal: 'valoresSobrepostos'}[w.tipo];
    if (lista) { const n = numeros(w[lista]); if (n.erros.length) return `Valores não numéricos: ${n.erros.slice(0, 3).join(', ')}`; if (!n.vals.length) return 'Informe as medições'; }
    if (w.tipo === 'perdas') { const n = numeros(w.massasPlataformaG); if (n.erros.length) return `Valores não numéricos: ${n.erros.slice(0, 3).join(', ')}`; }
  }
  return '';
}

async function calcular() {
  const w = wz, A = AV(), banco = await dados('regras');
  const v = k => umNum(w[k]), lista = k => numeros(w[k]).vals;
  switch (w.tipo) {
    case 'bicos': {
      const f = w.unidadeVazao === 'mL/min' ? 1 / 1000 : 1;
      return A.avaliarBicos({vazoes: lista('vazoes').map(x => x * f), vazaoCatalogo: v('vazaoCatalogo'), pressaoColetaIgualCatalogo: triEstado(w.pressaoColetaIgualCatalogo),
        mesmoTempoColeta: triEstado(w.mesmoTempoColeta), pontasMesmoModelo: triEstado(w.pontasMesmoModelo)}, banco);
    }
    case 'perdas': return A.avaliarPerdas({massasG: lista('massasG'), massasPlataformaG: lista('massasPlataformaG'), areaM2: v('areaM2'), produto: w.produto || undefined, incluiGraosEmVagens: triEstado(w.incluiGraosEmVagens)}, banco);
    case 'longitudinal': return A.avaliarDistribuicaoLongitudinal({sementesPorMetro: v('sementesPorMetro'), espacamentos: lista('espacamentos')}, banco);
    case 'transversal': return A.avaliarDistribuicaoTransversal({valoresSobrepostos: lista('valoresSobrepostos'), fertilizanteNitrogenado: triEstado(w.fertilizanteNitrogenado), cvComSobreposicao: triEstado(w.cvComSobreposicao)}, banco);
    case 'sensor': return A.avaliarSensor({equipamentoFamilia: w.familia, ponto: w.ponto || undefined, leituraControlador: v('leituraControlador'), referencia: v('referencia'), comparadoComInstrumentoReferencia: triEstado(w.comparadoComInstrumentoReferencia)}, banco);
    case 'taxa': {
      let vel = v('velocidadeKmH');
      if (vel === undefined && v('distVel') > 0 && v('tempoVel') > 0) vel = A.calculos.velocidade(v('distVel'), v('tempoVel'));
      return A.avaliarTaxaAplicacao({vazaoMediaBico: v('vazaoMediaBico'), velocidadeKmH: vel, espacamentoBicosM: v('espacamentoBicosM'), taxaPlanejada: v('taxaPlanejada')}, banco);
    }
    case 'dose': return A.avaliarDose({massaKg: v('massaKg'), distanciaM: v('distanciaM'), larguraM: v('larguraM'), dosePlanejada: v('dosePlanejada'), equipamentoFamilia: w.familia}, banco);
  }
}

// Avaliação principal de um resultado composto (para o resumo e o relatório)
function principal(r) {
  if (!r) return null;
  if (r.avaliacao) return r.avaliacao;
  if (r.bicos) {
    const pior = r.bicos.find(b => b.status === r.status) || r.bicos[0];
    return pior ? pior.avaliacaoCatalogo : null;
  }
  return r.regraId !== undefined ? r : null;
}
const ACAO_SEM_REF = 'Obter uma referência aplicável antes de concluir a avaliação.';

function blocoResultado(r, w) {
  const p = principal(r) || {};
  const info = STATUS_INFO[r.status] || {rotulo: r.status, cor: 'gray'};
  const acao = r.status === 'SEM_REFERENCIA' ? (p.acaoRecomendada || ACAO_SEM_REF) : r.status === 'DADOS_INSUFICIENTES' ? 'Completar os dados indicados nas pendências e avaliar novamente.' : (p.acaoRecomendada || '');
  const calc = [];
  if (r.media != null) calc.push(['Vazão média', `${num(r.media, 3)} L/min`], ['CV entre bicos', `${num(r.cv, 2)}%`]);
  if (r.pttKgHa != null) calc.push(['Perda total (média)', `${num(r.pttKgHa, 1)} kg/ha (${num(r.pttSc60Ha, 2)} sc/ha)`]);
  if (r.ppcKgHa != null) calc.push(['Perda na plataforma', `${num(r.ppcKgHa, 1)} kg/ha`], ['Perdas internas (PMI = PTT − PPC)', `${num(r.pmiKgHa, 1)} kg/ha`]);
  if (r.xrefCm != null) calc.push(['Xref', `${num(r.xrefCm, 2)} cm`], ['Aceitáveis', `${num(r.pctAceitaveis, 1)}% (${r.aceitaveis})`], ['Duplos', `${num(r.pctDuplos, 1)}% (${r.duplos})`], ['Falhos', `${num(r.pctFalhos, 1)}% (${r.falhos})`], ['Espaçamentos medidos', r.n]);
  if (r.cv != null && r.media == null) calc.push(['CV transversal', `${num(r.cv, 2)}%`]);
  if (r.taxaLHa != null) calc.push(['Taxa calculada', `${num(r.taxaLHa, 1)} L/ha`]);
  if (r.vazaoNecessariaBico != null) calc.push(['Vazão por bico para a taxa planejada', `${num(r.vazaoNecessariaBico, 3)} L/min`]);
  if (r.doseKgHa != null) calc.push(['Dose calculada', `${num(r.doseKgHa, 1)} kg/ha`]);
  if (r.desvio != null) calc.push(['Desvio do planejado', `${num(r.desvio, 1)}%`]);
  if (w?.tipo === 'sensor' && p.valorMedido != null) calc.push(['Erro relativo', `${num(p.valorMedido, 2)}%`]);
  const curto = s => ({OK: ['✓ ok', 'green'], ATENCAO: ['! atenção', 'orange'], FORA_DO_PADRAO: ['✗ fora', 'red']}[s] || ['— sem ref.', 'gray']);
  const tabBicos = r.bicos ? `<div class="tbl-wrap"><table class="tbl af-tab-bicos"><thead><tr><th>Bico</th><th class="num">Vazão (L/min)</th><th class="num">× tabela</th><th>Resultado</th></tr></thead><tbody>${r.bicos.map(b => `<tr class="${b.status === 'FORA_DO_PADRAO' ? 'af-linha-fora' : ''}"><td>${b.bico}</td><td class="num">${num(b.vazao, 3)}</td><td class="num">${b.desvioCatalogo != null ? (b.desvioCatalogo > 0 ? '+' : '') + num(b.desvioCatalogo, 1) + '%' : '—'}</td><td>${chip(...curto(b.status))}</td></tr>`).join('')}</tbody></table></div>
    <details class="tecnico"><summary>Comparação com a média da barra (informativa)</summary><p class="nota">Sem referência primária validada; o resultado de cada bico segue a tabela do fabricante.</p><table class="tbl"><tbody>${r.bicos.map(b => `<tr><td>Bico ${b.bico}</td><td class="num">${b.desvioMedia > 0 ? '+' : ''}${num(b.desvioMedia, 1)}%</td></tr>`).join('')}</tbody></table></details>` : '';
  // Para bicos: dizer exatamente quais pontas trocar
  const foraBicos = (r.bicos || []).filter(b => b.status === 'FORA_DO_PADRAO');
  const listaAcao = foraBicos.length ? `<ul class="af-acao">${foraBicos.map(b => `<li><strong>Bico ${b.bico}</strong>: ${num(b.vazao, 3)} L/min (${b.desvioCatalogo > 0 ? '+' : ''}${num(b.desvioCatalogo, 1)}% da tabela)</li>`).join('')}</ul>` : '';
  const relatorioSalvo = !!w?.criadoEm;
  const conferidas = (p.fontes || []).filter(f => f.conferido !== false);
  const fonte = conferidas[0];
  const fonteTxt = conferidas.length ? conferidas.map(f => [f.organizacao, f.titulo].filter(Boolean).join(' — ')).join('; ') : p.fonte;
  const pend = [...new Set(r.pendencias || [])].filter(x => !(r.bicos && x.includes('PULV-BICO-MED-01')));
  const faixa = p.limiteMin != null && p.limiteMax != null ? (p.limiteMin === -p.limiteMax ? `±${num(p.limiteMax, 1)}%` : `${num(p.limiteMin, 1)}% a +${num(p.limiteMax, 1)}%`) : '';
  const okBicos = r.bicos && r.status === 'OK' && faixa ? `<span>Todos os ${r.bicos.length} bicos dentro de ${faixa} da tabela do fabricante.</span>` : '';
  const avisos = w?.criadoEm ? [] : (w?.avisos || []); // no relatório salvo os avisos ficam na seção 6
  const blocoAvisos = avisos.length ? `<div class="af-avisos"><strong>⚠ Avisos da configuração da máquina</strong><ul>${avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul><small>Não mudam o resultado; confira a operação.</small></div>` : '';
  return blocoAvisos + `<div class="resultado ${info.cor}"><small>RESULTADO</small><strong>${esc(info.rotulo)}</strong>${okBicos}<small>AÇÃO RECOMENDADA</small><span>${esc(acao)}</span>${listaAcao}</div>
    ${calc.length ? `<h3 style="margin-top:16px">Valores calculados</h3><table class="tbl"><tbody>${calc.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="num">${esc(String(b))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${tabBicos}
    ${p.regraId ? `<details class="tecnico af-ref" ${relatorioSalvo ? 'open' : ''}><summary>Referência técnica usada: ${esc(p.regraId)} v${esc(p.regraVersao)} (fonte e trecho)</summary><table class="tbl"><tbody><tr><td>Regra</td><td>${esc(p.regraId)} — versão ${esc(p.regraVersao)}</td></tr><tr><td>Limites</td><td>${p.limiteMin != null ? 'mín. ' + num(p.limiteMin, 2) : ''} ${p.limiteMax != null ? 'máx. ' + num(p.limiteMax, 2) : ''} ${esc(p.unidade || '')}</td></tr><tr><td>Fonte</td><td>${esc(fonteTxt)}${fonte?.pagina ? ' — ' + esc(fonte.pagina) : ''}</td></tr>${fonte?.trechoLiteral ? `<tr><td>Trecho</td><td><em>“${esc(fonte.trechoLiteral.slice(0, 400))}${fonte.trechoLiteral.length > 400 ? '…' : ''}”</em></td></tr>` : ''}<tr><td>Condições atendidas</td><td>${esc((p.condicoesAplicadas || []).join(' • ') || '—')}</td></tr></tbody></table></details>` : ''}
    ${pend.length ? `<h3 style="margin-top:16px">Pendências</h3><ul class="pend">${pend.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(p.referenciasCandidatas || []).length && !r.bicos ? `<p class="nota">Referências encontradas, mas não usadas para concluir: ${esc(p.referenciasCandidatas.map(c => `${c.regraId} (${c.motivo})`).join('; '))}</p>` : ''}`;
}

Object.assign(ACTIONS, {
  'af-nova': id => novoWizard(id),
  'af-nova-tipo': tipo => novoWizard('', tipo),
  'af-tipo': tipo => { coletarWizard(); escolherTipo(wz, tipo); render(); },
  'af-tipo-trocar': () => { coletarWizard(); wz.tipo = ''; render(); },
  'af-familia': f => { coletarWizard(); wz.familia = f; render(); },
  'af-sn': arg => { coletarWizard(); const [k, v] = arg.split('|'); wz[k] = wz[k] === v ? '' : v; render(); },
  'af-lm-add': k => adicionarMedida(k).focus(),
  'af-cancelar': () => { wz = null; go('afericao'); },
  'af-voltar': () => { coletarWizard(); wz.passo = Math.max(1, wz.passo - 1); render(); },
  'af-avancar': async () => {
    coletarWizard();
    const erro = validarPasso(); if (erro) { showToast(erro); return; }
    if (wz.passo === 1) aplicarConfigMaquina(wz);
    if (wz.passo === 2) {
      try { wz.resultado = await calcular(); wz.avisos = avisosConfig(wz); } catch (e) { showToast('Não foi possível calcular: ' + e.message); return; }
    }
    wz.passo++; render(); scrollTo(0, 0);
  },
  'af-salvar': () => {
    const w = wz, mq = w.machineId ? find('machines', w.machineId) : null;
    const reg = {id: uid(), data: w.data, hora: w.hora, responsavel: w.responsavel, tipo: w.tipo, familia: w.familia, produto: w.produto, fieldId: w.fieldId,
      maquina: mq ? {id: mq.id, name: mq.name, model: mq.model, hours: mq.hours, catalogo: mq.catalogo || null} : null,
      entradas: Object.fromEntries(Object.entries(w).filter(([k]) => !['passo', 'resultado'].includes(k))),
      resultado: AV().congelar(w.resultado), bancoVersao: w.resultado.avaliacao?.bancoVersao || principal(w.resultado)?.bancoVersao || null,
      criadoEm: new Date().toISOString()};
    db.afericoes.push(reg); save(); wz = null;
    showToast('Aferição registrada'); go('afericao/' + reg.id);
  },
  'af-excluir': id => confirmDialog('Excluir este registro de aferição?', () => { remove('afericoes', id); go('afericao'); }),
  'af-imprimir': () => { if (window.AndroidBridge?.printPage) window.AndroidBridge.printPage(); else window.print(); }
});

const ROTULO_CFG = {espacamentoBicosM: 'Espaçamento entre bicos (m)', modeloPonta: 'Modelo da ponta', espLinhasM: 'Espaçamento entre linhas (m)'};
function relatorio(id) {
  const a = find('afericoes', id);
  if (!a) return empty('Registro não encontrado', '');
  const e = a.entradas || {}, r = a.resultado, p = principal(r) || {};
  const linha = (k, v) => v ? `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>` : '';
  const tri = v => v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : 'Não informado';
  const condicoes = {
    bicos: [['Mesma pressão da tabela do fabricante', tri(e.pressaoColetaIgualCatalogo)], ['Coleta no mesmo tempo e pressão', tri(e.mesmoTempoColeta)], ['Pontas do mesmo modelo', tri(e.pontasMesmoModelo)], ['Modelo da ponta', e.modeloPonta], ['Pressão (bar)', e.pressao], ['Vazão de catálogo (L/min)', e.vazaoCatalogo], ['Vazões medidas (' + (e.unidadeVazao || 'L/min') + ')', e.vazoes]],
    perdas: [['Área amostral (m²)', e.areaM2], ['Grãos em vagens incluídos', tri(e.incluiGraosEmVagens)], ['Massas por ponto (g)', e.massasG], ['Massas na plataforma (g)', e.massasPlataformaG]],
    longitudinal: [['Sementes por metro planejadas', e.sementesPorMetro], ['Espaçamentos (cm)', e.espacamentos]],
    transversal: [['Fertilizante nitrogenado', tri(e.fertilizanteNitrogenado)], ['CV com sobreposição', tri(e.cvComSobreposicao)], ['Bandejas', e.valoresSobrepostos]],
    sensor: [['Ponto verificado', e.ponto], ['Comparado com instrumento de referência', tri(e.comparadoComInstrumentoReferencia)], ['Leitura do controlador', e.leituraControlador], ['Referência', e.referencia]],
    taxa: [['Vazão média por bico (L/min)', e.vazaoMediaBico], ['Velocidade (km/h)', e.velocidadeKmH], ['Distância/tempo', e.distVel && e.tempoVel ? `${e.distVel} m em ${e.tempoVel} s` : ''], ['Espaçamento entre bicos (m)', e.espacamentoBicosM], ['Taxa planejada (L/ha)', e.taxaPlanejada]],
    dose: [['Massa coletada (kg)', e.massaKg], ['Distância (m)', e.distanciaM], ['Largura (m)', e.larguraM], ['Dose planejada (kg/ha)', e.dosePlanejada]]
  }[a.tipo] || [];
  return `<div class="no-print">${head('Relatório de aferição', `${TIPOS[a.tipo]?.titulo || a.tipo} • ${fmtDate(a.data)} ${a.hora}`, btn('← Aferições', 'nav', 'afericao', 'secondary') + btn('Imprimir / PDF', 'af-imprimir', '', 'secondary') + `<button class="danger" data-act="af-excluir" data-id="${esc(a.id)}">Excluir</button>`)}</div>
  <article class="card panel relatorio">
    <header class="rel-head"><div><strong>${esc(db.settings.farm || 'Nexus Agro')}</strong><br><small>Medição e comparação com referência técnica</small></div><small>Registro ${esc(a.id)}</small></header>
    <h3>1. Resultado e ação recomendada</h3>${blocoResultado(r, a)}
    <h3>2. Identificação e rastreabilidade</h3><table class="tbl"><tbody>
      ${linha('Equipamento', a.maquina ? `${a.maquina.name}${a.maquina.model ? ' — ' + a.maquina.model : ''}` : 'Não cadastrado')}
      ${linha('Catálogo', a.maquina?.catalogo ? `${a.maquina.catalogo.marca} ${a.maquina.catalogo.nome}${a.maquina.catalogo.codigoFiname ? ' • FINAME ' + a.maquina.catalogo.codigoFiname : ''}` : '')}
      ${linha('Horímetro no registro', a.maquina?.hours ? num(a.maquina.hours) + ' h' : '')}
      ${linha('Tipo de equipamento', FAMILIA_EQUIP[a.familia])}${linha('Avaliação', TIPOS[a.tipo]?.titulo)}
      ${linha('Cultura / produto', (PRODUTOS.find(x => x[0] === a.produto) || [])[1])}${linha('Talhão / local', fieldName(a.fieldId))}
      ${linha('Data / hora', `${fmtDate(a.data)} ${a.hora}`)}${linha('Responsável', a.responsavel)}${linha('Propriedade', db.settings.farm)}
    </tbody></table>
    <h3>3. Condições da leitura</h3><table class="tbl"><tbody>${condicoes.map(([k, v]) => linha(k, v)).join('')}${linha('Linhas coletadas', e.linhasColetadas)}${linha('Espaçamento entre linhas (m)', e.espLinhasM)}
      ${Object.keys(e._origem || {}).length ? linha('Valores vindos da configuração da máquina', Object.keys(e._origem).map(k => `${ROTULO_CFG[k] || k}: ${e[k]}`).join(' • ')) : ''}</tbody></table>
    <h3>4. Referência e condições de aplicação</h3><table class="tbl"><tbody>${p.regraId ? linha('Regra / versão', `${p.regraId} v${p.regraVersao}`) + linha('Título', p.regraTitulo) + linha('Fonte', p.fonte) + linha('Banco de referências', a.bancoVersao ? 'versão ' + a.bancoVersao : '') + linha('Data da análise', p.dataAnalise ? new Date(p.dataAnalise).toLocaleString('pt-BR') : '') : linha('Referência', 'Nenhuma referência validada aplicável a esta condição.')}</tbody></table>
    <h3>5. Instrumentos e observações</h3><table class="tbl"><tbody>${linha('Instrumento', e.instrumento || 'Não informado')}${linha('Rastreabilidade metrológica do instrumento', 'Não informada')}${linha('Observações', e.observacoes)}</tbody></table>
    <h3>6. Pendências e alcance do documento</h3>
    ${(r.pendencias || []).length ? `<ul class="pend">${[...new Set(r.pendencias)].map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Sem pendências registradas.</p>'}
    ${(e.avisos || []).length ? `<p><strong>Avisos da configuração da máquina</strong> (não alteram o resultado):</p><ul class="pend">${e.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="nota">Este documento registra uma <strong>medição e comparação</strong> com referência técnica operacional. <strong>Não é certificado de calibração, laudo laboratorial nem certificação de conformidade.</strong> O resultado, a regra, a versão e os limites ficaram gravados no momento da análise e não mudam se as referências forem atualizadas.</p>
  </article>`;
}

// ---------- Integração com o restante do app ----------
TITLES.afericao = 'Aferição e calibragem';
TITLES.catalogo = 'Catálogo de máquinas';
const alertasBase = alerts;
alerts = function () {
  const lista = alertasBase();
  const limite = daysAgo(30);
  db.afericoes.filter(a => a.data >= limite && a.resultado?.status === 'FORA_DO_PADRAO').forEach(a => lista.push({color: 'red', icon: '◎', title: `Aferição fora da referência: ${a.maquina?.name || TIPOS[a.tipo]?.titulo}`, text: `${TIPOS[a.tipo]?.titulo} em ${fmtDate(a.data)}.`, route: 'afericao/' + a.id}));
  return lista;
};
// Pré-carrega os dados em segundo plano (ficam no cache do navegador/APK)
setTimeout(() => { dados('regras').catch(() => {}); }, 1500);
