'use strict';
/* Nexus Agro — Inspeção periódica do pulverizador de barras (critérios da ISO 16122-2).
   Feita por exceção: cada grupo é marcado como conforme com um toque; só o que tem problema é detalhado.
   O manômetro é aferido contra um manômetro padrão e os bicos vêm da aferição de bicos já registrada.
   Critérios conforme o "Manual of inspection of sprayers — ISO 16122" (UPC / Unidade de Mecanização Agrária). Offline. */

const INSP_FONTE = 'ISO 16122-2 (pulverizadores de barras), conforme o Manual de Inspeção de Pulverizadores — ISO 16122 (UPC, Unidade de Mecanização Agrária)';
const INSP_GRUPOS = [
  {id: 'seguranca', titulo: 'Segurança e transmissão', ref: '4.3', itens: ['Cardã com proteção completa e em bom estado', 'Partes móveis protegidas', 'Estrutura e chassi sem trincas ou soldas soltas', 'Mangueiras hidráulicas sem vazamento', 'Partes dobráveis com trava funcionando']},
  {id: 'vazamentos', titulo: 'Vazamentos e gotejamento', ref: '5.1 e 5.9.2', itens: ['Sem vazamento com a máquina parada e o tanque cheio', 'Sem vazamento com a bomba ligada (seções fechadas e pulverizando)', 'Bicos não gotejam 5 s depois de fechar a pulverização']},
  {id: 'bomba', titulo: 'Bomba', ref: '5.2', itens: ['Vazão da bomba de pelo menos 90% da nominal', 'Sem pulsação visível no manômetro (até 10%)', 'Câmara de ar com 30% a 70% da pressão de trabalho'], bomba: true},
  {id: 'agitacao', titulo: 'Agitação da calda', ref: '5.3', itens: ['Agitação visível com o tanque pela metade, na pressão máxima de trabalho']},
  {id: 'tanque', titulo: 'Tanque', ref: '5.4', itens: ['Tampa vedando', 'Peneira de abastecimento presente e inteira', 'Indicador de nível legível', 'Esvaziamento completo e registro funcionando']},
  {id: 'manometro', titulo: 'Manômetro e controles', ref: '5.5', itens: ['Manômetro presente e legível (mostrador de 63 mm ou mais)', 'Escala com divisões de até 0,2 bar abaixo de 5 bar', 'Regulador mantém a pressão (±10%)', 'Fluxômetro e sensor de velocidade dentro de ±5%'], manometro: true},
  {id: 'mangueiras', titulo: 'Mangueiras e tubulações', ref: '5.6', itens: ['Sem dobras, rachaduras ou desgaste', 'Sem vazamento nas conexões']},
  {id: 'filtros', titulo: 'Filtros', ref: '5.7', itens: ['Filtros de sucção, de linha e dos bicos presentes', 'Filtros limpos e inteiros', 'Malha compatível com o tamanho das pontas']},
  {id: 'barra', titulo: 'Barra', ref: '5.8', itens: ['Espaçamento entre bicos uniforme (±5%)', 'Bicos na vertical (até 10°)', 'Altura uniforme ao longo da barra (variação até 10 cm)', 'Barra estável e alinhada, sem empeno (±2,5% da largura)', 'Proteção contra impacto nas pontas da barra (barras de 10 m ou mais)', 'Queda de pressão de até 10% do início ao fim de cada seção']},
  {id: 'bicos', titulo: 'Bicos e pontas', ref: '5.9.3', itens: ['Pontas do mesmo modelo e tamanho na barra', 'Vazão de cada ponta dentro de ±10% da nominal (±15% abaixo de 1 L/min)'], bicos: true}
];
const INSP_ST = {ok: ['Conforme', 'green'], nao: ['Não conforme', 'red'], na: ['Não se aplica', 'gray']};
// Quem faz a inspeção: funções técnicas e de gestão (sem conta na nuvem, todos)
const podeInspecionar = () => typeof nvPapel !== 'function' || !nvPapel() || ['admin', 'supervisor'].includes(nvPapel()) || ['diretor', 'gerente', 'agronomo', 'oficina'].includes(nv?.funcao);

