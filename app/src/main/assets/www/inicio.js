'use strict';
/* MercaPlant — tela inicial para começar o dia: clima do dia (com “Detalhar no MercaClima”) e as operações
   em andamento e programadas, pendências urgentes e (fazenda começando) os passos de cadastro. Os demais avisos e pendências (estoque, contas, revisões…) ficam no sino → tela “Avisos”. */

const INI_PROXIMOS_DIAS = 7, INI_MAX_PROXIMAS = 6;
const iniPode = r => typeof nvPodeRota !== 'function' || nvPodeRota(r);
const iniHora = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };
const iniDuracao = iso => {
  const min = iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : NaN; if (!(min >= 0)) return '';
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
};
const iniDia = data => {
  const t = today(); if (data === t) return 'hoje';
  const am = new Date(t + 'T12:00:00'); am.setDate(am.getDate() + 1);
  if (data === isoLocal(am)) return 'amanhã';
  return new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit'}).replace('.', '');
};
// Chuva prevista no dia da operação (pela previsão guardada): “🌧 chuva das 15h até 19h”
function iniChuvaNoDia(data) {
  if (typeof lerClima !== 'function' || typeof horariosChuva !== 'function') return '';
  const f = horariosChuva(lerClima()?.dados, data); if (!f.length) return '';
  return `<span class="chip orange ini-chuva">🌧 chuva ${esc(txtFaixa(f[0]).replace(/,.*$/, ''))}</span>`;
}

function iniLinhaOp(o, tipo) {
  const t = today(), detalhes = [];
  if (tipo === 'andamento') detalhes.push(`desde ${iniHora(o.startedAt) || o.time || '—'}${o.startedAt ? ` (${iniDuracao(o.startedAt)})` : ''}`);
  else if (tipo === 'atrasada') detalhes.push(`era para ${fmtDate(o.date)}${o.time ? ' ' + o.time : ''}`);
  else detalhes.push(`${iniDia(o.date)}${o.time ? ' ' + o.time : ''}`);
  if (o.machineId) detalhes.push(machineName(o.machineId));
  if (o.operator) detalhes.push(o.operator);
  if (Number(o.area) > 0) detalhes.push(`${num(o.area)} ha`);
  const cor = tipo === 'andamento' ? 'green' : tipo === 'atrasada' ? 'red' : 'blue';
  const acao = tipo === 'andamento' ? mini('✓ Concluir', 'op-done', o.id, 'ok') : o.date <= t ? mini('▶ Iniciar', 'op-start', o.id) : '';
  const chuva = tipo !== 'andamento' ? iniChuvaNoDia(o.date < t ? t : o.date) : iniChuvaNoDia(t);
  return `<div class="ini-op"><span class="ini-barra ${cor}" aria-hidden="true"></span>
    <div><strong>${esc(o.type)} — ${esc(opPlace(o))}</strong><small>${esc(detalhes.filter(Boolean).join(' • '))}</small>${chuva}</div>
    <div class="row-actions">${acao}</div></div>`;
}

