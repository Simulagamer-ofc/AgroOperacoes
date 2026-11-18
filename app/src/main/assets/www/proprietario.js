/* Proprietário da fazenda (Ajustes → Fazenda → Proprietário)
   • Usuário proprietário (com a nuvem): escolhe qual usuário da fazenda é o dono — sempre ADM, ninguém o desativa,
     remove ou rebaixa; só ele (ou o Admin do sistema) passa a propriedade (regras no servidor).
   • Cadastro do proprietário: nome ou razão social, CPF/CNPJ, inscrição estadual, contato e endereço.
     Com a nuvem fica no servidor (tabela farm_proprietario; só o ADM vê e edita); sem nuvem, neste aparelho.
     Vira o "Responsável" dos impressos quando ele está vazio e preenche o declarante do LCDPR. */
const PR_VAZIO = {nome: '', doc: '', ie: '', telefone: '', email: '', endereco: '', municipio: '', uf: '', cep: ''};
const prNaNuvem = () => typeof nvVinculado === 'function' && nvVinculado();
const prPodeVer = () => !prNaNuvem() || nvPapel() === 'admin';
const prSoDig = s => String(s || '').replace(/\D/g, '');
const prDocFmt = d => { d = prSoDig(d); return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d; };
const prCepFmt = c => { c = prSoDig(c); return c.length === 8 ? c.replace(/^(\d{5})(\d{3})$/, '$1-$2') : c; };
let prEstado = 'parado'; // parado | carregando | ok | sem-servidor | erro
// Dados do cadastro: da nuvem (guardados no aparelho para usar sem internet) ou só do aparelho
function prDados() {
  if (prNaNuvem()) return nv.propDados && nv.propDados.farm === nv.fazenda.id ? nv.propDados.dados : null;
  return db.settings.proprietarioDados || null;
}
async function prCarregar() {
  if (!prNaNuvem() || nvPapel() !== 'admin') return;
  prEstado = 'carregando';
  try {
    const r = await nvHttp(`/rest/v1/farm_proprietario?select=nome,doc,ie,telefone,email,endereco,municipio,uf,cep,atualizado_em&farm_id=eq.${encodeURIComponent(nv.fazenda.id)}`);
    nv.propDados = {farm: nv.fazenda.id, dados: Array.isArray(r) && r[0] ? r[0] : null}; nvSalvar(); prEstado = 'ok';
  } catch (err) { prEstado = err.status === 404 || err.codigo === '42P01' || err.codigo === 'PGRST205' ? 'sem-servidor' : 'erro'; }
  prAtualizar();
}
async function prGravar(v) {
  const dados = {...PR_VAZIO, ...v};
  if (prNaNuvem()) {
    const corpo = {farm_id: nv.fazenda.id}; Object.keys(PR_VAZIO).forEach(k => { corpo[k] = dados[k] || null; });
    const r = await nvHttp('/rest/v1/farm_proprietario?on_conflict=farm_id', {method: 'POST', body: corpo, headers: {Prefer: 'resolution=merge-duplicates,return=representation'}});
    nv.propDados = {farm: nv.fazenda.id, dados: Array.isArray(r) && r[0] ? r[0] : corpo}; nvSalvar(); prEstado = 'ok';
  } else db.settings.proprietarioDados = dados;
  // O nome do proprietário vira o "Responsável" dos impressos, se ele ainda não tiver um
  if (!String(db.settings.owner || '').trim() && dados.nome) { db.settings.owner = dados.nome; if (typeof applySettings === 'function') applySettings(); }
  save();
}
// Usuário marcado como proprietário (lista de usuários do ADM)
const prUsuarioDono = () => prNaNuvem() && nv.proprietario ? (nvUsuarios || []).find(u => u.user_id === nv.proprietario) || null : null;
function prBlocoUsuario() {
  if (!prNaNuvem()) return `<p class="nota">Sem conta na nuvem, o proprietário é só um cadastro. Com a nuvem ligada, você também escolhe qual usuário da fazenda é o proprietário.</p>`;
  if (nvUsuarios === null) return '<p class="nota">Carregando os usuários da fazenda…</p>';
  const eu = nv.sessao.usuario, dono = nv.proprietario || '', u = prUsuarioDono(), pode = !dono || dono === eu || !!nv.sysadm;
  const ativos = (nvUsuarios || []).filter(x => (x.status || 'ativo') === 'ativo' && x.user_id !== dono);
  const atual = dono ? `<div class="pr-dono"><span class="pr-av">${esc((u ? nvNomeDe(u) : '?').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase())}</span><span><span class="pr-nome"><b>${esc(u ? nvNomeDe(u) : 'Usuário não encontrado')}</b> <span class="nv-selo-dono">Proprietário</span>${dono === eu ? ' <small>(você)</small>' : ''}</span><small>${esc(u ? nvMostrarLogin(u.login) : '')} · sempre ADM, não pode ser desativado, removido nem rebaixado</small></span></div>`
    : `<p class="nota nv-dono-nota">Nenhum usuário foi definido como proprietário ainda.</p>`;
  const escolher = pode && ativos.length ? `<div class="pr-escolher"><label for="pr_user">${dono ? 'Passar a propriedade para' : 'Escolha quem é o proprietário'}</label><div class="pr-linha"><select id="pr_user"><option value="">Escolha um usuário…</option>${ativos.map(x => `<option value="${esc(x.user_id)}">${esc(nvNomeDe(x))} — ${esc(nvMostrarLogin(x.login))}</option>`).join('')}</select>
      <button type="button" class="${dono ? 'secondary' : 'primary'}" data-act="pr-dono">${dono ? 'Passar a propriedade' : 'Definir proprietário'}</button></div></div>`
    : dono && !pode ? '<p class="nota">Só o proprietário (ou o Admin do sistema) passa a propriedade para outra pessoa.</p>' : '';
  return atual + escolher;
}
function prBlocoFicha() {
  if (prNaNuvem() && prEstado === 'sem-servidor') return '<p class="nota">O cadastro do proprietário ainda não está disponível no servidor desta fazenda.</p>';
  if (prNaNuvem() && prEstado === 'carregando' && !prDados()) return '<p class="nota">Carregando o cadastro do proprietário…</p>';
  const d = prDados();
  if (!d || !d.nome) return `<p class="nota">Cadastre o nome ou razão social, CPF/CNPJ, inscrição estadual, telefone, e-mail e endereço do proprietário. Eles preenchem o declarante do LCDPR e o responsável dos impressos.</p>
    <div class="btn-row">${btn('Cadastrar proprietário', 'pr-editar')}${prUsuarioDono() ? btn('Começar pelo usuário proprietário', 'pr-do-usuario', '', 'secondary') : ''}</div>`;
  const linhas = [['Nome / razão social', d.nome], [prSoDig(d.doc).length === 14 ? 'CNPJ' : 'CPF', prDocFmt(d.doc)], ['Inscrição estadual', d.ie], ['Telefone', d.telefone], ['E-mail', d.email],
    ['Endereço', d.endereco], ['Município / UF', [d.municipio, d.uf].filter(Boolean).join(' / ')], ['CEP', prCepFmt(d.cep)]].filter(([, v]) => v);
  return `<div class="tbl-wrap"><table class="tbl pr-ficha"><tbody>${linhas.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</tbody></table></div>
    ${prEstado === 'erro' ? '<p class="nota">Sem conexão: mostrando o último cadastro guardado neste aparelho.</p>' : ''}
    <div class="btn-row">${btn('Editar cadastro', 'pr-editar', '', 'secondary')}</div>`;
}
const cartaoProprietario = () => prPodeVer() ? `<article class="card panel pr-cartao"><h3>Proprietário</h3>
  <h4 class="nv-sec">Usuário proprietário</h4><div id="prUsuario">${prBlocoUsuario()}</div>
  <h4 class="nv-sec">Cadastro do proprietário</h4><div id="prFicha">${prBlocoFicha()}</div></article>` : '';
