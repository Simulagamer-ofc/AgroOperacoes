-- Agro Operações — banco de dados no Supabase.
-- Rode este arquivo inteiro uma vez no SQL Editor do projeto (pode rodar de novo sem problema).
--
-- Modelo: cada fazenda tem membros (usuários). Todos os registros do app ficam na
-- tabela "records", um por linha, com o conteúdo em JSON. As regras de segurança (RLS)
-- garantem que cada usuário só lê e grava dados das fazendas de que participa.

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.farm_members (
  farm_id uuid not null references public.farms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create sequence if not exists public.records_seq;

create table if not exists public.records (
  farm_id uuid not null references public.farms (id) on delete cascade,
  store text not null check (store in ('operations', 'machines', 'hourmeterLogs', 'maintenance', 'fields', 'productions', 'lots', 'stockItems', 'stockMoves')),
  id text not null check (char_length(id) between 1 and 100),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  deleted boolean not null default false,
  seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (farm_id, store, id)
);

create index if not exists records_farm_seq on public.records (farm_id, seq);

-- Numeração das alterações. A trava por fazenda faz a ordem dos números seguir a ordem
-- de gravação, para que nenhum aparelho pule uma alteração ao sincronizar.
create or replace function public.records_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.farm_id::text));
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

create or replace function public.is_farm_member(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid())
$$;

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.records enable row level security;

drop policy if exists farms_read on public.farms;
create policy farms_read on public.farms for select to authenticated using (public.is_farm_member(id));
drop policy if exists farms_rename on public.farms;
create policy farms_rename on public.farms for update to authenticated using (public.is_farm_member(id)) with check (public.is_farm_member(id));

drop policy if exists members_read on public.farm_members;
create policy members_read on public.farm_members for select to authenticated using (public.is_farm_member(farm_id));

drop policy if exists records_rw on public.records;
create policy records_rw on public.records for all to authenticated
  using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id));

-- Criar fazenda (quem cria vira dono) e entrar numa fazenda pelo código.
create or replace function public.create_farm(p_name text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  insert into public.farms (name, created_by) values (trim(p_name), auth.uid()) returning * into f;
  insert into public.farm_members (farm_id, user_id, role) values (f.id, auth.uid(), 'owner');
  return f;
end $$;

create or replace function public.join_farm(p_code text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  select * into f from public.farms where join_code = upper(trim(p_code));
  if not found then raise exception 'Código de fazenda não encontrado. Confira as letras e números.'; end if;
  insert into public.farm_members (farm_id, user_id, role) values (f.id, auth.uid(), 'member') on conflict do nothing;
  return f;
end $$;

-- Permissões: só usuários logados, e só pelo caminho acima.
revoke all on public.farms, public.farm_members, public.records from anon;
revoke all on function public.create_farm(text), public.join_farm(text), public.is_farm_member(uuid), public.records_touch() from public, anon;
grant select, update (name) on public.farms to authenticated;
grant select on public.farm_members to authenticated;
grant select, insert, update on public.records to authenticated;
grant usage on sequence public.records_seq to authenticated;
grant execute on function public.create_farm(text), public.join_farm(text), public.is_farm_member(uuid) to authenticated;
