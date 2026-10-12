-- Segurança: só o Admin do sistema cria fazendas; visitantes sem login sem nenhuma permissão nas tabelas
create or replace function public.create_farm(p_name text) returns public.farms
language plpgsql security definer set search_path = public as $$
declare f public.farms;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  if not public.is_system_admin() then raise exception 'Só o Admin do sistema cria fazendas.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Dê um nome para a fazenda.'; end if;
  insert into public.farms (name, created_by) values (trim(p_name), auth.uid()) returning * into f;
  insert into public.farm_members (farm_id, user_id, role, login, nome, funcao)
    values (f.id, auth.uid(), 'admin', auth.jwt()->>'email', split_part(auth.jwt()->>'email', '@', 1), 'diretor');
  return f;
end $$;
revoke execute on function public.create_farm(text) from public, anon;
grant execute on function public.create_farm(text) to authenticated;

revoke all on public.system_admins, public.farms, public.farm_members, public.records from anon;
revoke execute on function public.is_fin_store(text) from public, anon;
grant execute on function public.is_fin_store(text) to authenticated;