function prAtualizar() {
  const a = $('#prUsuario'), b = $('#prFicha'); if (a) a.innerHTML = prBlocoUsuario(); if (b) b.innerHTML = prBlocoFicha();
}
function prEditar(inicio) {
  const d = {...PR_VAZIO, ...(prDados() || {}), ...(inicio || {})};
  const vals = {...d, doc: prDocFmt(d.doc), cep: prCepFmt(d.cep)};
  openForm({title: 'Cadastro do proprietário', submit: 'Salvar', sub: prNaNuvem() ? 'Fica guardado na nuvem da fazenda; só o ADM vê e edita.' : 'Fica guardado neste aparelho.', values: vals,
    fields: [{k: 'nome', label: 'Nome completo ou razão social', required: true, full: true}, {k: 'doc', label: 'CPF ou CNPJ', placeholder: 'Somente números ou com pontuação'},
      {k: 'ie', label: 'Inscrição estadual (produtor rural)'}, {k: 'telefone', label: 'Telefone', placeholder: '(54) 99999-9999'}, {k: 'email', label: 'E-mail'},
      {k: 'endereco', label: 'Endereço', full: true, placeholder: 'Estrada, linha, comunidade ou rua e número'}, {k: 'municipio', label: 'Município'},
      {k: 'uf', label: 'UF', type: 'select', options: [{value: '', label: '—'}, ...(typeof UFS !== 'undefined' ? UFS : [])]}, {k: 'cep', label: 'CEP'}],
    onSubmit: v => {
      const nome = String(v.nome || '').trim(); if (nome.length < 2) return 'Digite o nome do proprietário';
      const doc = prSoDig(v.doc), cep = prSoDig(v.cep), email = String(v.email || '').trim();
      if (doc && ![11, 14].includes(doc.length)) return 'CPF tem 11 números e CNPJ tem 14';
      if (doc && typeof docValido === 'function' && !docValido(doc)) return doc.length === 11 ? 'CPF inválido' : 'CNPJ inválido';
      if (cep && cep.length !== 8) return 'CEP tem 8 números';
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'E-mail inválido';
      const dados = {nome, doc, ie: String(v.ie || '').trim(), telefone: String(v.telefone || '').trim(), email, endereco: String(v.endereco || '').trim(), municipio: String(v.municipio || '').trim(), uf: v.uf || '', cep};
      prGravar(dados).then(() => { showToast('Cadastro do proprietário salvo'); render(); }).catch(err => showToast(err.message || 'Não foi possível salvar o cadastro.', true));
    }});
}
// LCDPR: o declarante começa com o cadastro do proprietário (só o que estiver vazio)
if (ACTIONS['lc-produtor']) {
  const _lcProdutor = ACTIONS['lc-produtor'];
  ACTIONS['lc-produtor'] = (...a) => {
    const d = prDados(), p = typeof lcCfg === 'function' ? lcCfg().produtor : null;
    if (d && p) {
      const doc = prSoDig(d.doc), uf = (typeof UFS !== 'undefined' && UFS.includes(d.uf)) ? d.uf : '';
      [['nome', d.nome], ['cpf', doc.length === 11 ? doc : ''], ['tel', d.telefone], ['email', d.email], ['endereco', d.endereco], ['uf', uf], ['cep', d.cep]].forEach(([k, v]) => { if (v && !p[k]) p[k] = v; });
    }
    return _lcProdutor(...a);
  };
}
Object.assign(ACTIONS, {
  'pr-editar': () => prEditar(),
  'pr-do-usuario': () => { const u = prUsuarioDono(); if (!u) return; const login = String(u.login || ''); prEditar({nome: u.nome || '', email: login.includes('@') && !login.endsWith('@' + NV_DOMINIO) ? login : ''}); },
  'pr-dono': () => { const id = $('#pr_user')?.value; if (!id) return showToast('Escolha o usuário'); nvDefinirDono(id); }
});
// Ajustes: o cartão "Proprietário" logo depois de "Propriedade" (seção Fazenda)
{
  const _cad = VIEWS.cadastros, _depois = VIEWS.cadastros.after;
  VIEWS.cadastros = (...a) => { const h = _cad(...a), c = cartaoProprietario(); if (!c) return h; const i = h.indexOf('<article class="card panel"><h3>Registros no dispositivo'); return i < 0 ? h + c : h.slice(0, i) + c + h.slice(i); };
  VIEWS.cadastros.after = (...a) => { _depois?.(...a); if (prPodeVer() && prNaNuvem() && prEstado !== 'carregando') prCarregar(); };
}
if (typeof nvCarregarUsuarios === 'function') {
  const _carregar = nvCarregarUsuarios;
  nvCarregarUsuarios = async (...a) => { const r = await _carregar(...a); prAtualizar(); if (typeof cfgAtualizarSelos === 'function') cfgAtualizarSelos(); return r; };
}
document.head.insertAdjacentHTML('beforeend', `<style>
  .pr-dono { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 10px }
  .pr-dono > span:last-child { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
  .pr-dono small { color: var(--muted) }
  .pr-av { flex: 0 0 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: #e0a80022; color: #b07d00; border: 2px solid #e0a800 }
  .pr-escolher label { display: block; font-weight: 600; margin-bottom: 6px }
  .settings > *, .pr-cartao > div { min-width: 0 }
  .pr-linha { display: flex; gap: 8px; flex-wrap: wrap } .pr-linha select { flex: 1 1 200px; min-width: 0; width: 100%; max-width: 100%; text-overflow: ellipsis; border: 1px solid var(--line); border-radius: 9px; padding: 10px; background: var(--bg); color: var(--text); min-height: 44px }
  .pr-nome { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
  .pr-ficha td:last-child { overflow-wrap: anywhere }
  .pr-ficha td:first-child { color: var(--muted); width: 42% }
  .pr-cartao .nv-sec { margin-top: 14px }
</style>`);
