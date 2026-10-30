// Usuários das fazendas do Nexus Agro.
// A pessoa PEDE o acesso (nome, usuário, a senha que ela escolhe e o código da fazenda) e o ADM autoriza ou recusa.
// O ADM também define função e nível, desativa/reativa, gera senha provisória (a pessoa troca no próximo login) e remove.
// Cada pessoa troca a própria senha em "Minha conta".
// Publicar com verify_jwt = false: "solicitar" é feito antes do login; as outras ações conferem o login aqui dentro.
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMINIO = "usuarios.nexusagro.app"; // e-mail interno de quem entra só com nome de usuário
const NIVEIS = ["admin", "supervisor", "member"];
const MAX_PENDENTES = 30; // pedidos aguardando por fazenda (evita abuso com um código vazado)
// Telas que podem ser liberadas por função (as mesmas do app)
const TELAS = ["operacoes", "talhoes", "chuva", "pragas", "aplicacoes", "maodeobra", "maquinas", "combustivel", "afericao", "catalogo", "pontas", "secagem", "sementes", "estoque", "compras", "financeiro", "producao", "relatorios"];
// null = todas as telas; lista = só as telas válidas, sem repetir
function lerModulos(v: unknown): string[] | null | undefined {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return undefined;
  const l = [...new Set(v.map(String).filter((t) => TELAS.includes(t)))];
  return l.length ? l : undefined;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const erro = (status: number, message: string) => resposta(status, { message });
const erroSenha = (m: string) => /pwned|leaked|compromised/i.test(m) ? "Esta senha já apareceu em vazamentos na internet. Escolha outra."
  : /weak|at least/i.test(m) ? "Senha fraca: use pelo menos 8 caracteres, misturando letras e números." : m;

function chaveSecreta() {
  try {
    const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
    if (k) return k;
  } catch { /* usa a chave antiga */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const loginValido = (l: string) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(l);
const emailDoLogin = (l: string) => `${l}@${DOMINIO}`;
const criadoPeloApp = (email?: string) => !!email && email.endsWith("@" + DOMINIO);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return erro(405, "Use POST.");
  const adm = createClient(Deno.env.get("SUPABASE_URL")!, chaveSecreta(), { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const b = await req.json().catch(() => ({}));

    // ---------- Pedido de acesso (antes de ter login) ----------
    if (b.acao === "solicitar") {
      const login = String(b.login || "").trim().toLowerCase();
      const nome = String(b.nome || "").trim().slice(0, 80);
      const senha = String(b.senha || "");
      const codigo = String(b.codigo || "").trim().toUpperCase().replace(/\s+/g, "");
      if (!nome) return erro(400, "Digite o seu nome.");
      if (!loginValido(login)) return erro(400, "Usuário: de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado (ex.: joao.silva).");
      if (senha.length < 8) return erro(400, "A senha precisa ter pelo menos 8 caracteres.");
      if (!/^[A-Z0-9]{4,16}$/.test(codigo)) return erro(400, "Código da fazenda inválido. Peça o código ao ADM da fazenda.");
      const { data: f } = await adm.from("farms").select("id, name").eq("join_code", codigo).maybeSingle();
      if (!f) return erro(404, "Código da fazenda não encontrado. Confira com o ADM (o código pode ter sido trocado).");
      const { count } = await adm.from("farm_members").select("user_id", { count: "exact", head: true }).eq("farm_id", f.id).eq("status", "pendente");
      if ((count || 0) >= MAX_PENDENTES) return erro(429, "Esta fazenda tem muitos pedidos aguardando. Peça ao ADM para analisar os pedidos e tente depois.");
      const { data: novo, error } = await adm.auth.admin.createUser({ email: emailDoLogin(login), password: senha, email_confirm: true, user_metadata: { nome, login } });
      if (error || !novo.user) {
        if (/already|exists|registered/i.test(error?.message || "")) return erro(409, `O usuário “${login}” já existe. Escolha outro (ex.: ${login}.${Math.floor(Math.random() * 90 + 10)}).`);
        return erro(400, erroSenha(error?.message || "Não foi possível enviar o pedido."));
      }
      const { error: e2 } = await adm.from("farm_members").insert({ farm_id: f.id, user_id: novo.user.id, role: "member", nome, login, status: "pendente", pedido_em: new Date().toISOString() });
      if (e2) { await adm.auth.admin.deleteUser(novo.user.id); return erro(400, e2.message); }
      return resposta(200, { ok: true, fazenda: f.name, login });
    }

    // ---------- Daqui em diante, só com login ----------
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: quem } = await adm.auth.getUser(token);
    const eu = quem?.user;
    if (!eu) return erro(401, "Sua sessão expirou. Entre de novo na conta.");

    // Cada pessoa troca a própria senha (e deixa de ser obrigada a trocar, depois de uma senha provisória)
    if (b.acao === "minha_senha") {
      const nova = String(b.nova || "");
      if (nova.length < 8) return erro(400, "A senha precisa ter pelo menos 8 caracteres.");
      const { error } = await adm.auth.admin.updateUserById(eu.id, { password: nova, app_metadata: { ...(eu.app_metadata || {}), trocar_senha: false } });
      if (error) return erro(400, erroSenha(error.message));
      return resposta(200, { ok: true });
    }

    const fazenda = String(b.farm_id || "");
    const { data: existe } = await adm.from("farms").select("id").eq("id", fazenda).maybeSingle();
    if (!existe) return erro(404, "Fazenda não encontrada.");
    const { data: meu } = await adm.from("farm_members").select("role, status").eq("farm_id", fazenda).eq("user_id", eu.id).maybeSingle();
    // ADM do sistema gerencia os usuários de qualquer fazenda
    const { data: sistema } = await adm.from("system_admins").select("user_id").eq("user_id", eu.id).maybeSingle();
    if (!(meu?.role === "admin" && meu?.status === "ativo") && !sistema) return erro(403, "Só o ADM da fazenda pode gerenciar usuários.");

    const alvo = String(b.user_id || "");
    const membroAlvo = async () => {
      const { data } = await adm.from("farm_members").select("user_id, role, login, status").eq("farm_id", fazenda).eq("user_id", alvo).maybeSingle();
      return data;
    };
    // Encerra as sessões abertas da pessoa: os aparelhos dela deixam de sincronizar e pedem login de novo
    const encerrar = async () => { await adm.rpc("encerrar_sessoes", { p_user: alvo }); };
    // Apaga a conta criada pelo app quando ela não participa de mais nenhuma fazenda
    const apagarSeSobrou = async () => {
      const { data: u } = await adm.auth.admin.getUserById(alvo);
      const { count } = await adm.from("farm_members").select("farm_id", { count: "exact", head: true }).eq("user_id", alvo);
      if (criadoPeloApp(u?.user?.email) && !count) await adm.auth.admin.deleteUser(alvo);
    };

    switch (b.acao) {
      case "autorizar": {
        const papel = String(b.papel || "member");
        if (!NIVEIS.includes(papel)) return erro(400, "Nível inválido.");
        const funcao = b.funcao ? String(b.funcao).slice(0, 40) : null;
        const modulos = lerModulos(b.modulos);
        if (modulos === undefined) return erro(400, "Marque pelo menos uma tela válida.");
        const m = await membroAlvo();
        if (!m) return erro(404, "Pedido não encontrado (pode ter sido cancelado).");
        if (m.status !== "pendente") return erro(400, "Este pedido já foi analisado.");
        const { error } = await adm.from("farm_members").update({ status: "ativo", role: papel, funcao, modulos }).eq("farm_id", fazenda).eq("user_id", alvo);
        if (error) return erro(400, error.message);
        return resposta(200, { ok: true });
      }
      case "recusar": {
        const m = await membroAlvo();
        if (!m) return erro(404, "Pedido não encontrado.");
        if (m.status !== "pendente") return erro(400, "Este pedido já foi analisado. Para tirar o acesso, use Desativar ou Remover.");
        await adm.from("farm_members").delete().eq("farm_id", fazenda).eq("user_id", alvo);
        await apagarSeSobrou();
        return resposta(200, { ok: true });
      }
      case "status": {
        const status = String(b.status || "");
        if (!["ativo", "inativo"].includes(status)) return erro(400, "Situação inválida.");
        if (alvo === eu.id) return erro(400, "Você não pode desativar a si mesmo.");
        const m = await membroAlvo();
        if (!m) return erro(404, "Usuário não encontrado nesta fazenda.");
        if (m.status === "pendente") return erro(400, "Pedido ainda não autorizado: use Autorizar ou Recusar.");
        const { error } = await adm.from("farm_members").update({ status }).eq("farm_id", fazenda).eq("user_id", alvo);
        if (error) return erro(400, error.message);
        // Desativado: encerra as sessões abertas (os aparelhos dele deixam de sincronizar na hora)
        if (status === "inativo") await encerrar();
        return resposta(200, { ok: true });
      }
      case "nivel": {
        const papel = String(b.papel || "");
        if (!NIVEIS.includes(papel)) return erro(400, "Nível inválido.");
        if (alvo === eu.id) return erro(400, "Você não pode mudar o seu próprio nível (a fazenda ficaria sem ADM). Peça para outro ADM.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        const { error } = await adm.from("farm_members").update({ role: papel }).eq("farm_id", fazenda).eq("user_id", alvo);
        if (error) return erro(400, error.message);
        return resposta(200, { ok: true });
      }
      case "acesso": {
        const funcao = b.funcao ? String(b.funcao).slice(0, 40) : null;
        const modulos = lerModulos(b.modulos);
        if (modulos === undefined) return erro(400, "Marque pelo menos uma tela válida.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        const { error } = await adm.from("farm_members").update({ funcao, modulos }).eq("farm_id", fazenda).eq("user_id", alvo);
        if (error) return erro(400, error.message);
        return resposta(200, { ok: true });
      }
      case "senha": {
        // Senha provisória: a pessoa é obrigada a criar a dela no próximo login
        const senha = String(b.senha || "");
        if (senha.length < 8) return erro(400, "A senha precisa ter pelo menos 8 caracteres.");
        if (alvo === eu.id) return erro(400, "Para trocar a sua senha, use “Minha conta”.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        const { data: u } = await adm.auth.admin.getUserById(alvo);
        if (!criadoPeloApp(u?.user?.email)) return erro(400, "Este usuário entra com o próprio e-mail: ele recupera a senha pelo link “Esqueci minha senha”.");
        const { error } = await adm.auth.admin.updateUserById(alvo, { password: senha, app_metadata: { ...(u?.user?.app_metadata || {}), trocar_senha: true } });
        if (error) return erro(400, erroSenha(error.message));
        await encerrar();
        return resposta(200, { ok: true });
      }
      case "remover": {
        if (alvo === eu.id) return erro(400, "Você não pode remover a si mesmo.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        await adm.from("farm_members").delete().eq("farm_id", fazenda).eq("user_id", alvo);
        await encerrar();
        await apagarSeSobrou();
        return resposta(200, { ok: true });
      }
      default:
        return erro(400, "Ação desconhecida.");
    }
  } catch (e) {
    return erro(500, (e as Error).message || "Erro inesperado.");
  }
});
