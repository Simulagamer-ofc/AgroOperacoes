'use strict';
/* Nexus Agro na nuvem (Supabase): contas, fazenda compartilhada pela equipe e sincronização automática.
   Os dados continuam no aparelho e o app funciona sem internet. Com internet, cada registro alterado sobe para a
   fazenda e as alterações dos outros aparelhos descem em ordem de chegada (seq).
   Conflito (mesmo registro alterado em dois aparelhos antes de sincronizar): vale a alteração mais recente (_mod);
   no estoque, o saldo soma o que cada aparelho lançou. Exclusões viajam como registros marcados "deleted".
   Níveis de acesso: ADM (tudo + usuários), Supervisor (tudo, sem usuários) e Usuário comum (lança no dia a dia,
   edita só o que lançou, não exclui, não vê o financeiro). O servidor confere as mesmas regras.
   Sem bibliotecas: login e dados pela API REST do Supabase. A chave publicável é pública por natureza;
   quem protege os dados são as regras do banco (cada conta só enxerga as fazendas de que participa). */

const NUVEM = {url: 'https://gfvtudfdhooavcchdpnm.supabase.co', chave: 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'};
const NV_ESTADO = 'agro-nuvem', NV_BASE = 'agro-nuvem-base';
const NV_LOTE_ENVIO = 200, NV_LOTE_RECEBE = 500, NV_INTERVALO = 60000;
// Quem entra só com nome de usuário (criado pelo ADM) tem um e-mail interno neste domínio
const NV_DOMINIO = 'usuarios.nexusagro.app';
const NV_NIVEIS = {admin: 'ADM', supervisor: 'Supervisor', member: 'Usuário comum'};
// Lançamentos financeiros: o usuário comum não vê (o servidor também não os envia para ele)
const NV_FINANCEIRO = ['expenses', 'contas', 'vendas'];

const nvLer = (k, padrao) => { try { const v = JSON.parse(safeStorage.get(k) || 'null'); return v && typeof v === 'object' ? v : padrao; } catch { return padrao; } };
// Estado da conta neste aparelho (fica fora do banco: não vai para backups nem arquivos de sincronização)
let nv = {sessao: null, fazenda: null, papel: null, cursor: 0, ultima: null, rejeitados: {}, ...nvLer(NV_ESTADO, {})};
nv.rejeitados ||= {};
if (nv.fazenda && !nv.dadosDe) nv.dadosDe = nv.fazenda.id; // aparelhos da versão 0.21: os dados já são desta fazenda
// Última versão de cada registro conhecida pelo servidor: 'coleção|id' → [impressão, saldo do estoque]
let nvBase = nvLer(NV_BASE, {});
let nvStatus = 'parado', nvErro = '', nvRodando = null, nvRepetir = false, nvAgenda = null, nvOcupado = false, nvFazendas = null, nvUsuarios = null;

const nvSalvar = () => { safeStorage.set(NV_ESTADO, JSON.stringify(nv)); safeStorage.set(NV_BASE, JSON.stringify(nvBase)); };
const nvVinculado = () => !!(nv.sessao && nv.fazenda);
// ADM do sistema: entra sem fazenda (os dados ficam só no aparelho até entrar numa fazenda)
const nvLiberado = () => nvVinculado() || !!(nv.sessao && nv.sysadm);
let nvTodas = null; // todas as fazendas (painel do ADM do sistema)
async function nvVerSysadm() {
  try { const r = await nvHttp(`/rest/v1/system_admins?select=user_id&user_id=eq.${encodeURIComponent(nv.sessao.usuario)}`); nv.sysadm = Array.isArray(r) && r.length > 0; }
  catch (err) { if (err.rede) return; nv.sysadm = false; }
  nvSalvar();
}
// Nível neste aparelho; sem conta ligada a uma fazenda o app é de uso individual (sem restrições)
const nvPapel = () => nvVinculado() ? nv.papel || 'member' : null;
const nvComum = () => nvPapel() === 'member';

// ---------- Impressão de um registro (igual no aparelho e no servidor, que reordena as chaves) ----------
const nvCanon = v => Array.isArray(v) ? '[' + v.map(nvCanon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort().map(k => JSON.stringify(k) + ':' + nvCanon(v[k])).join(',') + '}'
  : JSON.stringify(v ?? null);
function nvHash(r) { const s = nvCanon(r); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }
const nvChave = (c, id) => c + '|' + id;
const nvBaseDe = (c, r) => c === 'stock' ? [nvHash(r), Number(r.qty) || 0] : [nvHash(r)];
const nvArred = x => Math.round(x * 1e6) / 1e6;

// Exclusões feitas neste aparelho: 'coleção|id' → momento da exclusão
function nvExclusoes() {
  const m = new Map();
  for (const e of db._removidos || []) { if (!e?.id) continue; const k = nvChave(e.c, e.id); if (!m.has(k) || e.at > m.get(k).at) m.set(k, {c: e.c, id: e.id, at: e.at || 0}); }
  return m;
}
const nvPresentes = () => Object.fromEntries(COLLECTIONS.map(c => [c, new Set(db[c].map(r => r?.id))]));

// Quantas alterações deste aparelho ainda não subiram (vale também depois de sair da conta)
const nvFaltamEnviar = () => nv.dadosDe ? nvPendentes().length : 0;
const nvNomeDados = () => nv.dadosNome || nv.fazenda?.name || 'a fazenda anterior';
// Alterações deste aparelho que o servidor ainda não tem
function nvPendentes() {
  const itens = [], presentes = nvPresentes();
  for (const c of COLLECTIONS) for (const r of db[c]) {
    if (!r?.id) continue;
    const b = nvBaseDe(c, r);
    if (nvBase[nvChave(c, r.id)]?.[0] !== b[0]) itens.push({c, id: r.id, data: JSON.parse(JSON.stringify(r)), deleted: false, base: b});
  }
  for (const [k, e] of nvExclusoes()) if (nvBase[k] && !presentes[e.c]?.has(e.id)) itens.push({c: e.c, id: e.id, data: {_mod: e.at}, deleted: true, base: null});
  return itens;
}

// ---------- Comunicação com o servidor ----------
class NvErro extends Error { constructor(msg, {rede = false, sessao = false} = {}) { super(msg); this.rede = rede; this.sessao = sessao; } }
const NV_MENSAGENS = [
  [/invalid login credentials|invalid_credentials/i, 'Usuário (ou e-mail) ou senha incorretos.'],
  [/email not confirmed|email_not_confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/already registered|already exists|user_already_exists/i, 'Já existe uma conta com esse e-mail. Use “Entrar”.'],
  [/password should be at least|weak_password/i, 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.'],
  [/pwned|leaked|compromised/i, 'Esta senha já apareceu em vazamentos na internet. Escolha outra.'],
  [/unable to validate email|invalid format|email_address_invalid/i, 'Esse e-mail não é válido.'],
  [/signups not allowed|signup_disabled/i, 'Novas contas estão desativadas no servidor.'],
  [/rate limit|too many|over_email_send_rate_limit/i, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'],
  [/row-level security|permission denied/i, 'Sem permissão para isso no seu nível de acesso.'],
  [/invalid api key|no api key/i, 'A chave do servidor está errada (atualize o aplicativo).']
];
function nvMensagem(data, status) {
  const bruto = typeof data === 'string' ? data : data?.msg || data?.message || data?.error_description || data?.error || '';
  const cod = typeof data === 'object' ? data?.error_code || data?.code || '' : '';
  for (const [re, txt] of NV_MENSAGENS) if (re.test(bruto) || re.test(cod)) return txt;
  // Mensagens já escritas em português pelo próprio servidor (funções do Nexus Agro)
  if (/[ãçéêíóôõú]|^Sem |^Só |^Você |^Dê |^Entre /i.test(bruto)) return bruto;
  return bruto ? `Erro do servidor (${status}${cod ? ' ' + cod : ''}): ${bruto}` : `Erro do servidor (${status}).`;
}

async function nvHttp(caminho, {method = 'GET', body, auth = true, headers = {}, tentar = true} = {}) {
  if (auth) { if (!nv.sessao) throw new NvErro('Entre na sua conta para sincronizar.', {sessao: true}); await nvTokenValido(); }
  const h = {apikey: NUVEM.chave, 'Content-Type': 'application/json', ...headers};
  if (auth) h.Authorization = 'Bearer ' + nv.sessao.access_token;
  let res;
  try { res = await fetch(NUVEM.url + caminho, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)}); } catch { throw new NvErro('Sem conexão com o servidor.', {rede: true}); }
  if (res.status === 401 && auth && tentar && nv.sessao?.refresh_token) { await nvRenovar(); return nvHttp(caminho, {method, body, auth, headers, tentar: false}); }
  const texto = await res.text();
  let data = null; try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  if (!res.ok) { const e = new NvErro(nvMensagem(data, res.status), {sessao: res.status === 401}); e.status = res.status; e.codigo = data?.code || ''; throw e; }
  return data;
}

function nvGuardarSessao(s) {
  nv.sessao = {access_token: s.access_token, refresh_token: s.refresh_token, expira: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: s.user?.email || nv.sessao?.email || '', usuario: s.user?.id || nv.sessao?.usuario || ''};
}
async function nvTokenValido() { if (nv.sessao && nv.sessao.expira - 60 < Date.now() / 1000) await nvRenovar(); }
let nvRenovando = null;
function nvRenovar() {
  nvRenovando ??= (async () => {
    try {
      const s = await nvHttp('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: nv.sessao.refresh_token}, auth: false});
      nvGuardarSessao(s); nvSalvar();
    } catch (err) {
      if (err.rede) throw err;
      // Sessão vencida de vez: pede login de novo, mas mantém a fazenda e o que falta enviar
      nv.sessao = null; nvSalvar(); setTimeout(nvPortao, 0);
      throw new NvErro('Sua sessão expirou. Entre de novo na conta para continuar sincronizando.', {sessao: true});
    } finally { nvRenovando = null; }
  })();
  return nvRenovando;
}
// Nome de usuário (criado pelo ADM) ou e-mail
const nvLoginParaEmail = l => l.includes('@') ? l : `${l}@${NV_DOMINIO}`;
const nvMostrarLogin = email => String(email || '').endsWith('@' + NV_DOMINIO) ? email.slice(0, -(NV_DOMINIO.length + 1)) : email || '';

// ---------- Sincronização ----------
// Aplica um registro vindo do servidor. Retorna 1 se mudou algo neste aparelho.
function nvAplicar(row, exclusoes) {
  const c = row.store, k = nvChave(c, row.id), lista = db[c], i = lista.findIndex(x => x?.id === row.id), local = i >= 0 ? lista[i] : null;
  // Alteração recusada pelo servidor (nível de acesso): a versão do servidor volta a valer
  const recusado = !!nv.rejeitados[k]; delete nv.rejeitados[k];
  const base = nvBase[k], hLocal = local ? nvHash(local) : null, localAlterado = !recusado && !!local && base?.[0] !== hLocal;
  if (row.deleted) {
    const at = Number(row.data?._mod) || 0;
    delete nvBase[k];
    if (!local) return 0;
    if (localAlterado && (local._mod || 0) > at) return 0; // edição local depois da exclusão: o registro volta a subir
    lista.splice(i, 1); return 1;
  }
  const remoto = {...(row.data || {}), id: row.id}, hRemoto = nvHash(remoto);
  if (!local) {
    const ex = exclusoes.get(k);
    nvBase[k] = nvBaseDe(c, remoto);
    if (ex && !recusado && ex.at >= (remoto._mod || 0)) return 0; // excluído aqui depois da última alteração: a exclusão sobe
    lista.push(remoto); return 1;
  }
  if (hLocal === hRemoto) { nvBase[k] = nvBaseDe(c, remoto); return 0; }
  if (!localAlterado) { lista[i] = remoto; nvBase[k] = nvBaseDe(c, remoto); return 1; }
  // Alterado nos dois lados: vale o mais recente; no estoque, soma o que este aparelho lançou ao saldo do servidor
  let fica = (remoto._mod || 0) > (local._mod || 0) ? remoto : local;
  if (c === 'stock' && base && base.length > 1) fica = {...fica, qty: nvArred((Number(remoto.qty) || 0) + (Number(local.qty) || 0) - (Number(base[1]) || 0))};
  nvBase[k] = nvBaseDe(c, remoto);
  if (nvHash(fica) === hLocal) return 0;
  lista[i] = fica; return 1;
}

async function nvReceber() {
  const exclusoes = nvExclusoes(), presentes = nvPresentes();
  // Registros conhecidos que sumiram sem exclusão (dados apagados ou backup restaurado): baixa tudo de novo
  if (Object.keys(nvBase).some(k => { const p = k.indexOf('|'), c = k.slice(0, p), id = k.slice(p + 1); return presentes[c] && !presentes[c].has(id) && !exclusoes.has(k); })) nv.cursor = 0;
  let mudou = 0;
  for (;;) {
    const rows = await nvHttp(`/rest/v1/records?select=store,id,data,deleted,seq&farm_id=eq.${encodeURIComponent(nv.fazenda.id)}&seq=gt.${nv.cursor || 0}&order=seq.asc&limit=${NV_LOTE_RECEBE}`);
    if (!Array.isArray(rows) || !rows.length) break;
    let nesteLote = 0;
    for (const row of rows) if (COLLECTIONS.includes(row.store) && row.id) nesteLote += nvAplicar(row, exclusoes);
    if (nesteLote) { impressoes = null; salvarSemNuvem(); } // vindo de outro aparelho: não é alteração local
    nv.cursor = rows[rows.length - 1].seq;
    nvSalvar();
    mudou += nesteLote;
    if (rows.length < NV_LOTE_RECEBE) break;
  }
  nv.rejeitados = {}; nvSalvar(); // recusados que o servidor não tem: ficam só neste aparelho
  return mudou;
}

let nvSemFuncaoEnvio = false; // servidor sem push_records (versão anterior do banco): grava direto na tabela
async function nvEnviar() {
  const itens = nvPendentes();
  let recusados = 0;
  for (let i = 0; i < itens.length; i += NV_LOTE_ENVIO) {
    const lote = itens.slice(i, i + NV_LOTE_ENVIO), linhas = lote.map(it => ({store: it.c, id: it.id, data: it.data, deleted: it.deleted}));
    let rej = [];
    if (!nvSemFuncaoEnvio) {
      try { rej = await nvHttp('/rest/v1/rpc/push_records', {method: 'POST', body: {p_farm: nv.fazenda.id, p_rows: linhas}}) || []; }
      catch (err) { if (err.status === 404 || err.codigo === 'PGRST202') nvSemFuncaoEnvio = true; else throw err; }
    }
    if (nvSemFuncaoEnvio) await nvHttp('/rest/v1/records?on_conflict=farm_id,store,id', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
      body: linhas.map(l => ({farm_id: nv.fazenda.id, ...l}))});
    const recusa = new Set((Array.isArray(rej) ? rej : []).map(r => nvChave(r.store, r.id)));
    for (const it of lote) {
      const k = nvChave(it.c, it.id);
      if (recusa.has(k)) {
        // Sem permissão (ex.: usuário comum excluindo): desfaz aqui, baixando de novo a versão do servidor
        nv.rejeitados[k] = 1; nvBase[k] = it.base || nvBase[k];
        if (it.deleted && db._removidos) db._removidos = db._removidos.filter(e => nvChave(e.c, e.id) !== k);
        recusados++;
      } else if (it.deleted) delete nvBase[k]; else nvBase[k] = it.base;
    }
    nvSalvar();
  }
  if (recusados) {
    nv.cursor = 0; impressoes = null; salvarSemNuvem(); nvSalvar(); nvRepetir = true;
    showToast(`${recusados} ${recusados === 1 ? 'alteração não foi aceita pelo seu nível de acesso e foi desfeita' : 'alterações não foram aceitas pelo seu nível de acesso e foram desfeitas'}.`, true);
  }
  return itens.length - recusados;
}

async function nvConferirFazenda() {
  const rows = await nvHttp(`/rest/v1/farms?select=id,name,join_code&id=eq.${encodeURIComponent(nv.fazenda.id)}`);
  if (!rows.length) { const nome = nv.fazenda.name; nvEsquecerFazenda(); nvSalvar(); nvPortaoErro(`Você não participa mais de “${nome}”. Fale com o ADM ou escolha outra fazenda.`); setTimeout(nvPortao, 0); throw new NvErro(`Você não participa mais de “${nome}”.`); }
  const f = rows[0];
  if (f.name !== nv.fazenda.name || f.join_code !== nv.fazenda.join_code) { nv.fazenda = {id: f.id, name: f.name, join_code: f.join_code}; applySettings(); }
  const filtro = `farm_id=eq.${encodeURIComponent(f.id)}&user_id=eq.${encodeURIComponent(nv.sessao.usuario)}`;
  const eu = await nvHttp(`/rest/v1/farm_members?select=role,funcao,modulos&${filtro}`).catch(err => { if (err.status === 400) return nvHttp(`/rest/v1/farm_members?select=role&${filtro}`); throw err; });
  const papel = eu?.[0]?.role === 'owner' ? 'admin' : eu?.[0]?.role || (nv.sysadm ? 'admin' : 'member');
  const funcao = eu?.[0]?.funcao || null, modulos = Array.isArray(eu?.[0]?.modulos) ? eu[0].modulos : null;
  if (papel !== nv.papel || funcao !== nv.funcao || JSON.stringify(modulos) !== JSON.stringify(nv.modulos ?? null)) {
    nv.papel = papel; nv.funcao = funcao; nv.modulos = modulos; nvSalvar(); nvAplicarPapel(); applySettings();
    if (typeof view !== 'undefined') { if (!nvPodeRota(parseRoute().name)) go('inicio'); else nvAtualizarTela(); }
  }
  nvSalvar();
}

function nvSincronizar(manual = false) {
  if (!nvVinculado()) return Promise.resolve();
  if (nvRodando) { nvRepetir = true; return nvRodando; }
  nvRodando = (async () => {
    nvStatus = 'sincronizando'; nvMostrar();
    let recebidos = 0, enviados = 0;
    try {
      do {
        nvRepetir = false;
        await nvConferirFazenda();
        recebidos += await nvReceber(); // recebe antes de enviar: o conflito é resolvido aqui pela data da alteração
        enviados += await nvEnviar();
      } while (nvRepetir);
      nv.ultima = new Date().toISOString(); nvSalvar();
      nvStatus = 'ok'; nvErro = '';
      if (recebidos) { nvAtualizarTela(); showToast(`Nuvem: ${recebidos} ${recebidos === 1 ? 'alteração recebida' : 'alterações recebidas'} da equipe`); }
      else if (manual) showToast(enviados ? `Nuvem: ${enviados} ${enviados === 1 ? 'alteração enviada' : 'alterações enviadas'}` : 'Tudo sincronizado');
    } catch (err) {
      nvStatus = err.rede ? 'offline' : 'erro'; nvErro = err.message || 'Erro na sincronização.';
      if (manual || err.sessao) showToast(nvErro, !err.rede);
      if (recebidos) nvAtualizarTela();
    } finally { nvRodando = null; nvMostrar(); }
  })();
  return nvRodando;
}

// Redesenha a tela com os dados recebidos, sem atrapalhar quem está preenchendo um formulário
function nvAtualizarTela() {
  const editando = modal.classList.contains('open') || (document.activeElement && view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  if (!editando) render();
}

function nvAgendar(ms = 3000) {
  if (!nvVinculado()) return;
  clearTimeout(nvAgenda);
  nvAgenda = setTimeout(() => { if (navigator.onLine !== false) nvSincronizar(); }, ms);
}

// Toda gravação local marca quem criou cada registro novo e agenda um envio
// (com intervalo, para juntar várias alterações seguidas)
const salvarSemNuvem = save;
save = function () {
  const eu = nv.sessao?.usuario;
  if (eu && impressoes) for (const c of COLLECTIONS) { const antes = impressoes[c] || {}; for (const r of db[c]) if (r?.id && !(r.id in antes) && !r._por) r._por = eu; }
  const ok = salvarSemNuvem(); nvAgendar(); return ok;
};

setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) nvSincronizar(); }, NV_INTERVALO);
addEventListener('online', () => nvAgendar(500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nvAgendar(500); else if (nvVinculado() && navigator.onLine !== false && nvFaltamEnviar()) nvSincronizar(); });
addEventListener('pagehide', () => { if (nvVinculado() && navigator.onLine !== false && nvFaltamEnviar()) nvSincronizar(); });
addEventListener('DOMContentLoaded', () => nvAgendar(1500));

