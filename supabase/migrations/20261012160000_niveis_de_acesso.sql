-- Níveis de acesso do Nexus Agro: admin (ADM), supervisor, member (usuário comum)
-- ADM: tudo + usuários. Supervisor: lança, edita e exclui tudo, vê o financeiro. Comum: lança no dia a dia,
-- não exclui e não recebe o financeiro (despesas, contas, vendas).
alter table public.farm_members add column if not exists nome text, add column if not exists login text;
update public.farm_members set role = 'admin' where role = 'owner';
alter table public.farm_members alter column role set default 'member';
alter table public.farm_members drop constraint if exists farm_members_role_chk;
alter table public.farm_members add constraint farm_members_role_chk check (role in ('admin', 'supervisor', 'member'));
alter table public.records add column if not exists created_by uuid default auth.uid();

create or replace function public.farm_role(p_farm uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.farm_members where farm_id = p_farm and user_id = auth.uid()
$$;
create or replace function public.is_fin_store(p_store text) returns boolean
language sql immutable set search_path = public as $$ select p_store in ('expenses', 'contas', 'vendas') $$;

-- Leitura: comum não recebe o financeiro
drop policy if exists records_rw on public.records;
drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated
  using (public.farm_role(farm_id) in ('admin', 'supervisor') or (public.farm_role(farm_id) = 'member' and not public.is_fin_store(store)));
-- Escrita só pela função push_records (regras por nível, registro a registro)
revoke insert, update, delete, truncate on public.records from authenticated;

create or replace function public.push_records(p_farm uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := public.farm_role(p_farm); r jsonb; v_store text; v_id text; v_del boolean; v_existe boolean; v_rej jsonb := '[]'::jsonb;
begin
  if v_role is null then raise exception 'Sem permissão nesta fazenda.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_store := r->>'store'; v_id := r->>'id'; v_del := coalesce((r->>'deleted')::boolean, false);
    if v_store is null or v_id is null then continue; end if;
    if v_role = 'member' then
      select exists (select 1 from public.records where farm_id = p_farm and store = v_store and id = v_id) into v_existe;
      -- Comum não exclui e não altera lançamentos financeiros já existentes (pode criar os gerados pelo app, ex.: mão de obra)
      if v_del or (public.is_fin_store(v_store) and v_existe) then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
    end if;
    insert into public.records (farm_id, store, id, data, deleted, created_by)
      values (p_farm, v_store, v_id, coalesce(r->'data', '{}'::jsonb), v_del, auth.uid())
      on conflict (farm_id, store, id) do update set data = excluded.data, deleted = excluded.deleted;
  end loop;
  return v_rej;
end $$;
revoke execute on function public.push_records(uuid, jsonb) from public, anon;
grant execute on function public.push_records(uuid, jsonb) to authenticated;
revoke execute on function public.farm_role(uuid) from public, anon;
grant execute on function public.farm_role(uuid) to authenticated;

-- Quem cria a fazenda é o ADM
create or replace function public.create_farm(p_name text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Dê um nome para a fazenda.'; end if;
  insert into public.farms (name, created_by) values (trim(p_name), auth.uid()) returning * into f;
  insert into public.farm_members (farm_id, user_id, role, login, nome)
    values (f.id, auth.uid(), 'admin', auth.jwt()->>'email', split_part(auth.jwt()->>'email', '@', 1));
  return f;
end $$;
-- Entrada só por usuário criado pelo ADM (o código de convite deixa de dar acesso)
drop function if exists public.join_farm(text);

-- Fazenda: só o ADM renomeia; membros: só leitura pelo app (o ADM gerencia pela função "usuarios")
drop policy if exists farms_rename on public.farms;
create policy farms_rename on public.farms for update to authenticated
  using (public.farm_role(id) = 'admin') with check (public.farm_role(id) = 'admin');
revoke insert, update, delete, truncate on public.farms from authenticated;
grant update (name) on public.farms to authenticated;
revoke insert, update, delete, truncate on public.farm_members from authenticated;
