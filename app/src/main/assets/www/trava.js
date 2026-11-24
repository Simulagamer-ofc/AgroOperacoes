// MercaPlant — contorno do talhão trancado
// Depois de salvo, o contorno (e a área do talhão) fica trancado 🔒. Para mudar — desenho no satélite, GPS,
// importação de arquivo ou a área no cadastro — uma pessoa autorizada escolhe o nome e digita a PRÓPRIA senha,
// no aparelho de quem estiver mudando. A senha é conferida na nuvem (não fica guardada em lugar nenhum).
// Quem pode liberar: o ADM sempre; os demais, o ADM marca em Ajustes → Equipe e acesso → Contornos trancados
// (fica na nuvem, em farm_members.libera_contorno; só o ADM muda, pela função usuarios).
// A liberação vale até salvar a mudança (ou 30 min). O contorno de antes fica guardado: dá para voltar.
// Fazenda só neste aparelho (sem nuvem, sem usuários): não há senha para conferir, então não tranca.

const trvLib = {}; // id do talhão -> {nome, user_id, em}
const TRV_VALIDADE = 30 * 60000;
const trvAtivo = () => typeof nvVinculado === 'function' && nvVinculado() && !!nv?.fazenda?.id;
function trvTrancado(id) {
  const f = find('fields', id); if (!(f?.contorno?.pontos?.length > 2) || !trvAtivo()) return false;
  const l = trvLib[id]; return !(l && Date.now() - l.em < TRV_VALIDADE);
}
const trvAdm = u => u.role === 'admin' || u.role === 'owner';
const trvNomeDe = u => u.nome || (typeof nvMostrarLogin === 'function' ? nvMostrarLogin(u.login) : u.login) || 'Sem nome';
const trvEu = () => nv?.nomes?.[nv?.sessao?.usuario] || (typeof nvMostrarLogin === 'function' ? nvMostrarLogin(nv?.sessao?.email) : '') || '';
// Equipe da fazenda (nome, login, nível), lida na hora: quem pode liberar muda sem precisar atualizar o app
async function trvEquipe() {
  const q = campos => nvHttp(`/rest/v1/farm_members?select=${campos}&farm_id=eq.${encodeURIComponent(nv.fazenda.id)}&order=joined_at.asc`);
  const ms = await q('user_id,role,nome,login,status,libera_contorno').catch(err => { if (err.status === 400) return q('user_id,role,nome,login,status'); throw err; });
  return (ms || []).filter(u => !u.status || u.status === 'ativo');
}
const trvPodem = equipe => equipe.filter(u => u.login && (trvAdm(u) || u.libera_contorno === true));

// Cartão do talhão trancado (no Desenhar no satélite e no Contorno por GPS)
function trvCartao(id) {
  const f = find('fields', id), c = f?.contorno || {};
  return `<div class="trv-cartao"><span class="trv-cad" aria-hidden="true">🔒</span><div><b>Contorno trancado</b>
    <small>Salvo${c.por ? ` por ${esc(c.por)}` : ''}${c.data ? ` em ${fmtDate(c.data)}` : ''}. Para mudar, uma pessoa autorizada digita a senha dela neste aparelho.</small></div>
    <button class="primary" data-act="trv-liberar" data-id="${esc(id)}">🔓 Liberar para mudar</button></div>`;
}
const trvSelo = id => trvAtivo() && find('fields', id)?.contorno ? (trvTrancado(id) ? '🔒 Trancado' : '🔓 Liberado para mudar') : '';