// ---------- Funções: cada pessoa vê as telas da sua função ----------
// Telas que podem ser liberadas (Visão geral e Cadastros e backup ficam sempre disponíveis)
const NV_TELAS = [
  ['operacoes', 'Operações do dia'], ['talhoes', 'Talhões'], ['chuva', 'Chuvas'], ['pragas', 'Pragas e doenças (MIP)'],
  ['aplicacoes', 'Aplicações e carência'], ['maodeobra', 'Mão de obra'], ['maquinas', 'Máquinas e manutenção'], ['combustivel', 'Combustível'],
  ['afericao', 'Aferição e calibragem'], ['catalogo', 'Catálogo de máquinas'], ['pontas', 'Catálogo de pontas'], ['secagem', 'Secador e moega'],
  ['sementes', 'Sementes, lotes e beneficiamento'], ['estoque', 'Estoque e insumos'], ['financeiro', 'Financeiro (gastos, contas, LCDPR)'],
  ['producao', 'Produção e margem'], ['relatorios', 'Relatórios']];
const NV_TODAS_TELAS = NV_TELAS.map(([k]) => k);
// Funções de uma fazenda de grãos e sementes: telas e nível sugerido (o ADM pode acrescentar telas)
const NV_FUNCOES = [
  ['diretor', 'Diretor / Proprietário', 'Gestão', 'admin', null],
  ['gerente', 'Gerente de fazenda', 'Gestão', 'supervisor', null],
  ['administrativo', 'Administrativo / Financeiro', 'Gestão', 'member', ['financeiro', 'producao', 'estoque', 'relatorios']],
  ['agronomo', 'Agrônomo / Técnico agrícola', 'Gestão', 'supervisor', ['talhoes', 'operacoes', 'pragas', 'aplicacoes', 'chuva', 'sementes', 'relatorios']],
  ['encarregado', 'Encarregado / Líder de campo', 'Campo', 'supervisor', ['operacoes', 'talhoes', 'chuva', 'maodeobra', 'aplicacoes']],
  ['operador', 'Operador de máquinas / Tratorista', 'Campo', 'member', ['operacoes', 'maquinas', 'combustivel']],
  ['monitor', 'Monitor de pragas', 'Campo', 'member', ['pragas', 'chuva']],
  ['aplicador', 'Aplicador', 'Campo', 'member', ['aplicacoes', 'operacoes']],
  ['oficina', 'Chefe de oficina / Manutenção', 'Máquinas', 'supervisor', ['maquinas', 'combustivel', 'afericao', 'catalogo', 'pontas', 'estoque']],
  ['mecanico', 'Mecânico', 'Máquinas', 'member', ['maquinas', 'afericao']],
  ['abastecedor', 'Abastecedor / Frentista', 'Máquinas', 'member', ['combustivel']],
  ['ubs', 'Responsável UBS / Beneficiamento', 'Grãos e sementes', 'supervisor', ['secagem', 'sementes']],
  ['secador', 'Operador de secador / Armazém', 'Grãos e sementes', 'member', ['secagem']],
  ['classificador', 'Classificador / Laboratório', 'Grãos e sementes', 'member', ['sementes']],
  ['almoxarife', 'Almoxarife', 'Suprimentos', 'member', ['estoque']],
  ['personalizado', 'Personalizado', 'Outra', 'member', []]];
