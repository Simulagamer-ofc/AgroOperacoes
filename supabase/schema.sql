-- MercaPlant — esquema completo do banco (retrato de 10/11/2026, tirado do projeto antigo nos EUA).
-- Usado para criar o projeto novo em São Paulo (sa-east-1). As migrações em supabase/migrations
-- continuam valendo como histórico; para um projeto do zero, este arquivo basta.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------- Tabelas ----------
create sequence if not exists public.records_seq start 1 increment 1;

create table public.colecoes (store text not null, financeiro boolean default false not null, desde timestamp with time zone default now() not null);
create table public.farms (id uuid default gen_random_uuid() not null, name text not null, join_code text default upper(substr(md5((gen_random_uuid())::text), 1, 8)) not null, created_by uuid default auth.uid() not null, created_at timestamp with time zone default now() not null);
create table public.farm_members (farm_id uuid not null, user_id uuid not null, role text default 'member'::text not null, joined_at timestamp with time zone default now() not null, nome text, login text, funcao text, modulos text[], status text default 'ativo'::text not null, ultimo_acesso timestamp with time zone, pedido_em timestamp with time zone);
create table public.records (farm_id uuid not null, store text not null, id text not null, data jsonb default '{}'::jsonb not null, deleted boolean default false not null, seq bigint default 0 not null, updated_at timestamp with time zone default now() not null, updated_by uuid, created_by uuid default auth.uid());
create table public.system_admins (user_id uuid not null, created_at timestamp with time zone default now() not null);
create table public.tentativas (ip text not null, janela timestamp with time zone not null, n integer default 0 not null);

