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

-- Cadastro do proprietário (ficha): nome, CPF/CNPJ, inscrição estadual, contato e endereço.
-- Usado em Cadastros → Propriedade, no LCDPR e nos impressos. Só o ADM da fazenda (ou o Admin do sistema) vê e edita.
create table if not exists public.farm_proprietario (
  farm_id uuid primary key references public.farms (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 160),
  doc text check (doc is null or doc ~ '^([0-9]{11}|[0-9]{14})$'),
  ie text check (ie is null or char_length(ie) <= 30),
  telefone text check (telefone is null or char_length(telefone) <= 30),
  email text check (email is null or char_length(email) <= 160),
  endereco text check (endereco is null or char_length(endereco) <= 200),
  municipio text check (municipio is null or char_length(municipio) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null default auth.uid()
);
alter table public.farm_proprietario enable row level security;
revoke all on public.farm_proprietario from anon;
grant select, insert, update, delete on public.farm_proprietario to authenticated;
drop policy if exists farm_proprietario_ler on public.farm_proprietario;
create policy farm_proprietario_ler on public.farm_proprietario for select to authenticated
  using (public.farm_role(farm_id) in ('admin', 'owner'));
drop policy if exists farm_proprietario_gravar on public.farm_proprietario;
create policy farm_proprietario_gravar on public.farm_proprietario for insert to authenticated
  with check (public.farm_role(farm_id) in ('admin', 'owner'));
drop policy if exists farm_proprietario_mudar on public.farm_proprietario;
create policy farm_proprietario_mudar on public.farm_proprietario for update to authenticated
  using (public.farm_role(farm_id) in ('admin', 'owner')) with check (public.farm_role(farm_id) in ('admin', 'owner'));
drop policy if exists farm_proprietario_apagar on public.farm_proprietario;
create policy farm_proprietario_apagar on public.farm_proprietario for delete to authenticated
  using (public.farm_role(farm_id) in ('admin', 'owner'));
-- Quem gravou e quando: sempre o servidor
create or replace function public.farm_proprietario_carimbo() returns trigger
language plpgsql set search_path = public as $$
begin new.atualizado_em := now(); new.atualizado_por := auth.uid(); return new; end; $$;
drop trigger if exists farm_proprietario_carimbo on public.farm_proprietario;
create trigger farm_proprietario_carimbo before insert or update on public.farm_proprietario
  for each row execute function public.farm_proprietario_carimbo();