// ---------- Aferição do manômetro (5.5.2.3): ±0,2 bar até 2 bar; ±10% da leitura acima de 2 bar ----------
function avaliarManometro(pontos) {
  const ps = (pontos || []).map(p => ({padrao: umNum(p.padrao), leitura: umNum(p.leitura)})).filter(p => p.padrao > 0 && p.leitura >= 0);
  const linhas = ps.map(p => {
    const erro = p.leitura - p.padrao, tol = p.padrao <= 2 ? 0.2 : p.padrao * 0.1;
    return {...p, erro, tol, ok: Math.abs(erro) <= tol + 1e-9};
  });
  return {linhas, completo: linhas.length >= 4, ok: linhas.length >= 4 && linhas.every(l => l.ok)};
}
// Bicos: a aferição de bicos mais recente desta máquina (até 30 dias antes da inspeção)
function aferBicosParaInspecao(machineId, data) {
  const desde = addDias(data || today(), -30);
  return db.afericoes.filter(a => a.tipo === 'bicos' && a.maquina?.id === machineId && a.data >= desde && a.data <= (data || today()))
    .sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))[0] || null;
}
// Situação final de cada grupo (os automáticos — manômetro e bicos — entram no resultado)
function situacaoGrupos(ins) {
  const out = {};
  for (const g of INSP_GRUPOS) {
    const r = ins.grupos?.[g.id] || {};
    let st = r.st || '', falhas = (r.falhas || []).map(i => g.itens[i]).filter(Boolean), auto = '';
    if (g.manometro && st !== 'na') {
      const m = avaliarManometro(ins.manometro);
      if (m.linhas.length && !m.completo) auto = 'Afira o manômetro em pelo menos 4 pontos';
      if (m.completo && !m.ok) { st = 'nao'; falhas = [...falhas, 'Aferição do manômetro fora da tolerância (±0,2 bar até 2 bar; ±10% acima)']; }
      if (!m.completo && st === 'ok') { st = ''; auto = 'Para marcar conforme, afira o manômetro em pelo menos 4 pontos'; }
    }
    if (g.bomba && st !== 'na') {
      const n = umNum(ins.bomba?.nominal), q = umNum(ins.bomba?.medida);
      if (n > 0 && q >= 0 && q < 0.9 * n) { st = 'nao'; falhas = [...falhas, `Vazão da bomba ${num(q, 1)} L/min = ${num(q / n * 100, 0)}% da nominal (mínimo 90%)`]; }
    }
    if (g.bicos && st !== 'na') {
      const a = aferBicosParaInspecao(ins.machineId, ins.data);
      if (!a) { if (st === 'ok') st = ''; auto = 'Registre a aferição de bicos (até 30 dias antes) para concluir este grupo'; }
      else if (a.resultado?.status === 'OK') { if (!st) st = 'ok'; }
      else if (a.resultado?.status === 'FORA_DO_PADRAO') { st = 'nao'; const n = (a.resultado.bicos || []).filter(b => b.status === 'FORA_DO_PADRAO').map(b => b.bico); falhas = [...falhas, `Aferição de bicos de ${fmtDate(a.data)}: ${n.length ? 'bicos ' + IA()?.listaBicos(n) + ' fora' : 'fora da referência'}`]; }
      else { if (st === 'ok') st = ''; auto = 'A última aferição de bicos não foi conclusiva: refaça-a para concluir este grupo'; }
    }
    out[g.id] = {st, falhas: [...new Set(falhas)], obs: r.obs || '', auto};
  }
  return out;
}
function resultadoInspecao(ins) {
  const g = situacaoGrupos(ins), faltam = INSP_GRUPOS.filter(x => !g[x.id].st);
  const nao = INSP_GRUPOS.filter(x => g[x.id].st === 'nao');
  return {status: faltam.length ? 'INCOMPLETA' : nao.length ? 'FORA_DO_PADRAO' : 'OK', grupos: g, faltam: faltam.map(x => x.titulo),
    naoConformes: nao.flatMap(x => g[x.id].falhas.length ? g[x.id].falhas.map(f => `${x.titulo}: ${f}`) : [`${x.titulo}: não conforme`])};
}