const nvFuncao = id => NV_FUNCOES.find(f => f[0] === id);
const nvNomeFuncao = id => nvFuncao(id)?.[1] || '';
// Rota → tela da lista acima (rotas fora daqui ficam sempre liberadas)
const NV_ROTA_TELA = {operacoes: 'operacoes', talhoes: 'talhoes', talhao: 'talhoes', chuva: 'chuva', pragas: 'pragas', aplicacoes: 'aplicacoes', maodeobra: 'maodeobra',
  maquinas: 'maquinas', combustivel: 'combustivel', afericao: 'afericao', catalogo: 'catalogo', pontas: 'pontas', secagem: 'secagem',
  sementes: 'sementes', lotes: 'sementes', lote: 'sementes', ubs: 'sementes', etiqueta: 'sementes', estoque: 'estoque',
  financeiro: 'financeiro', gastos: 'financeiro', lcdpr: 'financeiro', producao: 'producao', relatorios: 'relatorios'};
// Telas liberadas para esta pessoa: null = todas (ADM, Admin do sistema, ou sem função definida)
const nvTelasLiberadas = () => !nvVinculado() || nv.sysadm || nvPapel() === 'admin' || !Array.isArray(nv.modulos) ? null : nv.modulos;
const nvTemTela = tela => { const l = nvTelasLiberadas(); return !l || l.includes(tela); };
const nvPodeRota = rota => !NV_ROTA_TELA[rota] || nvTemTela(NV_ROTA_TELA[rota]);
// Financeiro: supervisor e ADM sempre; usuário comum só com a tela de Financeiro ou Produção liberada
const nvVeFinanceiro = () => !nvComum() || (Array.isArray(nv.modulos) && (nv.modulos.includes('financeiro') || nv.modulos.includes('producao')));
// Mostra no menu só as telas liberadas (e esconde o título de grupo que ficou vazio)
function nvAplicarMenu() {
  document.querySelectorAll('[data-route]').forEach(b => { b.hidden = !nvPodeRota(b.dataset.route); });
  document.querySelectorAll('.sidebar .nav-grupo').forEach(g => {
    let el = g.nextElementSibling, algum = false;
    while (el && !el.classList.contains('nav-grupo')) { if (el.matches('[data-route]') && !el.hidden) algum = true; el = el.nextElementSibling; }
    g.hidden = !algum;
  });
  document.documentElement.toggleAttribute('data-fin', nvVeFinanceiro());
}