function trvPedir(id, depois) {
  const f = find('fields', id); if (!f) return;
  if (navigator.onLine === false) { showToast('Sem internet: para liberar o contorno a senha é conferida na nuvem.', true); return; }
  dialog.innerHTML = `<h3>🔓 Liberar o contorno — ${esc(f.name)}</h3>
    <p class="sub">O contorno e a área deste talhão estão trancados. Quem pode liberar escolhe o próprio nome e digita a própria senha.</p>
    <form class="form-grid" autocomplete="off"><div class="field full"><label for="trvQuem">Quem libera</label><select id="trvQuem" disabled><option>Carregando a equipe…</option></select></div>
      <div class="field full"><label for="trvSenha">Senha de quem libera</label><input id="trvSenha" type="password" autocomplete="off" required></div>
      <p class="nv-portao-erro" id="trvErro" hidden></p>
      <div class="actions full"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary" disabled>Liberar</button></div></form>`;
  $('[data-close]', dialog).onclick = closeModal;
  modal.classList.add('open');
  const erro = m => { const e = $('#trvErro', dialog); if (e) { e.textContent = m; e.hidden = !m; } };
  const sel = $('#trvQuem', dialog), ok = $('button[type=submit]', dialog);
  let pessoas = [];
  trvEquipe().then(eq => {
    if (!document.body.contains(sel)) return;
    pessoas = trvPodem(eq);
    if (!pessoas.length) { sel.innerHTML = '<option>Ninguém autorizado</option>'; erro('Ninguém desta fazenda pode liberar. O ADM escolhe quem pode em Ajustes → Equipe e acesso → Contornos trancados.'); return; }
    const eu = nv?.sessao?.usuario;
    sel.innerHTML = pessoas.map(u => `<option value="${esc(u.user_id)}" ${u.user_id === eu ? 'selected' : ''}>${esc(trvNomeDe(u))}${trvAdm(u) ? ' (ADM)' : ''}</option>`).join('');
    sel.disabled = false; ok.disabled = false; $('#trvSenha', dialog)?.focus();
  }).catch(err => { erro(err?.rede ? 'Sem conexão com a nuvem. Tente de novo com internet.' : 'Não consegui ler a equipe da fazenda.'); });
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); erro('');
    const u = pessoas.find(x => x.user_id === sel.value), senha = $('#trvSenha', dialog).value;
    if (!u || !senha) return;
    ok.disabled = true; ok.textContent = 'Conferindo…';
    try {
      // Confere a senha na nuvem; a sessão devolvida não é usada (quem está no aparelho continua o mesmo)
      await nvHttp('/auth/v1/token?grant_type=password', {method: 'POST', body: {email: nvLoginParaEmail(u.login), password: senha}, auth: false});
      trvLib[id] = {nome: trvNomeDe(u), user_id: u.user_id, em: Date.now()};
      closeModal(); showToast(`🔓 Contorno de ${f.name} liberado por ${trvNomeDe(u)}. Volta a trancar ao salvar.`);
      if (depois) depois(); else render();
    } catch (err) {
      erro(err?.rede ? 'Sem conexão com a nuvem. Tente de novo com internet.' : 'Senha errada.');
      ok.disabled = false; ok.textContent = 'Liberar'; $('#trvSenha', dialog).select();
    }
  };
}

// Ao salvar: guarda o contorno de antes, anota quem salvou/liberou e tranca de novo
function trvDepoisDeSalvar(f, antes) {
  if (!f?.contorno || f.contorno === antes) return;
  const lib = trvLib[f.id];
  if (antes) { const {...a} = antes; f.contornoAnterior = a; }
  f.contorno.por = lib?.nome || trvEu() || undefined;
  if (lib) f.contorno.liberadoPor = lib.nome;
  delete trvLib[f.id]; save();
}
{
  const salvarCtn = ACTIONS['ctn-salvar'];
  ACTIONS['ctn-salvar'] = (...a) => {
    const id = ctn?.fieldId; if (id && trvTrancado(id)) { trvPedir(id, () => ACTIONS['ctn-salvar'](...a)); return; }
    const f = find('fields', id), antes = f?.contorno;
    salvarCtn(...a); trvDepoisDeSalvar(f, antes);
  };
  const salvarDes = ACTIONS['tmd-salvar'];
  ACTIONS['tmd-salvar'] = (...a) => {
    if (typeof tmd !== 'undefined' && tmd && trvTrancado(tmd.fieldId)) { const id = tmd.fieldId; trvPedir(id, () => ACTIONS['tmd-salvar'](...a)); return; }
    salvarDes(...a);
  };
}
Object.assign(ACTIONS, {
  'trv-liberar': id => trvPedir(id),
  'trv-anterior': id => {
    const f = find('fields', id); if (!f?.contornoAnterior) return;
    if (trvTrancado(id)) { trvPedir(id, () => ACTIONS['trv-anterior'](id)); return; }
    const a = f.contornoAnterior;
    confirmDialog(`Voltar ao contorno anterior (${um1(a.areaHa)} ha${a.data ? ', de ' + fmtDate(a.data) : ''})? O atual fica guardado como anterior.`, () => {
      const atual = f.contorno, lib = trvLib[id];
      f.contorno = {...a, por: lib?.nome || trvEu() || a.por}; f.contornoAnterior = atual; delete trvLib[id]; save();
      showToast('Contorno anterior de volta (trancado)'); render();
    }, 'Voltar ao anterior');
  }
});

// Área do talhão: com o contorno trancado, o campo de área fica só para leitura no cadastro
if (typeof fieldForm === 'function') {
  const formOriginal = fieldForm;
  fieldForm = (f = {}) => {
    formOriginal(f);
    if (!f.id || !trvTrancado(f.id)) return;
    const el = $('#f_area', dialog); if (!el) return;
    el.readOnly = true; el.classList.add('trv-so-ler');
    const dica = Object.assign(document.createElement('span'), {className: 'hint trv-dica'});
    dica.innerHTML = '🔒 Trancada junto com o contorno. <button type="button" class="link">Liberar para mudar</button>';
    el.after(dica);
    $('button', dica).onclick = () => { closeModal(); trvPedir(f.id, () => fieldForm(find('fields', f.id))); };
  };
}