// ---------- Tela da inspeção ----------
let insp = null;
function novaInspecao(machineId) {
  if (insp && (!machineId || insp.machineId === machineId)) { go('afericao/inspecao'); return; } // continua a que estava aberta
  const m = machineId ? find('machines', machineId) : null;
  insp = {id: uid(), machineId: m?.id || '', data: today(), hora: nowTime(), responsavel: db.settings.owner || '', registro: '', padrao: '', validadeMeses: '12', grupos: {}, manometro: [{}, {}, {}, {}], bomba: {}, observacoes: ''};
  go('afericao/inspecao');
}
function coletarInspecao() {
  if (!insp) return;
  $$('[data-insp]').forEach(el => {
    const [a, b, c] = el.dataset.insp.split('.');
    if (c != null) { insp[a][b] ||= {}; insp[a][b][c] = el.value; }
    else if (b != null) { insp[a] ||= {}; insp[a][b] = el.value; }
    else insp[a] = el.value;
  });
  $$('[data-insp-falha]').forEach(el => {
    const [g, i] = el.dataset.inspFalha.split('|'); const r = (insp.grupos[g] ||= {});
    const s = new Set(r.falhas || []); el.checked ? s.add(Number(i)) : s.delete(Number(i)); r.falhas = [...s].sort((x, y) => x - y);
  });
}
function viewInspecao() {
  if (!insp) novaInspecao();
  if (!podeInspecionar()) return head('Inspeção periódica', '') + `<section class="card">${empty('Só para funções técnicas', 'A inspeção periódica é feita pelo agrônomo, chefe de oficina, supervisor ou ADM.', {act: 'nav', id: 'afericao', label: 'Voltar'})}</section>`;
  const ins = insp, res = resultadoInspecao(ins), g = res.grupos;
  const pulvs = db.machines.filter(m => !isInactive(m)).sort((a, b) => (b.type === 'Pulverizador') - (a.type === 'Pulverizador') || a.name.localeCompare(b.name));
  const feitos = INSP_GRUPOS.length - res.faltam.length;
  const campoI = (k, label, v, attrs = '', full = false) => `<div class="field ${full ? 'full' : ''}"><label for="in_${k.replace(/\./g, '_')}">${esc(label)}</label><input id="in_${k.replace(/\./g, '_')}" data-insp="${k}" value="${esc(v ?? '')}" ${attrs}></div>`;
  const cartao = gr => {
    const s = g[gr.id], r = ins.grupos[gr.id] || {}, aberto = s.st === 'nao' || r.st === 'nao' || (!s.st && (gr.manometro || gr.bomba || gr.bicos));
    const extra = gr.manometro ? blocoManometro(ins) : gr.bomba ? `<div class="form insp-num">${campoI('bomba.nominal', 'Vazão nominal da bomba (L/min, opcional)', ins.bomba?.nominal, 'inputmode="decimal"')}${campoI('bomba.medida', 'Vazão medida na saída livre (L/min)', ins.bomba?.medida, 'inputmode="decimal"')}</div>`
      : gr.bicos ? blocoBicosInsp(ins) : '';
    return `<article class="insp-grupo ${s.st || 'pendente'}" id="ig_${gr.id}"><header><div><strong>${esc(gr.titulo)}</strong><small>ISO 16122-2, item ${esc(gr.ref)}</small></div>${s.st ? chip(INSP_ST[s.st][0], INSP_ST[s.st][1]) : chip('A verificar', 'orange')}</header>
      ${s.st === 'ok' && !aberto ? '' : `<ul class="insp-itens">${gr.itens.map((t, i) => `<li>${r.st === 'nao' ? `<label><input type="checkbox" data-insp-falha="${gr.id}|${i}" ${(r.falhas || []).includes(i) ? 'checked' : ''}> ${esc(t)}</label>` : esc(t)}</li>`).join('')}</ul>`}
      ${aberto ? extra : ''}
      ${s.auto ? `<p class="nota insp-auto">${esc(s.auto)}</p>` : ''}
      ${r.st === 'nao' ? `<textarea data-insp="grupos.${gr.id}.obs" rows="2" placeholder="O que foi encontrado (opcional)">${esc(r.obs || '')}</textarea>` : ''}
      <div class="insp-bts" role="group" aria-label="${esc(gr.titulo)}">${Object.entries(INSP_ST).map(([k, [t]]) => `<button type="button" class="${r.st === k ? 'on ' + k : ''}" data-act="insp-st" data-id="${gr.id}|${k}" aria-pressed="${r.st === k}">${k === 'ok' ? '✓ ' : k === 'nao' ? '✗ ' : ''}${t}</button>`).join('')}</div></article>`;
  };
  return head('Inspeção periódica do pulverizador', `Critérios da ISO 16122-2. Marque cada grupo; detalhe só o que tiver problema.`, btn('Cancelar', 'insp-cancelar', '', 'secondary')) +
    `<section class="card panel"><div class="form">
      <div class="field full"><label for="in_machineId">Pulverizador</label><select id="in_machineId" data-insp="machineId"><option value="">Selecione</option>${pulvs.map(m => `<option value="${esc(m.id)}" ${m.id === ins.machineId ? 'selected' : ''}>${esc(m.name)}${m.type ? ' — ' + esc(m.type) : ''}</option>`).join('')}</select></div>
      ${campoI('data', 'Data', ins.data, 'type="date"')}${campoI('responsavel', 'Responsável técnico', ins.responsavel)}
      ${campoI('registro', 'Registro profissional (CREA/CFTA, opcional)', ins.registro)}${campoI('padrao', 'Manômetro padrão usado (identificação e data da aferição)', ins.padrao, 'placeholder="Ex.: MP-01, aferido em 03/2026"')}
      <div class="field"><label for="in_validade">Próxima inspeção em</label><select id="in_validade" data-insp="validadeMeses">${[['12', '12 meses (recomendado)'], ['24', '24 meses'], ['36', '36 meses (regra europeia)']].map(([v, t]) => `<option value="${v}" ${String(ins.validadeMeses) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    </div></section>
    <div class="insp-progresso"><span>${feitos} de ${INSP_GRUPOS.length} grupos verificados</span><b style="width:${Math.round(feitos / INSP_GRUPOS.length * 100)}%"></b></div>
    <section class="insp-lista">${INSP_GRUPOS.map(cartao).join('')}</section>
    <section class="card panel"><div class="field full"><label for="in_obs">Observações gerais</label><textarea id="in_obs" data-insp="observacoes" rows="2">${esc(ins.observacoes || '')}</textarea></div>
      ${typeof campoFotos === 'function' ? `<div class="form">${campoFotos('afericoes', ins.id || (ins.id = uid()))}</div>` : ''}
      ${blocoResultadoInspecao(res, ins)}
      <div class="actions"><button class="secondary" data-act="insp-cancelar">Cancelar</button><button class="primary" data-act="insp-salvar" ${res.status === 'INCOMPLETA' || !ins.machineId ? 'disabled' : ''}>Salvar inspeção</button></div></section>`;
}
function blocoManometro(ins) {
  const m = avaliarManometro(ins.manometro), pts = ins.manometro || [{}, {}, {}, {}];
  const linha = (p, i) => { const l = m.linhas.find(x => String(x.padrao) === String(umNum(p.padrao)) && String(x.leitura) === String(umNum(p.leitura))); return `<tr><td>${i + 1}</td><td><input data-insp="manometro.${i}.padrao" inputmode="decimal" value="${esc(p.padrao || '')}" aria-label="Padrão, ponto ${i + 1}"></td><td><input data-insp="manometro.${i}.leitura" inputmode="decimal" value="${esc(p.leitura || '')}" aria-label="Manômetro do pulverizador, ponto ${i + 1}"></td><td class="num">${l ? `${l.erro > 0 ? '+' : ''}${num(l.erro, 2)} bar ${chip(l.ok ? 'ok' : 'fora', l.ok ? 'green' : 'red')}` : '—'}</td></tr>`; };
  return `<div class="insp-mano"><p class="nota">Aferição do manômetro: compare com o manômetro padrão em pelo menos 4 pressões (subindo e descendo). Tolerância: ±0,2 bar até 2 bar; ±10% da leitura acima de 2 bar.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Padrão (bar)</th><th>Pulverizador (bar)</th><th class="num">Erro</th></tr></thead><tbody>${pts.map(linha).join('')}</tbody></table></div>
    <button type="button" class="link" data-act="insp-mano-add">+ ponto</button></div>`;
}
function blocoBicosInsp(ins) {
  if (!ins.machineId) return '<p class="nota">Escolha o pulverizador acima.</p>';
  const a = aferBicosParaInspecao(ins.machineId, ins.data);
  if (!a) return `<p class="nota">Nenhuma aferição de bicos deste pulverizador nos 30 dias anteriores.</p><div class="btn-row">${btn('Aferir os bicos agora', 'insp-bicos', '', 'secondary')}</div>`;
  return `<p class="nota">Usando a aferição de bicos de ${fmtDate(a.data)} ${esc(a.hora)}: ${statusChip(a.resultado.status)} <a href="#/afericao/${esc(a.id)}">ver relatório</a></p>`;
}
function blocoResultadoInspecao(res, ins) {
  if (res.status === 'INCOMPLETA') return `<div class="resultado gray"><small>RESULTADO</small><strong>Inspeção incompleta</strong><span>Falta verificar: ${esc(res.faltam.join(', '))}.</span></div>`;
  const ok = res.status === 'OK';
  return `<div class="resultado ${ok ? 'green' : 'red'}"><small>RESULTADO</small><strong>${ok ? 'Aprovado' : 'Reprovado'}</strong>
    <span>${ok ? `Pulverizador conforme em todos os grupos verificados. Próxima inspeção: ${fmtDate(validadeInspecao(ins.data, ins.validadeMeses))}.` : 'Corrija os itens abaixo e faça nova inspeção:'}</span>
    ${ok ? '' : `<ul class="af-acao">${res.naoConformes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}</div>`;
}
// Validade: addMeses (financeiro.js) — mesmo dia, n meses depois
const validadeInspecao = (iso, n) => addMeses(iso || today(), Number(n) || 12);

// ---------- Relatório ----------
function relatorioInspecao(a) {
  const e = a.entradas || {}, r = a.resultado, g = r.grupos || {}, m = avaliarManometro(e.manometro);
  const linha = (k, v) => v ? `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>` : '';
  const ok = r.status === 'OK';
  return `<div class="no-print">${head('Relatório de inspeção periódica', `${fmtDate(a.data)} ${a.hora}`, btn('← Aferições', 'nav', 'afericao', 'secondary') + btn('Imprimir / PDF', 'af-imprimir', '', 'secondary') + `<button class="danger" data-act="af-excluir" data-id="${esc(a.id)}">Excluir</button>`)}</div>
  <article class="card panel relatorio">
    <header class="rel-head"><div><strong>${esc((a.propriedade ?? db.settings.farm) || 'Nexus Agro')}</strong><br><small>Inspeção periódica de pulverizador de barras — critérios ISO 16122-2</small></div><small>Registro ${esc(a.id)}</small></header>
    <h3>1. Resultado</h3><div class="resultado ${ok ? 'green' : 'red'}"><small>RESULTADO</small><strong>${ok ? 'Aprovado' : 'Reprovado'}</strong><span>${ok ? `Válido até ${fmtDate(r.validade)}.` : 'Itens não conformes:'}</span>${ok ? '' : `<ul class="af-acao">${(r.naoConformes || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}</div>
    <h3>2. Identificação</h3><table class="tbl"><tbody>${linha('Pulverizador', a.maquina ? `${a.maquina.name}${a.maquina.model ? ' — ' + a.maquina.model : ''}` : '')}${linha('Horímetro', a.maquina?.hours ? num(a.maquina.hours) + ' h' : '')}${linha('Data / hora', `${fmtDate(a.data)} ${a.hora}`)}${linha('Propriedade', a.propriedade)}${linha('Próxima inspeção', fmtDate(r.validade))}</tbody></table>
    <h3>3. Grupos verificados</h3><table class="tbl"><thead><tr><th>Grupo</th><th>Item ISO</th><th>Situação</th><th>Observações</th></tr></thead><tbody>${INSP_GRUPOS.map(gr => { const s = g[gr.id] || {}; return `<tr><td>${esc(gr.titulo)}</td><td>${esc(gr.ref)}</td><td>${s.st ? chip(INSP_ST[s.st][0], INSP_ST[s.st][1]) : '—'}</td><td>${esc([...(s.falhas || []), s.obs].filter(Boolean).join('; '))}</td></tr>`; }).join('')}</tbody></table>
    <h3>4. Aferição do manômetro</h3>${m.linhas.length ? `<table class="tbl"><thead><tr><th>Padrão (bar)</th><th>Pulverizador (bar)</th><th>Erro</th><th>Tolerância</th><th></th></tr></thead><tbody>${m.linhas.map(l => `<tr><td>${num(l.padrao, 2)}</td><td>${num(l.leitura, 2)}</td><td>${l.erro > 0 ? '+' : ''}${num(l.erro, 2)} bar</td><td>±${num(l.tol, 2)} bar</td><td>${chip(l.ok ? 'ok' : 'fora', l.ok ? 'green' : 'red')}</td></tr>`).join('')}</tbody></table>` : '<p>Não aferido (grupo marcado como não se aplica).</p>'}
    ${e.bomba?.medida ? `<h3>5. Bomba</h3><table class="tbl"><tbody>${linha('Vazão nominal (L/min)', e.bomba.nominal)}${linha('Vazão medida (L/min)', e.bomba.medida)}${linha('Relação', umNum(e.bomba.nominal) > 0 ? num(umNum(e.bomba.medida) / umNum(e.bomba.nominal) * 100, 0) + '% (mínimo 90%)' : '')}</tbody></table>` : ''}
    <h3>${e.bomba?.medida ? 6 : 5}. Responsável e instrumentos</h3><table class="tbl"><tbody>${linha('Responsável técnico', e.responsavel)}${linha('Registro profissional', e.registro)}${linha('Manômetro padrão', e.padrao)}${linha('Aferição de bicos usada', r.aferBicos ? `${fmtDate(r.aferBicos.data)} — registro ${r.aferBicos.id}` : '')}${linha('Observações', e.observacoes)}</tbody></table>
    ${typeof galeriaFotos === 'function' && a.fotos?.length ? `<h3>Fotos</h3>${galeriaFotos('afericoes', a)}` : ''}
    <div class="insp-assinatura"><span>_______________________________________</span><small>${esc(e.responsavel || 'Responsável técnico')}${e.registro ? ' — ' + esc(e.registro) : ''}</small></div>
    <p class="nota">Inspeção baseada nos critérios da ${esc(INSP_FONTE)}. Registra a verificação feita na propriedade; <strong>não substitui inspeção por organismo acreditado</strong> quando exigida.</p>
  </article>`;
}

// ---------- Integração ----------
const cartaoInspecao = () => podeInspecionar() ? `<section class="card panel insp-cartao"><div><strong>Inspeção periódica do pulverizador</strong><small>Checklist completo pela ISO 16122-2, com aferição do manômetro e relatório assinado. Uma vez por ano.</small></div>${btn(insp ? 'Continuar inspeção' : 'Iniciar inspeção', 'insp-nova', '', 'secondary')}</section>` : '';
const afericaoSemInspecao = VIEWS.afericao;
VIEWS.afericao = arg => {
  if (arg === 'inspecao') return viewInspecao();
  const a = arg && arg !== 'nova' ? find('afericoes', arg) : null;
  if (a?.tipo === 'inspecao') return relatorioInspecao(a);
  return afericaoSemInspecao(arg);
};
VIEWS.afericao.after = arg => {
  if (parseRoute().arg === 'inspecao') { const s = $('#in_machineId'), d = $('#in_data'); [s, d].forEach(el => { if (el) el.onchange = () => { coletarInspecao(); render(); }; }); return; }
  afericaoSemInspecao.after?.(arg);
};
// Enquanto digita: guarda os valores e atualiza o erro de cada ponto do manômetro sem redesenhar a tela (não perde o foco)
document.addEventListener('input', e => {
  if (!insp || !e.target.dataset?.insp) return;
  coletarInspecao();
  const box = e.target.closest?.('.insp-mano'); if (!box) return;
  $$('tbody tr', box).forEach((tr, i) => {
    const p = insp.manometro[i] || {}, l = avaliarManometro([p]).linhas[0], td = tr.lastElementChild;
    td.innerHTML = l ? `${l.erro > 0 ? '+' : ''}${num(l.erro, 2)} bar ${chip(l.ok ? 'ok' : 'fora', l.ok ? 'green' : 'red')}` : '—';
  });
});
document.addEventListener('change', e => { if (insp && e.target.dataset?.inspFalha) coletarInspecao(); });
Object.assign(ACTIONS, {
  'insp-nova': id => novaInspecao(id),
  'insp-st': arg => { coletarInspecao(); const [g, st] = arg.split('|'); const r = (insp.grupos[g] ||= {}); r.st = r.st === st ? '' : st; if (st !== 'nao') { r.falhas = []; } render(); },
  'insp-mano-add': () => { coletarInspecao(); insp.manometro.push({}); render(); },
  'insp-bicos': () => { coletarInspecao(); const id = insp.machineId; novoWizard(id, 'bicos'); },
  'insp-cancelar': () => { insp = null; go('afericao'); },
  'insp-salvar': () => {
    coletarInspecao();
    const ins = insp, res = resultadoInspecao(ins);
    if (res.status === 'INCOMPLETA') { showToast('Falta verificar: ' + res.faltam.join(', ')); return; }
    const mq = find('machines', ins.machineId); if (!mq) { showToast('Escolha o pulverizador'); return; }
    const ab = aferBicosParaInspecao(ins.machineId, ins.data);
    const reg = {id: ins.id || uid(), tipo: 'inspecao', familia: 'pulverizador_barra', data: ins.data, hora: ins.hora, responsavel: ins.responsavel,
      maquina: {id: mq.id, name: mq.name, model: mq.model, hours: mq.hours}, propriedade: db.settings.farm || '',
      entradas: JSON.parse(JSON.stringify(ins)),
      resultado: {status: res.status, grupos: res.grupos, naoConformes: res.naoConformes, validade: validadeInspecao(ins.data, ins.validadeMeses), fonte: INSP_FONTE, aferBicos: ab ? {id: ab.id, data: ab.data, status: ab.resultado.status} : null},
      criadoEm: new Date().toISOString()};
    db.afericoes.push(reg); save(); if (typeof fotosAoSalvar === 'function') fotosAoSalvar('afericoes', reg.id); insp = null;
    showToast(res.status === 'OK' ? 'Inspeção registrada: aprovado' : 'Inspeção registrada: reprovado'); go('afericao/' + reg.id);
  }
});
