-- Leitura da foto da nota fiscal (função nota-foto): conta as leituras por fazenda e por dia, para limitar o custo.
-- Só a função (service_role) usa; o app não lê nem grava esta tabela.
create table if not exists public.nota_foto_uso (
  farm_id uuid not null references public.farms(id) on delete cascade,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  n integer not null default 0,
  primary key (farm_id, dia)
);
alter table public.nota_foto_uso enable row level security;

-- Soma uma leitura e devolve quantas já foram hoje; -1 quando o limite do dia já foi atingido (não soma)
create or replace function public.nota_foto_contar(p_farm uuid, p_limite integer) returns integer
language plpgsql security definer set search_path = public as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date; v_n integer;
begin
  insert into public.nota_foto_uso (farm_id, dia, n) values (p_farm, v_dia, 0) on conflict (farm_id, dia) do nothing;
  update public.nota_foto_uso set n = n + 1 where farm_id = p_farm and dia = v_dia and n < p_limite returning n into v_n;
  return coalesce(v_n, -1);
end $$;
revoke execute on function public.nota_foto_contar(uuid, integer) from public, anon, authenticated;
grant execute on function public.nota_foto_contar(uuid, integer) to service_role;