// Página do talhão: de onde veio o contorno, quem salvou, trancado, voltar ao anterior
tecEmbrulhar('talhao', talhaoSemTrava => (id, ...r) => {
  const html = talhaoSemTrava(id, ...r), f = find('fields', id); if (!f?.contorno) return html;
  const origem = {'satélite': 'Contorno desenhado no satélite', arquivo: 'Contorno importado de arquivo'}[f.contorno.origem] || 'Contorno medido por GPS';
  let out = html.replace('<strong>Contorno medido por GPS</strong>', `<strong>${origem}</strong>`);
  const selo = trvSelo(id);
  if (!selo && !f.contornoAnterior) return out;
  const linha = `<small class="trv-linha">${selo}${f.contorno.por ? ` • salvo por ${esc(f.contorno.por)}` : ''}${f.contornoAnterior ? ` • <button type="button" class="link" data-act="trv-anterior" data-id="${esc(id)}">voltar ao anterior</button>` : ''}</small>`;
  // Topo do talhão (mapa do contorno, previas.js) ou o cartão "Contorno medido" (tela antiga)
  const t = out.indexOf('class="card pv-talhao-topo');
  if (t >= 0) { const fim = out.indexOf('</section>', t); if (fim >= 0) return out.slice(0, fim) + `<div class="trv-topo">${linha}</div>` + out.slice(fim); }
  const i = out.indexOf('class="card panel ctn-resumo"'); if (i < 0) return out;
  const fim = out.indexOf('</div></section>', i); if (fim < 0) return out;
  return out.slice(0, fim) + linha + out.slice(fim);
});

// Ajustes → Equipe e acesso: quem pode liberar (só o ADM vê e muda)
let trvEquipeCache = null;
function trvListaAjustes() {
  if (!trvEquipeCache) return '<p class="nota">Carregando a equipe…</p>';
  if (!trvEquipeCache.length) return '<p class="nota">Nenhuma pessoa na equipe.</p>';
  return `<div class="trv-pessoas">${trvEquipeCache.map(u => `<label class="trv-pessoa"><input type="checkbox" data-trv-pessoa="${esc(u.user_id)}" ${trvAdm(u) || u.libera_contorno === true ? 'checked' : ''} ${trvAdm(u) ? 'disabled' : ''}><span>${esc(trvNomeDe(u))}<small>${trvAdm(u) ? 'ADM — sempre pode' : u.login ? esc(nvMostrarLogin(u.login)) : ''}</small></span></label>`).join('')}</div>`;
}
if (typeof CFG_GRUPOS !== 'undefined') {
  const g = CFG_GRUPOS.find(([id]) => id === 'equipe');
  if (g) { g[3] = new RegExp(g[3].source.replace(/\)?\$$/, '').replace(/^\^\(?/, '^(') + '|Contornos trancados)$'); g[2] = 'Pedidos de acesso, nível, telas e quem libera contornos'; }
}
tecEmbrulhar('cadastros', ajustesSemTrava => (...a) => {
  const html = ajustesSemTrava(...a), i = html.lastIndexOf('</section>');
  if (i < 0 || !trvAtivo() || nvPapel() !== 'admin') return html;
  const card = `<article class="card panel"><h3>Contornos trancados</h3>
    <p>Depois de salvo, o contorno do talhão (e a área) fica trancado 🔒. Para mudar — desenho no satélite, GPS, importação ou a área no cadastro — uma das pessoas marcadas aqui digita a própria senha no aparelho de quem está mudando. O contorno de antes fica guardado.</p>
    <div id="trvLista">${trvListaAjustes()}</div></article>`;
  if (!trvEquipeCache) trvEquipe().then(eq => { trvEquipeCache = eq; const el = $('#trvLista'); if (el) el.innerHTML = trvListaAjustes(); }).catch(() => { const el = $('#trvLista'); if (el) el.innerHTML = '<p class="nota">Sem conexão: abra de novo com internet para ver a equipe.</p>'; });
  return html.slice(0, i) + card + html.slice(i);
});
document.addEventListener('change', async e => {
  const c = e.target.closest?.('[data-trv-pessoa]'); if (!c || nvPapel() !== 'admin') return;
  const u = (trvEquipeCache || []).find(x => x.user_id === c.dataset.trvPessoa), libera = c.checked;
  c.disabled = true;
  try {
    await nvFuncaoUsuarios({acao: 'contorno', user_id: c.dataset.trvPessoa, libera});
    if (u) u.libera_contorno = libera;
    showToast(`${u ? trvNomeDe(u) : 'Pessoa'} ${libera ? 'agora pode' : 'não pode mais'} liberar contornos`);
  } catch (err) { c.checked = !libera; showToast(err?.rede ? 'Sem conexão: tente de novo com internet.' : err?.message || 'Não foi possível salvar.', true); }
  c.disabled = false;
});
