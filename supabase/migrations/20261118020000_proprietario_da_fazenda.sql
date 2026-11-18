-- Proprietário da fazenda (0.96): um usuário da fazenda marcado como dono.
-- Sempre ADM; ninguém o desativa, remove ou rebaixa (regras na função "usuarios"). Só ele (ou o Admin do sistema)
-- passa a propriedade para outra pessoa; enquanto não há proprietário, qualquer ADM pode definir.
alter table public.farms add column if not exists proprietario uuid references auth.users (id) on delete set null;

create or replace function public.fazenda_proprietario_definir(p_farm uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  eu uuid := auth.uid();
  atual uuid;
  sys boolean;
begin
  if eu is null then raise exception 'Faça login para continuar.'; end if;
  select f.proprietario into atual from public.farms f where f.id = p_farm for update;
  if not found then raise exception 'Fazenda não encontrada.'; end if;
  sys := exists (select 1 from public.system_admins s where s.user_id = eu);
  if not sys and not exists (select 1 from public.farm_members m where m.farm_id = p_farm and m.user_id = eu and m.role = 'admin' and coalesce(m.status, 'ativo') = 'ativo') then
    raise exception 'Só o ADM da fazenda define o proprietário.';
  end if;
  if atual is not null and atual <> eu and not sys then
    raise exception 'Só o proprietário atual pode passar a propriedade para outra pessoa.';
  end if;
  if not exists (select 1 from public.farm_members m where m.farm_id = p_farm and m.user_id = p_user and coalesce(m.status, 'ativo') = 'ativo') then
    raise exception 'Escolha um usuário ativo desta fazenda.';
  end if;
  update public.farm_members set role = 'admin', funcao = coalesce(funcao, 'diretor') where farm_id = p_farm and user_id = p_user;
  update public.farms set proprietario = p_user where id = p_farm;
end;
$$;

revoke all on function public.fazenda_proprietario_definir(uuid, uuid) from public, anon;
grant execute on function public.fazenda_proprietario_definir(uuid, uuid) to authenticated;
