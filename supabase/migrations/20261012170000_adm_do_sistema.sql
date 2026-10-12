-- ADM do sistema: entra sem fazenda e tem controle total (todas as fazendas e usuários)
create table if not exists public.system_admins (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table public.system_admins enable row level security;
drop policy if exists sysadm_self on public.system_admins;
create policy sysadm_self on public.system_admins for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.system_admins from anon, authenticated;
grant select on public.system_admins to authenticated;

create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.system_admins where user_id = auth.uid())
$$;
revoke execute on function public.is_system_admin() from public, anon;
grant execute on function public.is_system_admin() to authenticated;

-- O ADM do sistema enxerga todas as fazendas e age como ADM em qualquer uma
create or replace function public.is_farm_member(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid()) or public.is_system_admin()
$$;
create or replace function public.farm_role(p_farm uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.farm_members where farm_id = p_farm and user_id = auth.uid()),
    case when public.is_system_admin() and exists (select 1 from public.farms where id = p_farm) then 'admin' end)
$$;

-- Conta do ADM do sistema (para incluir outra pessoa: insert into public.system_admins (user_id) select id from auth.users where email = '...';)
insert into public.system_admins (user_id) select id from auth.users where email = 'edsonhsr@hotmail.com' on conflict do nothing;