// ---------- Níveis de acesso no aparelho ----------
// Telas do financeiro (o usuário comum não recebe esses dados)
const NV_TELAS_FIN = ['financeiro', 'gastos', 'lcdpr', 'producao'];
// Botões de editar → coleção do registro (o comum edita só o que ele lançou)
const NV_EDITAR = {'op-edit': 'operations', 'mc-edit': 'machines', 'mt-edit': 'maintenances', 'fd-edit': 'fields', 'lot-edit': 'lots', 'st-edit': 'stock',
  'mip-edit': 'monitoramentos', 'mo-edit': 'equipe', 'pd-colheita-edit': 'colheitas'};
const nvAcaoProibida = act => /-(del|excluir)$/.test(act) || (/^(fin-|gs-)/.test(act) && !nvTemTelaComum('financeiro')) || (/^pd-venda/.test(act) && !nvTemTelaComum('producao')) || ['wipe', 'restore', 'seed', 'sync-receber', 'sync-desfazer'].includes(act);
const nvTemTelaComum = tela => Array.isArray(nv.modulos) && nv.modulos.includes(tela);
function nvAplicarPapel() { document.documentElement.dataset.nivel = nvPapel() || ''; nvAplicarMenu(); }
function nvProteger() {
  for (const [act, fn] of Object.entries(ACTIONS)) {
    if (fn.nvProtegida) continue;
    const protegida = id => {
      // Apagar ou restaurar dados no aparelho só depois que tudo foi enviado (senão o que não subiu se perderia)
      if ((act === 'wipe' || act === 'restore') && nvFaltamEnviar()) { showToast('Ainda há dados deste aparelho que não foram enviados para a nuvem. Conecte à internet e aguarde o envio automático.', true); if (nvVinculado() && navigator.onLine !== false) nvSincronizar(); return; }
      if (nvComum()) {
        if (nvAcaoProibida(act)) { showToast('Seu nível de acesso (Usuário comum) não permite esta ação. Fale com o supervisor ou o ADM.', true); return; }
        const col = NV_EDITAR[act];
        if (col && id) { const r = find(col, id); if (r && r._por !== nv.sessao.usuario) { showToast('Usuário comum só pode editar o que ele mesmo lançou.', true); return; } }
      }
      return fn(id);
    };
    protegida.nvProtegida = true;
    ACTIONS[act] = protegida;
  }
  for (const rota of Object.keys(NV_ROTA_TELA)) {
    const original = VIEWS[rota];
    if (!original || original.nvProtegida) continue;
    const bloqueio = () => !nvPodeRota(rota) ? ['Tela fora da sua função', `Sua função${nv.funcao ? ` (${nvNomeFuncao(nv.funcao)})` : ''} não inclui esta tela. Peça ao ADM para liberar, se precisar.`]
      : NV_TELAS_FIN.includes(rota) && !nvVeFinanceiro() ? ['Sem acesso ao financeiro', 'Seu nível de acesso é Usuário comum.'] : null;
    const protegida = arg => { const b = bloqueio(); return b ? head('Acesso restrito', 'Cada pessoa vê as telas da sua função.') + `<section class="card">${empty(b[0], b[1], {act: 'nav', id: 'inicio', label: 'Voltar ao início'})}</section>` : original(arg); };
    protegida.after = arg => { if (!bloqueio()) original.after?.(arg); };
    protegida.nvProtegida = true;
    VIEWS[rota] = protegida;
  }
}
// Esconde do menu as telas e botões que o nível não pode usar
document.head.insertAdjacentHTML('beforeend', `<style>
  :root[data-nivel="member"] [data-act$="-del"], :root[data-nivel="member"] [data-act$="-excluir"], :root[data-nivel="member"] [data-act="wipe"],
  :root[data-nivel="member"] [data-act="seed"], :root[data-nivel="member"] [data-act="restore"], :root[data-nivel="member"] [data-act="sync-receber"],
  :root[data-nivel="member"] [data-act="sync-desfazer"], :root[data-nivel="member"]:not([data-fin]) [data-act^="fin-"], :root[data-nivel="member"]:not([data-fin]) [data-act^="gs-"] { display: none !important; }
  [data-route][hidden], .nav-grupo[hidden] { display: none !important }
  .nv-telas { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px 14px; margin: 6px 0 4px }
  .nv-telas label { display: flex; gap: 8px; align-items: center; font-size: .9rem; color: var(--text) }
  .nv-telas input { width: 18px; height: 18px; accent-color: var(--green) }
  .nv-usuarios td { vertical-align: middle } .nv-usuarios select { min-width: 9em }
</style>`);
nvAplicarPapel();
nvProteger();
addEventListener('DOMContentLoaded', nvProteger); // ações das telas carregadas depois deste arquivo

