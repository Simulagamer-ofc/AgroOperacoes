-- MercaPlant — uso da IA (Gemini): quantas leituras cada pessoa fez no dia e os tokens gastos.
-- Só o servidor (função ia, com a chave secreta) lê e grava: RLS ligada e sem políticas.
create table if not exists public.ia_uso (
  user_id uuid not null,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  farm_id uuid,
  n int not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, dia)
);
alter table public.ia_uso enable row level security;

-- Soma 1 no dia e devolve o total; -1 se já passou do limite (não soma)
create or replace function public.ia_contar(p_user uuid, p_farm uuid, p_limite int) returns int
language plpgsql security definer set search_path = public as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date; v_n int;
begin
  insert into public.ia_uso as u (user_id, dia, farm_id, n) values (p_user, v_dia, p_farm, 1)
  on conflict (user_id, dia) do update set n = u.n + 1, farm_id = excluded.farm_id, atualizado_em = now()
    where u.n < p_limite
  returning n into v_n;
  return coalesce(v_n, -1);
end $$;

create or replace function public.ia_tokens(p_user uuid, p_entrada bigint, p_saida bigint) returns void
language sql security definer set search_path = public as $$
  update public.ia_uso set tokens_entrada = tokens_entrada + greatest(p_entrada, 0), tokens_saida = tokens_saida + greatest(p_saida, 0), atualizado_em = now()
  where user_id = p_user and dia = (now() at time zone 'America/Sao_Paulo')::date;
$$;

revoke all on function public.ia_contar(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.ia_tokens(uuid, bigint, bigint) from public, anon, authenticated;
revoke all on table public.ia_uso from anon, authenticated;

-- Código de teste temporário do servidor (para conferir a IA sem usuário); só o servidor lê; vence sozinho
create table if not exists public.ia_teste (token text primary key, expira timestamptz not null);
alter table public.ia_teste enable row level security;
revoke all on table public.ia_teste from anon, authenticated;
