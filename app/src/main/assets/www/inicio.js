'use strict';
/* MercaPlant — tela inicial para começar o dia: clima do dia (com “Detalhar no MercaClima”) e as operações
   em andamento e programadas. Avisos e pendências (estoque, contas, revisões…) ficam no sino → tela “Avisos”. */

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
  return `<section class="card panel ini-ops" id="iniOps">
    <div class="ini-ops-topo"><div><h3>Operações</h3><small>${esc(resumo || 'Nada em andamento')}</small></div>
      <div class="btn-row">${btn('Ver todas', 'nav', 'operacoes', 'secondary')}${btn('+ Programar', 'op-new')}</div></div>
    ${nada ? empty(semCadastro ? 'Comece pelos cadastros' : 'Nenhuma operação programada', semCadastro ? 'Cadastre talhões e máquinas para programar as operações do dia.' : `Nada em andamento nem programado para os próximos ${INI_PROXIMOS_DIAS} dias.`, semCadastro ? {act: 'nav', id: 'cadastros', label: 'Abrir cadastros'} : {act: 'op-new', label: '+ Programar operação'}) : ''}
    ${grupo('Em andamento', andamento, 'andamento')}
    ${grupo('Atrasadas', atrasadas, 'atrasada')}
    ${grupo('Programadas para hoje', hoje, 'hoje')}
    ${grupo(`Próximos ${INI_PROXIMOS_DIAS} dias`, prox, 'proxima', sobra > 0 ? `<button class="link ini-mais" data-act="nav" data-id="operacoes">+ ${sobra} ${sobra === 1 ? 'programada' : 'programadas'} — ver todas</button>` : '')}
  </section>`;
}

// Quem não usa Operações (ex.: só grãos ou estoque): atalhos para as telas a que tem acesso
function iniAtalhosFuncao() {
  const bts = [...document.querySelectorAll('.sidebar .nav button[data-route]')].filter(b => !b.hidden && b.dataset.route !== 'inicio' && iniPode(b.dataset.route)).slice(0, 8);
  if (!bts.length) return '';
  return `<section class="card panel"><h3>Suas telas</h3><div class="ini-atalhos">${bts.map(b => `<button type="button" class="secondary" data-act="nav" data-id="${esc(b.dataset.route)}">${esc(b.textContent.trim())}</button>`).join('')}</div></section>`;
}

const inicioDepois = VIEWS.inicio.after;
VIEWS.inicio = () => {
  const vazio = COLLECTIONS.every(c => !db[c].length);
  const clima = typeof cartaoClima === 'function' ? cartaoClima() : '';
  return `<div class="ini">${clima}${iniPode('operacoes') && !vazio ? painelOperacoesDia() : vazio ? `<section class="card">${empty('Nenhum dado cadastrado ainda', 'Comece cadastrando talhões, máquinas e insumos.', {act: 'nav', id: 'cadastros', label: 'Abrir cadastros'})}</section>` : iniAtalhosFuncao()}</div>`;
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
