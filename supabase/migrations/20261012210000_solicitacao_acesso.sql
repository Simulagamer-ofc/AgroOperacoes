-- Acesso por solicitação: a pessoa pede (com o código da fazenda e a senha que ela escolhe) e o ADM autoriza.
-- Situação de cada pessoa na fazenda: pendente (aguardando o ADM), ativo ou inativo (desativado pelo ADM).
alter table public.farm_members
  add column if not exists status text not null default 'ativo',
  add column if not exists ultimo_acesso timestamptz,
  add column if not exists pedido_em timestamptz;
alter table public.farm_members drop constraint if exists farm_members_status_chk;
alter table public.farm_members add constraint farm_members_status_chk check (status in ('pendente', 'ativo', 'inativo'));

-- Regra antiga da primeira versão (só 'owner'/'member') ainda existia com outro nome e barrava ADM e Supervisor
alter table public.farm_members drop constraint if exists farm_members_role_check;

-- Só quem está ativo (ou o Admin do sistema) participa da fazenda
create or replace function public.is_farm_member(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo') or public.is_system_admin()
$$;
create or replace function public.farm_role(p_farm uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'),
    case when public.is_system_admin() and exists (select 1 from public.farms where id = p_farm) then 'admin' end)
$$;
create or replace function public.tem_modulo(p_farm uuid, p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select modulos is null or p_modulo = any(modulos) from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'), false)
$$;
create or replace function public.ve_financeiro(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.farm_role(p_farm) in ('admin', 'supervisor')
    or exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo' and modulos && array['financeiro', 'producao'])
$$;

-- Situação da própria pessoa em cada fazenda (para mostrar "aguardando autorização" ou "acesso desativado")
create or replace function public.meu_acesso() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('farm_id', m.farm_id, 'fazenda', f.name, 'status', m.status)), '[]'::jsonb)
  from public.farm_members m join public.farms f on f.id = m.farm_id where m.user_id = auth.uid()
$$;
-- Último acesso (só a própria linha, só se ativo)
create or replace function public.registrar_acesso(p_farm uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.farm_members set ultimo_acesso = now() where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'
$$;
-- Novo código da fazenda (o antigo deixa de valer para novas solicitações)
create or replace function public.novo_codigo(p_farm uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare c text;
begin
  if public.farm_role(p_farm) is distinct from 'admin' then raise exception 'Só o ADM da fazenda gera um novo código.'; end if;
  update public.farms set join_code = upper(substr(md5(gen_random_uuid()::text), 1, 8)) where id = p_farm returning join_code into c;
  return c;
end $$;
revoke execute on function public.meu_acesso(), public.registrar_acesso(uuid), public.novo_codigo(uuid) from public, anon;
grant execute on function public.meu_acesso(), public.registrar_acesso(uuid), public.novo_codigo(uuid) to authenticated;

-- Encerra as sessões de uma pessoa (desativada, removida ou com senha provisória). Só o servidor (função usuarios) chama.
create or replace function public.encerrar_sessoes(p_user uuid) returns void
language sql volatile security definer set search_path = public, auth as $$
  delete from auth.sessions where user_id = p_user
$$;
revoke execute on function public.encerrar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.encerrar_sessoes(uuid) to service_role;
