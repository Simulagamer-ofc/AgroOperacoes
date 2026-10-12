// Gerenciamento de usuários da fazenda pelo ADM do Nexus Agro.
// O ADM cria login e senha para cada pessoa (sem precisar de e-mail), define o nível, troca a senha e remove.
// Publicar com verify_jwt = false: a função confere o login do ADM aqui dentro.
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMINIO = "usuarios.nexusagro.app"; // e-mail interno de quem entra só com nome de usuário
const NIVEIS = ["admin", "supervisor", "member"];
// Telas que podem ser liberadas por função (as mesmas do app)
const TELAS = ["operacoes", "talhoes", "chuva", "pragas", "aplicacoes", "maodeobra", "maquinas", "combustivel", "afericao", "catalogo", "pontas", "secagem", "sementes", "estoque", "financeiro", "producao", "relatorios"];
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
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: quem } = await adm.auth.getUser(token);
    const eu = quem?.user;
    if (!eu) return erro(401, "Sua sessão expirou. Entre de novo na conta.");

    const b = await req.json().catch(() => ({}));
    const fazenda = String(b.farm_id || "");
    const { data: meu } = await adm.from("farm_members").select("role").eq("farm_id", fazenda).eq("user_id", eu.id).maybeSingle();
    // ADM do sistema gerencia os usuários de qualquer fazenda
    const { data: sistema } = await adm.from("system_admins").select("user_id").eq("user_id", eu.id).maybeSingle();
    const { data: existe } = await adm.from("farms").select("id").eq("id", fazenda).maybeSingle();
    if (!existe) return erro(404, "Fazenda não encontrada.");
    if (meu?.role !== "admin" && !sistema) return erro(403, "Só o ADM da fazenda pode gerenciar usuários.");

    const alvo = String(b.user_id || "");
    const membroAlvo = async () => {
      const { data } = await adm.from("farm_members").select("user_id, role, login").eq("farm_id", fazenda).eq("user_id", alvo).maybeSingle();
      return data;
    };

    switch (b.acao) {
      case "criar": {
        const login = String(b.login || "").trim().toLowerCase();
        const nome = String(b.nome || "").trim() || login;
        const senha = String(b.senha || "");
        const papel = String(b.papel || "member");
        if (!loginValido(login)) return erro(400, "Usuário: de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado (ex.: joao.silva).");
        if (senha.length < 8) return erro(400, "A senha precisa ter pelo menos 8 caracteres.");
        if (!NIVEIS.includes(papel)) return erro(400, "Nível inválido.");
        const funcao = b.funcao ? String(b.funcao).slice(0, 40) : null;
        const modulos = lerModulos(b.modulos);
        if (modulos === undefined) return erro(400, "Marque pelo menos uma tela válida.");
        const { data: novo, error } = await adm.auth.admin.createUser({ email: emailDoLogin(login), password: senha, email_confirm: true, user_metadata: { nome, login } });
        if (error || !novo.user) {
          if (/already|exists|registered/i.test(error?.message || "")) return erro(409, `O usuário “${login}” já existe. Escolha outro (ex.: ${login}.${Math.floor(Math.random() * 90 + 10)}).`);
          if (/pwned|leaked|compromised/i.test(error?.message || "")) return erro(400, "Esta senha já apareceu em vazamentos na internet. Escolha outra.");
          return erro(400, error?.message || "Não foi possível criar o usuário.");
        }
        let { error: e2 } = await adm.from("farm_members").insert({ farm_id: fazenda, user_id: novo.user.id, role: papel, nome, login, funcao, modulos });
        // Banco ainda sem as colunas de função: cria sem elas
        if (e2 && /funcao|modulos/.test(e2.message)) ({ error: e2 } = await adm.from("farm_members").insert({ farm_id: fazenda, user_id: novo.user.id, role: papel, nome, login }));
        if (e2) { await adm.auth.admin.deleteUser(novo.user.id); return erro(400, e2.message); }
        return resposta(200, { user_id: novo.user.id, login, nome, role: papel });
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
        if (error) return erro(400, /funcao|modulos/.test(error.message) ? "O banco ainda não tem as funções. Rode a atualização do banco (funções) no Supabase." : error.message);
        return resposta(200, { ok: true });
      }
      case "senha": {
        const senha = String(b.senha || "");
        if (senha.length < 8) return erro(400, "A senha precisa ter pelo menos 8 caracteres.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        const { data: u } = await adm.auth.admin.getUserById(alvo);
        if (!criadoPeloApp(u?.user?.email) && alvo !== eu.id) return erro(400, "Este usuário entra com o próprio e-mail; a senha só pode ser trocada por ele.");
        const { error } = await adm.auth.admin.updateUserById(alvo, { password: senha });
        if (error) return erro(400, /pwned|leaked|compromised/i.test(error.message) ? "Esta senha já apareceu em vazamentos na internet. Escolha outra." : error.message);
        return resposta(200, { ok: true });
      }
      case "remover": {
        if (alvo === eu.id) return erro(400, "Você não pode remover a si mesmo.");
        if (!(await membroAlvo())) return erro(404, "Usuário não encontrado nesta fazenda.");
        await adm.from("farm_members").delete().eq("farm_id", fazenda).eq("user_id", alvo);
        // Login criado pelo app e sem outra fazenda: apaga a conta de vez
        const { data: u } = await adm.auth.admin.getUserById(alvo);
        const { count } = await adm.from("farm_members").select("farm_id", { count: "exact", head: true }).eq("user_id", alvo);
        if (criadoPeloApp(u?.user?.email) && !count) await adm.auth.admin.deleteUser(alvo);
        return resposta(200, { ok: true });
      }
      default:
        return erro(400, "Ação desconhecida.");
    }
  } catch (e) {
    return erro(500, (e as Error).message || "Erro inesperado.");
  }
});