// ---------- Conta e fazenda ----------
async function nvComOcupado(fn) {
  if (nvOcupado) return; nvOcupado = true; nvMostrar();
  try { await fn(); } catch (err) { nvPortaoErro(err.message || 'Não foi possível concluir.'); showToast(err.message || 'Não foi possível concluir.', true); } finally { nvOcupado = false; nvPortao(); render(); }
}
const nvCampos = () => ({login: ($('#nvp_login')?.value || '').trim().toLowerCase(), senha: $('#nvp_senha')?.value || ''});
function nvValidar({login, senha}, soEmail = false) {
  if (login.includes('@') || soEmail) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) throw new NvErro('Digite um e-mail válido.'); }
  else if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)) throw new NvErro('Digite o seu usuário (ex.: joao.silva) ou e-mail.');
  if (!senha) throw new NvErro('Digite a senha.');
}
// Desliga da fazenda (os dados do aparelho continuam marcados como sendo dela: nv.dadosDe)
function nvEsquecerFazenda() { nv.fazenda = null; nv.papel = null; nv.funcao = null; nv.modulos = null; nvFazendas = null; nvUsuarios = null; nvStatus = 'parado'; nvErro = ''; nvAplicarPapel(); }
// Apaga os dados deste aparelho (usado ao entrar numa fazenda diferente da que estava aqui)
function nvLimparAparelho() {
  const settings = db.settings; db = emptyDb(); db.settings = settings; db._removidos = [];
  impressoes = null; salvarSemNuvem();
  nvBase = {}; nv.cursor = 0; nv.ultima = null; nv.rejeitados = {}; nv.dadosDe = null;
}

