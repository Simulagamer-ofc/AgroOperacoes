-- Notas da SEFAZ com certificado A3 (token USB ou cartão) — 0.99.
-- No A3 a chave não sai do aparelho: quem fala com a SEFAZ é o MercaPlant Conecta, no computador da fazenda onde o
-- token/cartão está. O servidor prepara as mensagens, recebe as respostas e processa igual ao A1.

alter table public.sefaz_config add column if not exists modo text not null default 'a1' check (modo in ('a1', 'a3'));
-- No A3 o CNPJ/CPF só é conhecido quando o Conecta envia o certificado escolhido
alter table public.sefaz_config alter column doc drop not null;
alter table public.sefaz_config alter column tipo_doc drop not null;

-- Ligação do Conecta com a fazenda (só o servidor lê: guarda os resumos SHA-256 do código e da chave do computador)
create table if not exists public.sefaz_conecta (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  codigo_hash text,                 -- código de ligação gerado pelo ADM (vale 15 min, uso único)
  codigo_expira timestamptz,
  token_hash text unique,           -- chave do computador ligado
  ligado_em timestamptz,
  visto_em timestamptz,             -- último contato do Conecta
  computador text,
  versao text,
  ult_erro text,
  ult_erro_em timestamptz,
  ult_ciencia_em timestamptz,       -- último lote de ciência (não insiste mais que a cada 30 min)
  atualizado_em timestamptz not null default now()
);
alter table public.sefaz_conecta enable row level security;
revoke all on public.sefaz_conecta from anon, authenticated;
grant all on public.sefaz_conecta to service_role;