function painelOperacoesDia() {
  const t = today(), fimJanela = (() => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() + INI_PROXIMOS_DIAS); return isoLocal(d); })();
  const ops = db.operations, porData = (a, b) => String(a.date || '').localeCompare(b.date || '') || String(a.time || '').localeCompare(b.time || '');
  const andamento = ops.filter(o => o.status === 'Em andamento').sort((a, b) => String(a.startedAt || '').localeCompare(b.startedAt || ''));
  const atrasadas = ops.filter(o => o.status === 'Programada' && o.date && o.date < t).sort(porData);
  const hoje = ops.filter(o => o.status === 'Programada' && o.date === t).sort(porData);
  const proximas = ops.filter(o => o.status === 'Programada' && o.date > t && o.date <= fimJanela).sort(porData);
  const concluidasHoje = ops.filter(o => o.status === 'Concluída' && (String(o.finishedAt || '').slice(0, 10) === t || (!o.finishedAt && o.date === t))).length;
  const grupo = (titulo, lista, tipo, extra = '') => lista.length ? `<h4 class="ini-grupo ${tipo}">${titulo} <span>${lista.length}</span></h4>${lista.map(o => iniLinhaOp(o, tipo)).join('')}${extra}` : '';
  const prox = proximas.slice(0, INI_MAX_PROXIMAS), sobra = proximas.length - prox.length;
  const nada = !andamento.length && !atrasadas.length && !hoje.length && !proximas.length;
  const resumo = [andamento.length ? `${andamento.length} em andamento` : '', hoje.length ? `${hoje.length} para hoje` : '', atrasadas.length ? `${atrasadas.length} ${atrasadas.length === 1 ? 'atrasada' : 'atrasadas'}` : '', concluidasHoje ? `${concluidasHoje} ${concluidasHoje === 1 ? 'concluída' : 'concluídas'} hoje` : ''].filter(Boolean).join(' • ');
  const semCadastro = !db.fields.length && !db.machines.length;
  return `<section class="card panel ini-card ini-ops" id="iniOps">
    <div class="ini-ops-topo"><div><h3>Operações</h3><small>${esc(resumo || 'Nada em andamento')}</small></div>
      <div class="btn-row">${btn('Ver todas', 'nav', 'operacoes', 'secondary')}${nada ? '' : btn('+ Programar', 'op-new')}</div></div>
    ${nada ? iniVazio('🚜', 'Nenhuma operação para hoje', semCadastro ? 'Depois de cadastrar talhões e máquinas, programe aqui o trabalho do dia.' : `Nada em andamento nem programado para os próximos ${INI_PROXIMOS_DIAS} dias.`, {act: 'op-new', label: '+ Programar operação'}) : ''}
    ${grupo('Em andamento', andamento, 'andamento')}
    ${grupo('Atrasadas', atrasadas, 'atrasada')}
    ${grupo('Programadas para hoje', hoje, 'hoje')}
    ${grupo(`Próximos ${INI_PROXIMOS_DIAS} dias`, prox, 'proxima', sobra > 0 ? `<button class="link ini-mais" data-act="nav" data-id="operacoes">+ ${sobra} ${sobra === 1 ? 'programada' : 'programadas'} — ver todas</button>` : '')}
  </section>`;
}

// Vazio agradável: ícone, frase curta e uma ação
const iniVazio = (icone, titulo, texto, acao) => `<div class="ini-vazio"><span class="ini-vazio-ic" aria-hidden="true">${icone}</span><strong>${esc(titulo)}</strong><small>${esc(texto)}</small>${acao ? `<button type="button" class="${acao.cls || 'primary'}" data-act="${acao.act}"${acao.id ? ` data-id="${esc(acao.id)}"` : ''}>${esc(acao.label)}</button>` : ''}</div>`;

// Saudação: “Bom dia, Edson” + fazenda e data
function iniSaudacao() {
  const h = new Date().getHours(), oi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const usu = typeof nv !== 'undefined' ? nv?.sessao?.usuario : '', nomeNuvem = usu && nv?.nomes?.[usu];
  const nome = String(nomeNuvem || db.settings.owner || '').trim().split(/\s+/)[0];
  const fazenda = (typeof nv !== 'undefined' && nv?.fazenda?.name) || db.settings.farm || '';
  const data = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'});
  return `<header class="ini-saud"><h2>${esc(oi)}${nome && !nome.includes('@') ? ', ' + esc(nome) : ''}</h2><p>${esc([fazenda, data].filter(Boolean).join(' • '))}</p></header>`;
}

// Pendências urgentes: só o vermelho (e revisão vencida); operação atrasada já aparece em Operações
function iniUrgentes() {
  const lista = (typeof alerts === 'function' ? alerts() : []).filter(a => !/^Operação atrasada/.test(a.title) && (a.color === 'red' || /^Revisão vencida/.test(a.title)));
  const total = typeof alerts === 'function' ? alerts().length : 0;
  const linha = a => `<button type="button" class="ini-urg" data-act="nav" data-id="${esc(a.route || 'avisos')}"><span class="alert-icon ${a.color}" aria-hidden="true">${esc(a.icon || '!')}</span><span><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small></span><span class="hoje-ir" aria-hidden="true">›</span></button>`;
  return `<section class="card panel ini-card ini-urgentes"><div class="ini-ops-topo"><div><h3>Pendências urgentes</h3><small>${lista.length ? `${lista.length} ${lista.length === 1 ? 'precisa' : 'precisam'} de atenção hoje` : 'Nada urgente'}</small></div></div>
    ${lista.length ? lista.slice(0, 4).map(linha).join('') : iniVazio('✓', 'Tudo em dia', 'Nenhuma pendência urgente na fazenda.')}
    ${total ? `<button type="button" class="link ini-mais" data-act="nav" data-id="avisos">Ver todos os avisos (${total}) ›</button>` : ''}</section>`;
}

