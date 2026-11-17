-- Local da fazenda (sede): um ponto só, guardado junto com a fazenda e usado por todos os aparelhos
-- (previsão do tempo, mapa do tempo, mapas). Só o ADM e o supervisor marcam; todos os membros leem.
alter table public.farms
  add column if not exists sede_lat double precision,
  add column if not exists sede_lon double precision,
  add column if not exists sede_origem text,
  add column if not exists sede_precisao_m integer,
  add column if not exists sede_em timestamptz,
  add column if not exists sede_por uuid references auth.users(id) on delete set null;

alter table public.farms drop constraint if exists farms_sede_valida;
alter table public.farms add constraint farms_sede_valida check (
  (sede_lat is null and sede_lon is null)
  or (sede_lat between -90 and 90 and sede_lon between -180 and 180
      and sede_origem in ('gps', 'mapa', 'coordenadas')
      and (sede_precisao_m is null or sede_precisao_m between 0 and 100000)));

-- Marcar ou trocar a sede (a coluna não é editável direto: só por aqui, com as conferências)
create or replace function public.fazenda_sede_salvar(p_farm uuid, p_lat double precision, p_lon double precision, p_origem text, p_precisao integer default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare agora timestamptz := now();
begin
  if coalesce(public.farm_role(p_farm), '') not in ('admin', 'supervisor') then
    raise exception 'Só o ADM ou o supervisor da fazenda pode marcar o local da sede.' using errcode = '42501';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 or (p_lat = 0 and p_lon = 0) then
    raise exception 'Coordenadas inválidas.' using errcode = '22023';
  end if;
  if p_origem is null or p_origem not in ('gps', 'mapa', 'coordenadas') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if p_precisao is not null and p_precisao > 3000 then
    raise exception 'Localização imprecisa (% m). Marque a sede no mapa ou use o GPS do celular.', p_precisao using errcode = '22023';
  end if;
  update public.farms
     set sede_lat = round(p_lat::numeric, 6)::double precision, sede_lon = round(p_lon::numeric, 6)::double precision,
         sede_origem = p_origem, sede_precisao_m = p_precisao, sede_em = agora, sede_por = auth.uid()
   where id = p_farm;
  return json_build_object('sede_lat', round(p_lat::numeric, 6), 'sede_lon', round(p_lon::numeric, 6), 'sede_origem', p_origem,
                           'sede_precisao_m', p_precisao, 'sede_em', agora, 'sede_por', auth.uid());
end;
$$;

revoke all on function public.fazenda_sede_salvar(uuid, double precision, double precision, text, integer) from public, anon;
grant execute on function public.fazenda_sede_salvar(uuid, double precision, double precision, text, integer) to authenticated;