alter table public.colecoes add constraint colecoes_pkey PRIMARY KEY (store);
alter table public.farms add constraint farms_pkey PRIMARY KEY (id);
alter table public.farms add constraint farms_join_code_key UNIQUE (join_code);
alter table public.farms add constraint farms_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 120)));
alter table public.farms add constraint farms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.farm_members add constraint farm_members_pkey PRIMARY KEY (farm_id, user_id);
alter table public.farm_members add constraint farm_members_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE;
alter table public.farm_members add constraint farm_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.farm_members add constraint farm_members_role_chk CHECK ((role = ANY (ARRAY['admin'::text, 'supervisor'::text, 'member'::text])));
alter table public.farm_members add constraint farm_members_status_chk CHECK ((status = ANY (ARRAY['pendente'::text, 'ativo'::text, 'inativo'::text])));
alter table public.records add constraint records_pkey PRIMARY KEY (farm_id, store, id);
alter table public.records add constraint records_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE;
alter table public.records add constraint records_data_check CHECK ((jsonb_typeof(data) = 'object'::text));
alter table public.records add constraint records_id_check CHECK (((char_length(id) >= 1) AND (char_length(id) <= 100)));
alter table public.records add constraint records_store_check CHECK ((store ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'::text));
alter table public.system_admins add constraint system_admins_pkey PRIMARY KEY (user_id);
alter table public.system_admins add constraint system_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tentativas add constraint tentativas_pkey PRIMARY KEY (ip, janela);

CREATE INDEX farm_members_farm_user_idx ON public.farm_members USING btree (farm_id, user_id);
CREATE INDEX records_farm_seq ON public.records USING btree (farm_id, seq);

alter table public.colecoes enable row level security;
alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.records enable row level security;
alter table public.system_admins enable row level security;
alter table public.tentativas enable row level security;

-- Coleções aceitas pela sincronização (financeiro = só quem vê o financeiro)
insert into public.colecoes (store, financeiro) values
 ('afericoes',false),('aplicacoes',false),('apontamentos',false),('avaliacoes',false),('catalogosPecas',false),('checklistsGraos',false),
 ('checklistsMaq',false),('chuvas',false),('colheitas',false),('contas',true),('equipe',false),('expenses',true),('fields',false),
 ('fornecedores',false),('fuel',false),('hourLogs',false),('lotesSecagem',false),('lotEvents',false),('lots',false),('machines',false),
 ('maintenances',false),('monitoramentos',false),('movements',false),('movSilo',false),('operations',false),('orcamentos',true),
 ('pecas',false),('pedidosCompra',false),('pesagens',false),('referenciasFazenda',false),('romaneios',false),('secagem',false),
 ('servicosManut',false),('stock',false),('termometrias',false),('ubs',false),('vendas',true)
on conflict (store) do nothing;

-- ---------- Funções ----------
CREATE OR REPLACE FUNCTION public.is_system_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.system_admins where user_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.farm_role(p_farm uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(
    (select role from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'),
    case when public.is_system_admin() and exists (select 1 from public.farms where id = p_farm) then 'admin' end)
$function$;

CREATE OR REPLACE FUNCTION public.is_farm_member(p_farm uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo') or public.is_system_admin()
$function$;

CREATE OR REPLACE FUNCTION public.is_fin_store(p_store text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce((select financeiro from public.colecoes where store = p_store), true)
$function$;

CREATE OR REPLACE FUNCTION public.ve_financeiro(p_farm uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.farm_role(p_farm) in ('admin', 'supervisor')
    or exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo' and modulos && array['financeiro', 'producao'])
$function$;

CREATE OR REPLACE FUNCTION public.faz_compras(p_farm uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.farm_role(p_farm) in ('admin', 'supervisor')
    or exists (select 1 from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo' and modulos && array['compras'])
$function$;

CREATE OR REPLACE FUNCTION public.tem_modulo(p_farm uuid, p_modulo text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce((select modulos is null or p_modulo = any(modulos) from public.farm_members where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'), false)
$function$;

CREATE OR REPLACE FUNCTION public.meu_acesso()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'farm_id', m.farm_id,
           'fazenda', f.name,
           'status',  m.status,
           'role',    m.role,
           'funcao',  m.funcao,
           'modulos', m.modulos)), '[]'::jsonb)
  from public.farm_members m
  join public.farms f on f.id = m.farm_id
  where m.user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.registrar_acesso(p_farm uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  update public.farm_members set ultimo_acesso = now() where farm_id = p_farm and user_id = auth.uid() and status = 'ativo'
$function$;

CREATE OR REPLACE FUNCTION public.create_farm(p_name text)
 RETURNS farms LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  if not public.is_system_admin() then raise exception 'Só o Admin do sistema cria fazendas.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Dê um nome para a fazenda.'; end if;
  insert into public.farms (name, created_by) values (trim(p_name), auth.uid()) returning * into f;
  insert into public.farm_members (farm_id, user_id, role, login, nome, funcao)
    values (f.id, auth.uid(), 'admin', auth.jwt()->>'email', split_part(auth.jwt()->>'email', '@', 1), 'diretor');
  return f;
end $function$;

CREATE OR REPLACE FUNCTION public.novo_codigo(p_farm uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare c text;
begin
  if public.farm_role(p_farm) is distinct from 'admin' then raise exception 'Só o ADM da fazenda gera um novo código.'; end if;
  update public.farms set join_code = upper(substr(md5(gen_random_uuid()::text), 1, 8)) where id = p_farm returning join_code into c;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.contar_tentativa(p_ip text, p_janela timestamp with time zone)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v int;
begin
  insert into public.tentativas (ip, janela, n) values (p_ip, p_janela, 1)
    on conflict (ip, janela) do update set n = public.tentativas.n + 1
    returning n into v;
  delete from public.tentativas where janela < now() - interval '1 day';
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.encerrar_sessoes(p_user uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  delete from auth.sessions where user_id = p_user
$function$;

CREATE OR REPLACE FUNCTION public.redemet_chave()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ select decrypted_secret from vault.decrypted_secrets where name = 'redemet_api_key' limit 1 $function$;

CREATE OR REPLACE FUNCTION public.fazenda_da_foto(p_name text)
 RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select case
    when split_part(p_name, '/', 1) ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$function$;

CREATE OR REPLACE FUNCTION public.mod_de(p_data jsonb)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select case when coalesce(p_data->>'_mod', '') ~ '^[0-9]{1,15}(\.[0-9]{1,6})?$'
              then (p_data->>'_mod')::numeric else 0 end
$function$;

CREATE OR REPLACE FUNCTION public.num_de(p jsonb)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^-?[0-9]{1,15}(\.[0-9]{1,9})?$' then (p #>> '{}')::numeric
              else null end
$function$;

CREATE OR REPLACE FUNCTION public.estoque_somado(p_old jsonb, p_new jsonb, p_so_saldo boolean)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare
  v_base numeric := public.num_de(p_new->'_saldoBase');
  v_q numeric := coalesce(public.num_de(p_old->'qty'), 0) + coalesce(public.num_de(p_new->'qty'), 0) - coalesce(v_base, 0);
  v jsonb;
begin
  v := case when p_so_saldo or public.mod_de(p_new) < public.mod_de(p_old) then p_old else p_new end;
  v := (v - '_saldoBase') || jsonb_build_object('qty', round(v_q, 6), '_mod', greatest(public.mod_de(p_old), public.mod_de(p_new)));
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.manut_do_comum(p_old jsonb, p_new jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare
  v jsonb := coalesce(p_new, '{}'::jsonb);
  k text;
  s_old text := p_old->>'status';
  s_new text := v->>'status';
begin
  foreach k in array array['cost', 'custoOutros', 'custoPecas', 'maoObra', 'autorizacao', 'decisoes', 'doneDate', 'doneHours', 'semChecklist'] loop
    if p_old is not null and p_old ? k then v := jsonb_set(v, array[k], p_old->k);
    else v := v - k;
    end if;
  end loop;
  if p_old is null then
    if s_new is distinct from 'Aguardando autorização' then v := jsonb_set(v, '{status}', to_jsonb('Aguardando autorização'::text)); end if;
  elsif s_new is distinct from s_old and not (
        (s_old = 'Programada' and s_new in ('Aberta', 'Em execução'))
     or (s_old = 'Aberta' and s_new in ('Em execução', 'A conferir'))
     or (s_old = 'Em execução' and s_new = 'A conferir')) then
    v := case when s_old is null then v - 'status' else jsonb_set(v, '{status}', to_jsonb(s_old)) end;
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.op_do_comum(p_old jsonb, p_new jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare v jsonb := coalesce(p_new, '{}'::jsonb);
begin
  if coalesce(p_old->'conferencia'->>'situacao', '') = 'aprovada'
     or (coalesce(v->'conferencia'->>'situacao', '') = 'aprovada' and coalesce(p_old->'conferencia'->>'situacao', '') <> 'aprovada') then
    v := case when p_old ? 'conferencia' then jsonb_set(v, '{conferencia}', p_old->'conferencia') else v - 'conferencia' end;
  end if;
  return v;
end $function$;

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

CREATE OR REPLACE FUNCTION public.records_touch()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext(new.farm_id::text));
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $function$;

CREATE TRIGGER records_touch BEFORE INSERT OR UPDATE ON public.records FOR EACH ROW EXECUTE FUNCTION records_touch();

-- ---------- Políticas (RLS) ----------
create policy colecoes_ler on public.colecoes as PERMISSIVE for SELECT to authenticated using (true);
create policy farms_read on public.farms as PERMISSIVE for SELECT to authenticated using (is_farm_member(id));
create policy farms_rename on public.farms as PERMISSIVE for UPDATE to authenticated using ((farm_role(id) = 'admin'::text)) with check ((farm_role(id) = 'admin'::text));
create policy members_read on public.farm_members as PERMISSIVE for SELECT to authenticated using (is_farm_member(farm_id));
create policy records_read on public.records as PERMISSIVE for SELECT to authenticated using (((( SELECT farm_role(records.farm_id) AS farm_role) IS NOT NULL) AND (( SELECT (NOT is_fin_store(records.store))) OR ( SELECT ve_financeiro(records.farm_id) AS ve_financeiro))));
create policy sysadm_self on public.system_admins as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

-- ---------- Permissões ----------
revoke all on public.colecoes, public.farms, public.farm_members, public.records, public.system_admins, public.tentativas from anon, authenticated;
grant select, references, trigger on public.colecoes to anon, authenticated;
grant select, references, trigger on public.farms, public.farm_members, public.records, public.system_admins to authenticated;
grant all on public.colecoes, public.farms, public.farm_members, public.records, public.system_admins, public.tentativas to service_role;

-- Funções usadas pelo app logado
do $$ declare f text; begin
  foreach f in array array['compra_do_comum(jsonb,jsonb)','create_farm(text)','farm_role(uuid)','faz_compras(uuid)','is_farm_member(uuid)','is_fin_store(text)',
    'is_system_admin()','meu_acesso()','mod_de(jsonb)','novo_codigo(uuid)','push_records(uuid,jsonb)','records_touch()','registrar_acesso(uuid)','tem_modulo(uuid,text)','ve_financeiro(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Só o servidor (funções de borda)
  foreach f in array array['contar_tentativa(text,timestamp with time zone)','encerrar_sessoes(uuid)','redemet_chave()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- Fotos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy fotos_apagar on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'fotos'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (( SELECT farm_role(fazenda_da_foto(objects.name)) AS farm_role) = ANY (ARRAY['admin'::text, 'supervisor'::text])))));
create policy fotos_enviar on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'fotos'::text) AND is_farm_member(fazenda_da_foto(name))));
create policy fotos_ler on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'fotos'::text) AND ( SELECT is_farm_member(fazenda_da_foto(objects.name)) AS is_farm_member)));

-- A chave da REDEMET vai no Vault (não fica neste arquivo): select vault.create_secret('<chave>', 'redemet_api_key');