// Fazenda começando: passos que faltam (somem sozinhos quando cadastrados)
function iniPreparar() {
  const passos = [
    ['fields', 'Talhões', 'Nome, área e cultura — base das operações', 'fd-new', '+ Talhão', 'talhoes'],
    ['machines', 'Máquinas', 'Horímetro, revisões e combustível', 'mc-new', '+ Máquina', 'maquinas'],
    ['stock', 'Estoque de insumos', 'Sementes, adubos e defensivos com o saldo de hoje', 'st-new', '+ Insumo', 'estoque']
  ].filter(p => iniPode(p[5]));
  const feitos = passos.filter(p => db[p[0]].length).length;
  if (!passos.length || feitos === passos.length) return '';
  return `<section class="card panel ini-card ini-preparar"><div class="ini-ops-topo"><div><h3>Prepare a fazenda</h3><small>${feitos} de ${passos.length} prontos</small></div></div>
    <div class="ini-prog"><span style="width:${Math.round(feitos / passos.length * 100)}%"></span></div>
    ${passos.map(([c, tit, txt, act, rot, rota], i) => { const ok = db[c].length > 0; return `<div class="ini-passo ${ok ? 'feito' : ''}"><span class="ini-passo-n" aria-hidden="true">${ok ? '✓' : i + 1}</span><span><strong>${esc(tit)}</strong><small>${ok ? `${db[c].length} ${db[c].length === 1 ? 'cadastrado' : 'cadastrados'}` : esc(txt)}</small></span>${ok ? `<button type="button" class="secondary" data-act="nav" data-id="${rota}">Ver</button>` : `<button type="button" class="primary" data-act="${act}">${esc(rot)}</button>`}</div>`; }).join('')}</section>`;
}

// Quem não usa Operações (ex.: só grãos ou estoque): atalhos para as telas a que tem acesso
function iniAtalhosFuncao() {
  const bts = [...document.querySelectorAll('.sidebar .nav button[data-route]')].filter(b => !b.hidden && b.dataset.route !== 'inicio' && iniPode(b.dataset.route)).slice(0, 8);
  if (!bts.length) return '';
  return `<section class="card panel ini-card ini-ops"><h3>Suas telas</h3><div class="ini-atalhos">${bts.map(b => `<button type="button" class="secondary" data-act="nav" data-id="${esc(b.dataset.route)}">${esc(b.textContent.trim())}</button>`).join('')}</div></section>`;
}

const inicioDepois = VIEWS.inicio.after;
VIEWS.inicio = () => {
  const clima = typeof cartaoClima === 'function' ? cartaoClima() : '';
  const principal = iniPode('operacoes') ? painelOperacoesDia() : iniAtalhosFuncao();
  return `<div class="ini">${iniSaudacao()}<div class="ini-clima">${clima}</div>
    <div class="ini-principal">${principal}</div><aside class="ini-lado">${iniUrgentes()}${iniPreparar()}</aside></div>`;
};
VIEWS.inicio.after = (...a) => inicioDepois?.(...a);

// ---------- Avisos e pendências (o sino): o que antes ficava no “Hoje” da tela inicial ----------
VIEWS.avisos = () => {
  if (typeof painelHoje !== 'function') return head('Avisos', '') + `<section class="card">${empty('Tudo em dia', 'Nenhum aviso.')}</section>`;
  safeStorage.set('agro-hoje-aberto', '1');
  const clima = cartaoClima, resumo = resumoDia;
  cartaoClima = () => ''; resumoDia = () => ''; // só a lista de pendências
  try { return head('Avisos e pendências', 'Estoque, contas, revisões, aferições, chuva para registrar e o que mais precisa de atenção', btn('← Início', 'nav', 'inicio', 'secondary')) + painelHoje(); }
  finally { cartaoClima = clima; resumoDia = resumo; }
};
TITLES.avisos = 'Avisos e pendências';
$('#bellBtn').onclick = () => go('avisos');
