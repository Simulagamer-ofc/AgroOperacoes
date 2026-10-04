// Servidor de sincronização (Supabase). Preencha com os dados do projeto em
// Project Settings → API: "Project URL" e a chave "anon public".
// A chave anon é pública por natureza; quem protege os dados são as regras do banco
// (supabase/schema.sql). Vazio = sincronização desligada até ser configurada no app.
export const SYNC_CONFIG = {
  url: '',
  anonKey: '',
};

// Endereço do site, mostrado na versão incorporada (link do claude.ai).
export const SITE_URL = 'https://simulagamer-ofc.github.io/AgroOperacoes/';
