-- MercaPlant — bases oficiais do MAPA para o Edy (dados abertos, sem chave): Agrofit e ZARC.
-- A função dados-oficiais baixa os arquivos do Portal de Dados Abertos do MAPA em pedaços (um por vez, a cada minuto,
-- pelo pg_cron) e guarda só o que o Edy usa. Só o servidor lê e grava: RLS ligada e sem políticas.

-- Agrofit: o que está registrado para cada cultura × alvo (sem marca e sem concentração/dose)
create table if not exists public.agrofit (
  versao text not null,
  chave text not null,
  cultura text not null, cultura_n text not null,
  alvo_comum text not null default '', alvo_cientifico text not null default '', alvo_n text not null default '',
  ingrediente text not null, classe text not null default '', modo_acao text not null default '',
  organico boolean not null default false,
  produtos int not null default 0,
  primary key (versao, chave)
);
create index if not exists agrofit_cultura on public.agrofit (versao, cultura_n);
alter table public.agrofit enable row level security;
revoke all on table public.agrofit from anon, authenticated;

-- ZARC: janelas de plantio por município, cultura, ciclo, solo e manejo (decs: 36 decêndios; 0 fora, 2/3/4 = risco 20/30/40%)
create table if not exists public.zarc (
  versao text not null,
  chave text not null,
  safra text not null, geocodigo int not null, uf text not null, municipio text not null, municipio_n text not null,
  cultura text not null, cultura_n text not null, ciclo smallint, solo smallint, manejo text not null default '', clima text not null default '',
  portaria text not null default '', decs text not null,
  primary key (versao, chave)
);
create index if not exists zarc_municipio on public.zarc (versao, geocodigo, cultura_n);
create index if not exists zarc_nome on public.zarc (versao, uf, municipio_n);
alter table public.zarc enable row level security;
revoke all on table public.zarc from anon, authenticated;

-- Andamento de cada importação (qual arquivo, até onde leu, versão no ar)
create table if not exists public.dados_oficiais (
  fonte text primary key,
  url text, total bigint, proximo bigint not null default 0, linhas bigint not null default 0,
  versao text, atual text, colunas text, iniciado timestamptz, concluido timestamptz, atualizado timestamptz not null default now(),
  rodando_ate timestamptz, erro text
);
alter table public.dados_oficiais enable row level security;
revoke all on table public.dados_oficiais from anon, authenticated;

-- Chave que o agendador manda para a função (só o banco e o servidor conhecem)
create table if not exists public.dados_oficiais_chave (token text primary key);
alter table public.dados_oficiais_chave enable row level security;
revoke all on table public.dados_oficiais_chave from anon, authenticated;
insert into public.dados_oficiais_chave (token)
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where not exists (select 1 from public.dados_oficiais_chave);

-- Soma os registros do Agrofit de um pedaço (o mesmo ingrediente aparece em vários produtos)
create or replace function public.agrofit_somar(p_linhas jsonb) returns int
language sql security definer set search_path = public as $$
  with x as (
    insert into public.agrofit as a (versao, chave, cultura, cultura_n, alvo_comum, alvo_cientifico, alvo_n, ingrediente, classe, modo_acao, organico, produtos)
    select versao, chave, cultura, cultura_n, alvo_comum, alvo_cientifico, alvo_n, ingrediente, classe, modo_acao, organico, produtos
    from jsonb_to_recordset(p_linhas) as r(versao text, chave text, cultura text, cultura_n text, alvo_comum text, alvo_cientifico text, alvo_n text,
      ingrediente text, classe text, modo_acao text, organico boolean, produtos int)
    on conflict (versao, chave) do update set produtos = a.produtos + excluded.produtos, organico = a.organico or excluded.organico
    returning 1)
  select count(*)::int from x;
$$;
revoke all on function public.agrofit_somar(jsonb) from public, anon, authenticated;

-- Agendador: a cada minuto chama a função (ela só trabalha se tiver importação em andamento ou vencida)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('dados-oficiais') where exists (select 1 from cron.job where jobname = 'dados-oficiais');
select cron.schedule('dados-oficiais', '* * * * *', $cron$
  select net.http_post(
    url := 'https://gfvtudfdhooavcchdpnm.supabase.co/functions/v1/dados-oficiais',
    body := '{"acao":"passo"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK',
      'x-dados-chave', (select token from public.dados_oficiais_chave limit 1)),
    timeout_milliseconds := 150000);
$cron$);
