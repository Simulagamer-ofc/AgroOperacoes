-- Setor de Compras (0.84): pedidos de compra da fazenda na nuvem (coleção "pedidosCompra", não financeira).
-- Quem decide (aprova, cota, pede ao fornecedor, recebe, cancela qualquer pedido): ADM, supervisor ou o usuário comum
-- com a tela "compras" liberada (comprador). O usuário comum sem essa tela só faz o pedido (que nasce "solicitado")
-- e pode cancelar o próprio pedido enquanto ele aguarda aprovação; não mexe nos pedidos dos outros.

insert into public.colecoes (store, financeiro) values ('pedidosCompra', false)
on conflict (store) do nothing;

create or replace function public.faz_compras(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.farm_role(p_farm) in ('admin', 'supervisor')
    or exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo' and modulos && array['compras'])
$$;

-- Pedido do usuário comum: as decisões de compra ficam como estavam; só pode criar "solicitado" e cancelar enquanto aguarda
create or replace function public.compra_do_comum(p_old jsonb, p_new jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v jsonb := coalesce(p_new, '{}'::jsonb);
  k text;
  s_old text := p_old->>'status';
  s_new text := v->>'status';
begin
  foreach k in array array['aprovacao', 'fornecedorId', 'previsao', 'enviadoEm', 'cotacoes', 'recebidos', 'adiadoAte', 'adiadoMotivo', 'juntadoEm', 'obsPedido'] loop
    if p_old is not null and p_old ? k then v := jsonb_set(v, array[k], p_old->k);
    else v := v - k;
    end if;
  end loop;
  if p_old is null then
    v := jsonb_set(v, '{status}', to_jsonb('solicitado'::text));
    v := v - 'motivo' - 'fechadoPor' - 'fechadoEm';
  elsif s_new is distinct from s_old and not (s_old = 'solicitado' and s_new = 'cancelado') then
    v := case when s_old is null then v - 'status' else jsonb_set(v, '{status}', to_jsonb(s_old)) end;
    foreach k in array array['motivo', 'fechadoPor', 'fechadoEm'] loop
      if p_old ? k then v := jsonb_set(v, array[k], p_old->k); else v := v - k; end if;
    end loop;
  end if;
  return v;
end $$;

create or replace function public.push_records(p_farm uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role text := public.farm_role(p_farm);
  v_fin  boolean := public.ve_financeiro(p_farm);
  v_compras boolean := public.faz_compras(p_farm);
  r jsonb;
  v_store text; v_id text; v_del boolean;
  v_existe boolean; v_dono uuid; v_old jsonb; v_data jsonb; v_outro boolean;
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
    v_outro := v_existe and v_dono is distinct from auth.uid();

    if v_role = 'member' then
      if v_del then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
      if public.is_fin_store(v_store) and v_existe and not v_fin then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
      if v_store = 'maintenances' then
        v_data := public.manut_do_comum(case when v_existe then v_old end, v_data);
      elsif v_store = 'operations' then
        if v_existe then v_data := public.op_do_comum(v_old, v_data); end if;
      elsif v_store = 'pedidosCompra' then
        if not v_compras then
          if v_outro then
            v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
          end if;
          v_data := public.compra_do_comum(case when v_existe then v_old end, v_data);
        end if;
      elsif v_store = 'stock' and v_outro then
        if not (v_data ? '_saldoBase') then
          v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
        end if;
      elsif v_store = 'machines' and v_outro then
        v_data := v_old || jsonb_build_object('hours', greatest(coalesce(public.num_de(v_old->'hours'), 0), coalesce(public.num_de(v_data->'hours'), 0)),
                                              '_mod', greatest(public.mod_de(v_old), public.mod_de(v_data)));
      elsif v_outro then
        v_rej := v_rej || jsonb_build_object('store', v_store, 'id', v_id); continue;
      end if;
    end if;

    if v_store = 'stock' and v_data ? '_saldoBase' then
      v_data := case when v_existe and not v_del then public.estoque_somado(v_old, v_data, v_role = 'member' and v_outro) else v_data - '_saldoBase' end;
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
