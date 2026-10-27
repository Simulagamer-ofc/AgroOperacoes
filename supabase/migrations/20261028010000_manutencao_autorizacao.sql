-- Checklist da máquina e pedido de manutenção com autorização (0.72).
-- 1) Coleção nova: checklistsMaq (cada checklist é de quem fez; não é financeiro).
-- 2) Manutenção e usuário comum: ele marca o checklist do conserto e envia para conferência mesmo numa ordem aberta
--    por outra pessoa, mas não altera valores, serviços nem decisões, e não autoriza nem conclui.
--    O servidor mantém esses campos como estavam e só aceita as mudanças de situação permitidas ao usuário comum.

insert into public.colecoes (store, financeiro) values ('checklistsMaq', false) on conflict (store) do nothing;

create or replace function public.manut_do_comum(p_old jsonb, p_new jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v jsonb := coalesce(p_new, '{}'::jsonb);
  k text;
  s_old text := p_old->>'status';
  s_new text := v->>'status';
begin
  -- Campos de quem autoriza: valores, serviços, decisões e conclusão
  foreach k in array array['cost', 'custoOutros', 'custoPecas', 'maoObra', 'autorizacao', 'decisoes', 'doneDate', 'doneHours', 'semChecklist'] loop
    if p_old is not null and p_old ? k then v := jsonb_set(v, array[k], p_old->k);
    else v := v - k;
    end if;
  end loop;
  if p_old is null then
    -- Ordem nova do usuário comum é sempre um pedido aguardando autorização
    if s_new is distinct from 'Aguardando autorização' then v := jsonb_set(v, '{status}', to_jsonb('Aguardando autorização'::text)); end if;
  elsif s_new is distinct from s_old and not (
        (s_old = 'Programada' and s_new in ('Aberta', 'Em execução'))
     or (s_old = 'Aberta' and s_new in ('Em execução', 'A conferir'))
     or (s_old = 'Em execução' and s_new = 'A conferir')) then
    v := case when s_old is null then v - 'status' else jsonb_set(v, '{status}', to_jsonb(s_old)) end;
  end if;
  return v;
end $$;

create or replace function public.push_records(p_farm uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role text := public.farm_role(p_farm);
  v_fin  boolean := public.ve_financeiro(p_farm);
  r jsonb;
  v_store text; v_id text; v_del boolean;
  v_existe boolean; v_dono uuid; v_old jsonb; v_data jsonb;
  v_rej jsonb := '[]'::jsonb;
begin
  if v_role is null then raise exception 'Sem permissao nesta fazenda.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Envio invalido.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Envie no maximo 500 registros por vez.';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_store := r->>'store';
    v_id    := r->>'id';
    v_del   := coalesce((r->>'deleted')::boolean, false);
    v_data  := coalesce(r->'data', '{}'::jsonb);

    if v_store is null or v_id is null then continue; end if;

    if v_id !~ '^[A-Za-z0-9_-]{1,64}$' then
      v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
    end if;

    if not exists (select 1 from public.colecoes where store = v_store) then
      v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
    end if;

    if r ? 'data' and length((r->'data')::text) > 65536 then
      v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
    end if;

    v_existe := false; v_dono := null; v_old := null;
    select true, created_by, data
      into v_existe, v_dono, v_old
      from public.records
     where farm_id = p_farm and store = v_store and id = v_id;
    v_existe := coalesce(v_existe, false);

    if v_role = 'member' then
      if v_del then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
      if public.is_fin_store(v_store) and v_existe and not v_fin then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
      if v_store = 'maintenances' then
        -- Pode marcar o checklist de qualquer ordem; o que é de quem autoriza fica como está no servidor
        v_data := public.manut_do_comum(case when v_existe then v_old end, v_data);
      elsif v_existe and v_dono is distinct from auth.uid() then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
    end if;

    insert into public.records (farm_id, store, id, data, deleted, created_by)
      values (p_farm, v_store, v_id, v_data, v_del, auth.uid())
      on conflict (farm_id, store, id) do update
        set data = excluded.data,
            deleted = excluded.deleted
        where public.mod_de(excluded.data) >= public.mod_de(records.data);
  end loop;
  return v_rej;
end $function$;
