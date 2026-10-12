-- Funções: cada pessoa vê as telas da sua função (modulos = telas liberadas; null = todas)
alter table public.farm_members add column if not exists funcao text, add column if not exists modulos text[];

-- A pessoa tem a tela liberada nesta fazenda?
create or replace function public.tem_modulo(p_farm uuid, p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select modulos is null or p_modulo = any(modulos) from public.farm_members where farm_id = p_farm and user_id = auth.uid()), false)
$$;
revoke execute on function public.tem_modulo(uuid, text) from public, anon;
grant execute on function public.tem_modulo(uuid, text) to authenticated;

-- Financeiro: supervisor e ADM sempre; usuário comum só com Financeiro ou Produção liberados na função
create or replace function public.ve_financeiro(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.farm_role(p_farm) in ('admin', 'supervisor')
    or exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and modulos && array['financeiro', 'producao'])
$$;
revoke execute on function public.ve_financeiro(uuid) from public, anon;
grant execute on function public.ve_financeiro(uuid) to authenticated;

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated
  using (public.farm_role(farm_id) is not null and (not public.is_fin_store(store) or public.ve_financeiro(farm_id)));

create or replace function public.push_records(p_farm uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := public.farm_role(p_farm); v_fin boolean := public.ve_financeiro(p_farm);
  r jsonb; v_store text; v_id text; v_del boolean; v_existe boolean; v_rej jsonb := '[]'::jsonb;
begin
  if v_role is null then raise exception 'Sem permissão nesta fazenda.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_store := r->>'store'; v_id := r->>'id'; v_del := coalesce((r->>'deleted')::boolean, false);
    if v_store is null or v_id is null then continue; end if;
    if v_role = 'member' then
      select exists (select 1 from public.records where farm_id = p_farm and store = v_store and id = v_id) into v_existe;
      -- Comum não exclui; lançamento financeiro já existente só com o financeiro liberado na função
      if v_del or (public.is_fin_store(v_store) and v_existe and not v_fin) then
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