const nvEntrar = () => nvComOcupado(async () => {
  const d = nvCampos(); nvValidar(d);
  if (navigator.onLine === false) throw new NvErro('Sem internet. Para entrar pela primeira vez neste aparelho é preciso estar conectado.');
  const s = await nvHttp('/auth/v1/token?grant_type=password', {method: 'POST', body: {email: nvLoginParaEmail(d.login), password: d.senha}, auth: false});
  nvGuardarSessao(s); nv.ultimoLogin = d.login; nvSalvar();
  await nvVerSysadm(); nvTodas = null;
  const fazendas = await nvHttp('/rest/v1/farms?select=id,name,join_code&order=created_at.asc').catch(() => null);
  // Continua na mesma fazenda se esta conta participa dela; senão escolhe outra
  if (nv.fazenda && fazendas && !fazendas.some(f => f.id === nv.fazenda.id)) nvEsquecerFazenda();
  nvFazendas = fazendas;
  if (nv.fazenda) { nv.papel = null; nvSalvar(); showToast('Bem-vindo de volta'); nvSincronizar(true); return; }
  if (nv.sysadm) { showToast('Entrou como Admin do sistema. As fazendas ficam em Cadastros e backup.'); go('cadastros'); return; }
  if (nvFazendas?.length === 1) nvVincular(nvFazendas[0]);
});
// Sair: os dados sobem automaticamente antes de sair; o que não subir (sem internet) fica guardado e sobe no próximo login
function nvSair() {
  dialog.innerHTML = `<h3>Sair do sistema</h3><p>Antes de sair, o app envia para a nuvem tudo o que foi lançado. Para usar de novo será preciso entrar com usuário e senha.</p>
    <p class="nota">Em aparelho compartilhado ou que vai trocar de mão, use <b>Sair e apagar os dados</b>: os dados continuam guardados na nuvem da fazenda.</p>
    <div class="actions" style="flex-wrap:wrap"><button class="secondary" data-close>Cancelar</button><button class="danger" data-sair-apagar>Sair e apagar os dados</button><button class="primary" data-sair>Sair</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-sair]', dialog).onclick = () => { closeModal(); nvSairDe(false); };
  $('[data-sair-apagar]', dialog).onclick = () => { closeModal(); nvSairDe(true); };
  modal.classList.add('open');
}
async function nvSairDe(apagar) {
  if (nvVinculado() && navigator.onLine !== false) { showToast('Enviando os dados para a nuvem…'); await nvSincronizar(); }
  const faltam = nvFaltamEnviar();
  if (faltam) {
    const qtd = `${faltam} ${faltam === 1 ? 'alteração ainda não foi enviada' : 'alterações ainda não foram enviadas'}`;
    dialog.innerHTML = `<h3>Dados ainda não enviados</h3><p>${qtd} para a nuvem (sem internet ou servidor fora do ar).</p>
      <p class="nota">${apagar ? 'Os dados só podem ser apagados deste aparelho depois de enviados. Conecte à internet e tente de novo.' : 'Se sair agora, elas ficam guardadas neste aparelho e são enviadas automaticamente no próximo login com internet.'}</p>
      <div class="actions" style="flex-wrap:wrap"><button class="secondary" data-close>Cancelar</button>${apagar ? '' : '<button class="secondary" data-sair>Sair mesmo assim</button>'}<button class="primary" data-tentar>Tentar enviar de novo</button></div>`;
    $('[data-close]', dialog).onclick = closeModal;
    $('[data-tentar]', dialog).onclick = () => { closeModal(); nvSairDe(apagar); };
    const s = $('[data-sair]', dialog); if (s) s.onclick = () => { closeModal(); nvFinalizarSaida(false); };
    modal.classList.add('open');
    return;
  }
  return nvFinalizarSaida(apagar);
}
async function nvFinalizarSaida(apagar) {
  try { if (nv.sessao) await nvHttp('/auth/v1/logout', {method: 'POST', tentar: false}); } catch { /* sai mesmo sem internet */ }
  nv.sessao = null; nv.papel = null; nv.funcao = null; nv.modulos = null; nv.sysadm = false; nvTodas = null; nvFazendas = null; nvUsuarios = null;
  if (apagar) {
    nvLimparAparelho(); nv.fazenda = null; nv.ultimoLogin = '';
    db.settings = {...emptyDb().settings}; salvarSemNuvem();
    // Cópias guardadas (antes de sincronizar, dados danificados) também saem
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (/^agro-db-(antes-sync|corrompido)/.test(k)) localStorage.removeItem(k); } } catch { /* ignora */ }
  }
  nvAplicarPapel(); nvSalvar(); applySettings(); nvPortao(); render();
  showToast(apagar ? 'Você saiu e os dados deste aparelho foram apagados' : 'Você saiu da conta');
}

async function nvCarregarFazendas() {
  try { nvFazendas = await nvHttp('/rest/v1/farms?select=id,name,join_code&order=created_at.asc'); } catch (err) { nvFazendas = []; nvPortaoErro(err.message); }
  nvPortao();
}
const nvListaFazendas = () => nvFazendas === null ? '<p class="nota">Carregando suas fazendas…</p>'
  : nvFazendas.length ? `<p>Escolha a fazenda:</p><div class="btn-row">${nvFazendas.map(f => btn(f.name, 'nv-usar', f.id, 'secondary')).join('')}</div>` : '<p class="nota">Esta conta ainda não participa de nenhuma fazenda. Peça ao ADM da sua fazenda para criar o seu usuário.</p>';

function nvVincular(f) {
  const n = COLLECTIONS.reduce((s, c) => s + db[c].length, 0);
  const ligar = () => {
    if (nv.dadosDe !== f.id) { nvBase = {}; nv.cursor = 0; nv.ultima = null; nv.rejeitados = {}; }
    nv.fazenda = {id: f.id, name: f.name, join_code: f.join_code}; nv.dadosDe = f.id; nv.dadosNome = f.name; nv.papel = null;
    nvSalvar(); nvPortao(); showToast(`Entrando em “${f.name}”…`); nvSincronizar(true);
  };
  if (!n || nv.dadosDe === f.id) return ligar();
  const faltam = nvFaltamEnviar();
  if (nv.dadosDe && faltam) {
    nvPortaoErro(`Este aparelho tem ${faltam} ${faltam === 1 ? 'alteração' : 'alterações'} de “${nvNomeDados()}” que ainda não ${faltam === 1 ? 'foi enviada' : 'foram enviadas'}. Entre com uma conta dessa fazenda, com internet, para enviar antes de usar outra fazenda neste aparelho.`);
    showToast('Há dados de outra fazenda ainda não enviados neste aparelho.', true);
    return;
  }
  if (nv.dadosDe) return confirmDialog(`Os dados guardados neste aparelho são de outra fazenda. Para entrar em “${f.name}”, eles serão apagados deste aparelho (continuam na nuvem da outra fazenda) e os dados de “${f.name}” serão baixados. Continuar?`, () => { nvLimparAparelho(); ligar(); }, 'Apagar e entrar');
  confirmDialog(`Este aparelho tem ${n} registros que ainda não estão em nenhuma fazenda. Eles serão enviados para “${f.name}” e juntados com os dados da equipe. Se forem só dados de exemplo, toque em “Cancelar”, apague-os em Cadastros e backup e entre de novo. Continuar?`, ligar, 'Enviar e juntar');
}
const nvCriarFazenda = () => nvComOcupado(async () => {
  const nome = ($('#nvp_fazenda')?.value || $('#nvs_fazenda')?.value || '').trim();
  if (!nome) throw new NvErro('Dê um nome para a fazenda.');
  const f = await nvHttp('/rest/v1/rpc/create_farm', {method: 'POST', body: {p_name: nome}});
  if (!db.settings.farm) { db.settings.farm = f.name; salvarSemNuvem(); if (typeof applySettings === 'function') applySettings(); }
  nvFazendas = null; nvTodas = null; nvVincular(f);
});

// ---------- Quem está usando: nome no topo do menu ----------
// Fazenda aberta → nome dela (o da nuvem); ADM do sistema sem fazenda → "Admin do sistema"
function nvNomeExibido() {
  if (nvVinculado()) return nv.fazenda.name;
  if (nv.sessao && nv.sysadm) return 'Admin do sistema';
  return db.settings.farm || 'Minha fazenda';
}
function nvQuemTexto() {
  if (!nv.sessao) return '';
  const nivel = nv.sysadm ? (nvVinculado() ? 'Admin do sistema' : '') : nvVinculado() ? (nvNomeFuncao(nv.funcao) || NV_NIVEIS[nvPapel()] || '') : '';
  return [nvMostrarLogin(nv.sessao.email), nivel].filter(Boolean).join(' · ');
}
const applySettingsSemNuvem = applySettings;
applySettings = function () {
  applySettingsSemNuvem();
  const nome = $('#farmName'); if (nome) nome.textContent = nvNomeExibido();
  let quem = $('#nvQuem');
  if (!quem && nome) { quem = Object.assign(document.createElement('small'), {id: 'nvQuem', className: 'nv-quem'}); nome.after(quem); }
  if (quem) { quem.textContent = nvQuemTexto(); quem.hidden = !quem.textContent; }
};

// ---------- Tela de entrada: o sistema só abre com usuário e senha ----------
let nvMsgPortao = '';
const nvPortaoErro = m => { nvMsgPortao = m; const e = $('#nvpErro'); if (e) { e.textContent = m; e.hidden = !m; } };
function nvPortao() {
  let el = document.getElementById('nvPortao');
  if (!el) { el = Object.assign(document.createElement('div'), {id: 'nvPortao', className: 'nv-portao'}); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.append(el); }
  const aberto = !nvLiberado();
  applySettings();
  document.documentElement.classList.toggle('nv-bloqueado', aberto);
  el.hidden = !aberto;
  if (!aberto) { el.innerHTML = ''; nvMsgPortao = ''; return; }
  const marca = '<div class="nv-portao-topo"><img class="nv-portao-logo" src="img/logo-nexus.png" alt="" width="64" height="64"><p class="nv-portao-marca">NEXUS <span>AGRO</span></p></div>';
  const erro = `<p class="nv-portao-erro" id="nvpErro" ${nvMsgPortao ? '' : 'hidden'}>${esc(nvMsgPortao)}</p>`;
  if (!nv.sessao) {
    if ($('#nvp_login')) return; // já está na tela de login (não apaga o que a pessoa digitou)
    el.innerHTML = `<form class="nv-portao-card" id="nvpForm" novalidate>${marca}<h2>Entrar</h2>
      ${nv.fazenda ? `<p class="nota">Fazenda <b>${esc(nv.fazenda.name)}</b>. Entre de novo para continuar.</p>` : '<p class="nota">Use o usuário e a senha que o ADM da fazenda criou para você.</p>'}
      <div class="field"><label for="nvp_login">Usuário ou e-mail</label><input id="nvp_login" autocapitalize="none" autocomplete="username" spellcheck="false" value="${esc(nv.ultimoLogin || '')}" placeholder="Ex.: joao.silva"></div>
      <div class="field"><label for="nvp_senha">Senha</label><input id="nvp_senha" type="password" autocomplete="current-password" placeholder="Sua senha"></div>
      ${erro}
      <button class="primary" type="submit" data-nv-portao>Entrar</button></form>`;
    $('#nvpForm', el).onsubmit = e => { e.preventDefault(); nvPortaoErro(''); nvEntrar(); };
    setTimeout(() => (nv.ultimoLogin ? $('#nvp_senha') : $('#nvp_login'))?.focus(), 50);
    return;
  }
  el.innerHTML = `<div class="nv-portao-card">${marca}<h2>Escolha a fazenda</h2>
    <p class="nota">Conectado como <b>${esc(nvMostrarLogin(nv.sessao.email))}</b>.</p>
    <div id="nvFazendas">${nvListaFazendas()}</div>
    ${erro}
    <div class="btn-row">${btn('Sair da conta', 'nv-sair', '', 'secondary')}</div></div>`;
  if (nvFazendas === null) nvCarregarFazendas();
}
document.head.insertAdjacentHTML('beforeend', `<style>
  :root.nv-bloqueado .app, :root.nv-bloqueado .mobile-nav { visibility: hidden }
  .nv-portao { position: fixed; inset: 0; z-index: 15; display: grid; place-items: center; padding: 20px; overflow-y: auto; background: radial-gradient(circle at 50% 20%, #0f3550, #061625 70%); }
  .nv-portao[hidden] { display: none }
  .nv-portao-card { width: min(420px, 100%); background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 18px; padding: 26px 24px; box-shadow: 0 30px 80px rgba(0,0,0,.4); display: grid; gap: 14px }
  .nv-portao-card h2 { margin: 0; font-size: 1.35rem }
  .nv-portao-card .nota { margin: 0 }
  .nv-portao-card .field input { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--bg); color: var(--text); font-size: 1rem }
  .nv-portao-card .primary { width: 100%; font-size: 1.02rem; padding: 13px }
  .nv-portao-topo { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center }
  .nv-portao-logo { width: 130px; height: 130px; filter: drop-shadow(0 4px 10px rgba(0,0,0,.35)) }
  .nv-portao-marca { margin: 0; font-size: 1.7rem; font-weight: 800; letter-spacing: .03em; color: var(--text) }
  .nv-portao-marca span { color: var(--destaque, #34d399) }
  .nv-portao-erro { margin: 0; color: var(--red); font-size: .9rem }
  .nv-portao-adm summary { cursor: pointer; color: var(--muted); font-size: .88rem; padding: 6px 0 }
  .nv-portao-adm .secondary { margin-top: 8px }
  .brand.nexus .nv-quem { color: #8fb0bf; font-size: .76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
</style>`);
addEventListener('DOMContentLoaded', () => { nvPortao(); if (nv.sessao && navigator.onLine !== false) nvVerSysadm().then(() => { nvPortao(); if (!nvVinculado()) render(); }); });

// ---------- Usuários da fazenda (ADM) ----------
const nvFuncaoUsuarios = corpo => nvHttp('/functions/v1/usuarios', {method: 'POST', body: {farm_id: nv.fazenda.id, ...corpo}});
async function nvCarregarUsuarios() {
  const q = campos => nvHttp(`/rest/v1/farm_members?select=${campos}&farm_id=eq.${encodeURIComponent(nv.fazenda.id)}&order=joined_at.asc`);
  try { nvUsuarios = await q('user_id,role,nome,login,joined_at,funcao,modulos').catch(err => { if (err.status === 400) return q('user_id,role,nome,login,joined_at'); throw err; }); }
  catch (err) { nvUsuarios = []; showToast(err.message, true); }
  const el = $('#nvUsuarios'); if (el) el.innerHTML = nvListaUsuarios();
}
const nvNivelDe = u => u.role === 'owner' ? 'admin' : u.role;
function nvListaUsuarios() {
  if (nvUsuarios === null) return '<p class="nota">Carregando usuários…</p>';
  if (!nvUsuarios.length) return '<p class="nota">Nenhum usuário encontrado.</p>';
  const eu = nv.sessao.usuario;
  return `<div class="tbl-wrap"><table class="tbl nv-usuarios"><tbody>${nvUsuarios.map(u => {
    const nivel = nvNivelDe(u), meu = u.user_id === eu;
    const sel = meu ? `<b>${NV_NIVEIS[nivel] || nivel}</b>` : `<select data-nv-nivel="${esc(u.user_id)}" aria-label="Nível de ${esc(u.nome || u.login)}">${Object.entries(NV_NIVEIS).map(([v, t]) => `<option value="${v}" ${v === nivel ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const funcao = nvNomeFuncao(u.funcao), telas = Array.isArray(u.modulos) ? `${u.modulos.length} ${u.modulos.length === 1 ? 'tela' : 'telas'}` : 'todas as telas';
    return `<tr><td><strong>${esc(u.nome || nvMostrarLogin(u.login) || 'Sem nome')}</strong>${meu ? ' <small>(você)</small>' : ''}<br><small style="color:var(--muted)">${esc([nvMostrarLogin(u.login), funcao, nivel === 'admin' ? '' : telas].filter(Boolean).join(' · '))}</small></td><td>${sel}</td>
      <td class="num">${meu ? '' : `<div class="row-actions">${btn('Função e telas', 'nv-u-acesso', u.user_id, 'secondary')}${btn('Nova senha', 'nv-u-senha', u.user_id, 'secondary')}${btn('Remover', 'nv-u-remover', u.user_id, 'secondary')}</div>`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function nvNovoUsuario() {
  openForm({
    title: 'Novo usuário', sub: `A pessoa entra no app com este usuário e senha, já ligada a “${nv.fazenda.name}”.`, submit: 'Criar usuário',
    fields: [
      {k: 'nome', label: 'Nome', required: true, full: true, placeholder: 'Ex.: João da Silva'},
      {k: 'login', label: 'Usuário para entrar', required: true, placeholder: 'Ex.: joao.silva', hint: 'Letras minúsculas, números, ponto ou hífen'},
      {k: 'senha', label: 'Senha', required: true, placeholder: 'Pelo menos 8 caracteres'},
      {k: 'funcao', label: 'Função', type: 'select', required: true, full: true, options: NV_FUNCOES.map(([value, nome, grupo]) => ({value, label: `${nome} (${grupo})`})), hint: 'Define as telas que a pessoa vê. Depois dá para acrescentar telas em “Função e telas”.'},
      {k: 'papel', label: 'Nível', type: 'select', required: true, options: Object.entries(NV_NIVEIS).map(([value, label]) => ({value, label})), hint: 'O que pode fazer nas telas: Comum lança; Supervisor também edita e exclui.'}
    ],
    values: {papel: 'member', funcao: 'operador'},
    onSubmit: d => {
      const login = d.login.toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)) return 'Usuário: de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado (sem espaço e sem acento).';
      if (d.senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
      nvComOcupado(async () => {
        const f = nvFuncao(d.funcao);
        await nvFuncaoUsuarios({acao: 'criar', nome: d.nome, login, senha: d.senha, papel: d.papel, funcao: d.funcao, modulos: f?.[4] ?? null});
        showToast(`Usuário “${login}” criado: ${f?.[1] || ''} · ${NV_NIVEIS[d.papel]}. Passe o usuário e a senha para a pessoa.`);
        await nvCarregarUsuarios();
      });
    }
  });
  // Ao escolher a função, sugere o nível dela
  const sf = $('#f_funcao', dialog), sp = $('#f_papel', dialog);
  if (sf && sp) sf.onchange = () => { const f = nvFuncao(sf.value); if (f) sp.value = f[3]; };
}
// Função e telas de uma pessoa (a função marca as telas; o ADM pode acrescentar ou tirar)
function nvAcessoUsuario(id) {
  const u = (nvUsuarios || []).find(x => x.user_id === id); if (!u) return;
  const marcadas = new Set(Array.isArray(u.modulos) ? u.modulos : NV_TODAS_TELAS);
  dialog.innerHTML = `<h3>Função e telas</h3><p class="sub">${esc(u.nome || nvMostrarLogin(u.login))} vê no menu só as telas marcadas. Visão geral e Cadastros e backup ficam sempre disponíveis.</p>
    <form novalidate><div class="form"><div class="field full"><label for="nva_funcao">Função</label><select id="nva_funcao">${NV_FUNCOES.map(([v, n, g]) => `<option value="${v}" ${v === (u.funcao || '') ? 'selected' : ''}>${esc(n)} (${esc(g)})</option>`).join('')}${u.funcao ? '' : '<option value="" selected>Sem função definida (todas as telas)</option>'}</select></div></div>
    <p class="nota" id="nva_todas" hidden>Esta função vê todas as telas.</p>
    <div class="nv-telas" id="nva_telas">${NV_TELAS.map(([k, n]) => `<label><input type="checkbox" value="${k}" ${marcadas.has(k) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div>
    <div class="actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary" type="submit">Salvar</button></div></form>`;
  const sel = $('#nva_funcao', dialog), caixas = $$('#nva_telas input', dialog);
  const todas = () => { const f = nvFuncao(sel.value); return !sel.value || (f && f[4] === null); };
  const ajustar = marcar => {
    const f = nvFuncao(sel.value), tudo = todas();
    caixas.forEach(c => { if (marcar && f && f[4]) c.checked = f[4].includes(c.value); if (tudo) c.checked = true; c.disabled = tudo; });
    $('#nva_todas', dialog).hidden = !tudo;
  };
  sel.onchange = () => ajustar(true); ajustar(false);
  $('[data-close]', dialog).onclick = closeModal;
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const funcao = sel.value || null, modulos = todas() ? null : caixas.filter(c => c.checked).map(c => c.value);
    if (modulos && !modulos.length) { showToast('Marque pelo menos uma tela.'); return; }
    closeModal();
    nvComOcupado(async () => { await nvFuncaoUsuarios({acao: 'acesso', user_id: id, funcao, modulos}); showToast('Função e telas salvas. A pessoa vê a mudança na próxima sincronização.'); await nvCarregarUsuarios(); });
  };
  modal.classList.add('open');
}
function nvNovaSenha(id) {
  const u = (nvUsuarios || []).find(x => x.user_id === id); if (!u) return;
  openForm({
    title: 'Nova senha', sub: `Para ${u.nome || nvMostrarLogin(u.login)}. Passe a nova senha para a pessoa.`, submit: 'Trocar senha',
    fields: [{k: 'senha', label: 'Nova senha', required: true, full: true, placeholder: 'Pelo menos 8 caracteres'}],
    onSubmit: d => {
      if (d.senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
      nvComOcupado(async () => { await nvFuncaoUsuarios({acao: 'senha', user_id: id, senha: d.senha}); showToast('Senha trocada'); });
    }
  });
}
const nvRemoverUsuario = id => {
  const u = (nvUsuarios || []).find(x => x.user_id === id); if (!u) return;
  confirmDialog(`Remover ${u.nome || nvMostrarLogin(u.login)} da fazenda? A pessoa deixa de sincronizar. Os registros que ela lançou continuam.`, () =>
    nvComOcupado(async () => { await nvFuncaoUsuarios({acao: 'remover', user_id: id}); showToast('Usuário removido'); await nvCarregarUsuarios(); }), 'Remover');
};
const nvMudarNivel = (id, papel) => nvComOcupado(async () => {
  await nvFuncaoUsuarios({acao: 'nivel', user_id: id, papel}); showToast(`Nível alterado para ${NV_NIVEIS[papel]}`); await nvCarregarUsuarios();
});

// ---------- Tela (Cadastros e backup) ----------
function nvTextoStatus() {
  const pend = nvVinculado() ? nvPendentes().length : 0, aguardando = pend ? ` • ${pend} ${pend === 1 ? 'alteração aguardando envio' : 'alterações aguardando envio'}` : '';
  if (nvStatus === 'sincronizando') return 'Sincronizando…';
  if (nvStatus === 'erro') return '⚠ ' + nvErro + aguardando;
  if (nvStatus === 'offline' || navigator.onLine === false) return 'Sem internet: as alterações ficam guardadas e sobem sozinhas quando o sinal voltar' + aguardando;
  return 'Envio automático ligado • ' + (nv.ultima ? `última sincronização em ${new Date(nv.ultima).toLocaleString('pt-BR')}` : 'ainda não sincronizado') + aguardando;
}
function nvMostrar() {
  const s = $('#nvStatus'); if (s) s.textContent = nvTextoStatus();
  $$('[data-act^="nv-"], [data-nv-nivel]').forEach(b => { b.disabled = nvOcupado; });
}

function cartaoNuvem() {
  const titulo = '<h3>Nuvem da equipe</h3>';
  if (!nvVinculado()) return nv.sysadm && nv.sessao ? cartaoSistema() : '';
  const papel = nvPapel();
  return `<article class="card panel">${titulo}
    <p>Fazenda <b>${esc(nv.fazenda.name)}</b> • ${esc(nvMostrarLogin(nv.sessao.email))} • nível <b>${NV_NIVEIS[papel] || papel}</b></p>
    <p class="nota" id="nvStatus">${esc(nvTextoStatus())}</p>
    <div class="btn-row" style="margin-top:10px">${papel === 'member' ? '' : btn('Trocar de fazenda', 'nv-trocar', '', 'secondary')}${btn('Sair da conta', 'nv-sair', '', 'secondary')}</div>
    ${papel === 'member' ? '<p class="nota">Como Usuário comum, você lança os registros do dia a dia e edita só o que você lançou. Exclusões e o financeiro ficam com o supervisor e o ADM.</p>' : '<p class="nota">Quando o mesmo registro é alterado em dois aparelhos sem internet, vale a alteração mais recente; lançamentos de estoque dos dois lados são somados ao saldo.</p>'}</article>
    ${papel === 'admin' ? `<article class="card panel"><h3>Usuários da fazenda</h3>
      <p>Crie o login de cada pessoa com a <b>função</b> (decide as telas que ela vê) e o <b>nível</b> (decide o que ela faz nelas). <b>Supervisor</b>: lança, edita e exclui e vê o financeiro. <b>Usuário comum</b>: lança, edita só o que lançou e não exclui. <b>ADM</b>: tudo, inclusive os usuários.</p>
      <div id="nvUsuarios">${nvListaUsuarios()}</div>
      <div class="btn-row" style="margin-top:10px">${btn('+ Novo usuário', 'nv-u-novo')}</div></article>` : ''}${nv.sysadm ? cartaoSistema() : ''}`;
}

// ---------- Painel do ADM do sistema ----------
async function nvCarregarTodas() {
  try {
    const [fazendas, membros] = await Promise.all([nvHttp('/rest/v1/farms?select=id,name,join_code,created_at&order=name.asc'), nvHttp('/rest/v1/farm_members?select=farm_id')]);
    const n = {}; for (const m of membros || []) n[m.farm_id] = (n[m.farm_id] || 0) + 1;
    nvTodas = (fazendas || []).map(f => ({...f, usuarios: n[f.id] || 0}));
  } catch (err) { nvTodas = []; showToast(err.message, true); }
  nvFazendas = nvTodas;
  const el = $('#nvTodas'); if (el) el.innerHTML = nvListaTodas();
}
function nvListaTodas() {
  if (nvTodas === null) return '<p class="nota">Carregando as fazendas…</p>';
  if (!nvTodas.length) return '<p class="nota">Nenhuma fazenda cadastrada ainda.</p>';
  return `<div class="tbl-wrap"><table class="tbl"><tbody>${nvTodas.map(f => {
    const atual = nv.fazenda?.id === f.id;
    return `<tr><td><strong>${esc(f.name)}</strong>${atual ? ' <small>(aberta neste aparelho)</small>' : ''}<br><small style="color:var(--muted)">${f.usuarios} ${f.usuarios === 1 ? 'usuário' : 'usuários'}</small></td>
      <td class="num">${atual ? '' : btn('Entrar', 'nv-usar', f.id, 'secondary')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function cartaoSistema() {
  return `<article class="card panel"><h3>Administração do sistema</h3>
    <p>Você é o <b>Admin do sistema</b>: vê todas as fazendas, entra em qualquer uma como ADM e gerencia os usuários de todas.${nvVinculado() ? '' : ' Sem fazenda aberta, o que você lançar fica só neste aparelho.'}</p>
    <div id="nvTodas">${nvListaTodas()}</div>
    <div class="form" style="margin-top:12px"><div class="field full"><label for="nvs_fazenda">Nova fazenda</label><input id="nvs_fazenda" placeholder="Ex.: Fazenda Boa Vista"></div></div>
    <div class="btn-row">${btn('Criar fazenda', 'nv-nova')}${nvVinculado() ? btn('Fechar a fazenda aberta', 'nv-sys-fechar', '', 'secondary') : btn('Sair da conta', 'nv-sair', '', 'secondary')}</div></article>`;
}

// Cartão da nuvem antes do cartão de sincronização por arquivo (que continua valendo para quem não tem internet)
const cartaoSincronizacaoArquivo = cartaoSincronizacao;
// Com a nuvem ligada, os dados só circulam pelo envio automático (a troca por arquivo fica para quem usa sem conta)
cartaoSincronizacao = () => cartaoNuvem() + (nv.sessao ? '' : cartaoSincronizacaoArquivo());
const cadastrosAfterSemNuvem = VIEWS.cadastros.after;
VIEWS.cadastros.after = arg => {
  cadastrosAfterSemNuvem?.(arg);
  if (nvPapel() === 'admin' && nvUsuarios === null) nvCarregarUsuarios();
  if (nv.sysadm && nv.sessao && nvTodas === null) nvCarregarTodas();
  $$('[data-nv-nivel]').forEach(s => { s.onchange = () => nvMudarNivel(s.dataset.nvNivel, s.value); });
  nvMostrar();
};
function nvAntesDeTrocar() {
  const faltam = nvFaltamEnviar();
  if (!faltam) return true;
  showToast(`Aguarde: ${faltam} ${faltam === 1 ? 'alteração ainda não foi enviada' : 'alterações ainda não foram enviadas'} para a nuvem. Conecte à internet; o envio é automático.`, true);
  if (navigator.onLine !== false) nvSincronizar();
  return false;
}
Object.assign(ACTIONS, {
  'nv-entrar': nvEntrar, 'nv-sair': nvSair, 'nv-nova': nvCriarFazenda,
  'nv-usar': id => { const f = (nvFazendas || []).find(x => x.id === id); if (f) nvVincular(f); },
  'nv-trocar': () => nvAntesDeTrocar() && confirmDialog('Trocar de fazenda? Você vai escolher outra fazenda desta conta; os dados deste aparelho continuam guardados na nuvem da fazenda atual.', () => { nvEsquecerFazenda(); nvTodas = null; nvSalvar(); nvPortao(); if (nv.sysadm) go('cadastros'); }, 'Trocar'),
  'nv-sys-fechar': () => nvAntesDeTrocar() && confirmDialog(`Fechar “${nv.fazenda?.name}” neste aparelho? Você continua conectado como Admin do sistema e pode entrar em outra fazenda.`, () => { nvEsquecerFazenda(); nvTodas = null; nvSalvar(); nvPortao(); }, 'Fechar'),
  'nv-u-novo': nvNovoUsuario, 'nv-u-acesso': nvAcessoUsuario, 'nv-u-senha': nvNovaSenha, 'nv-u-remover': nvRemoverUsuario
});
nvProteger();
