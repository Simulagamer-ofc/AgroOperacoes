-- Notas da SEFAZ (0.88): o servidor baixa da SEFAZ (Distribuição de DF-e) as NF-e emitidas contra o CNPJ/CPF do
-- certificado A1 da fazenda, faz a Ciência da Operação (libera o XML completo) e o app dá entrada pela conferência.
-- O certificado e a senha ficam só no Vault (lidos apenas pelo servidor, papel service_role).

create table public.sefaz_config (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  doc text not null,                       -- CNPJ ou CPF do certificado
  tipo_doc text not null check (tipo_doc in ('CNPJ', 'CPF')),
  nome text,                               -- titular do certificado
  validade timestamptz,
  uf text not null default '43',           -- código IBGE da UF (43 = RS)
  ambiente smallint not null default 1 check (ambiente in (1, 2)), -- 1 produção, 2 homologação
  ult_nsu text not null default '0',
  max_nsu text,
  prox_consulta timestamptz,               -- regra da SEFAZ: sem novidade, só consultar de novo depois de 1 hora
  ult_consulta timestamptz,
  ult_cstat text,
  ult_motivo text,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

create table public.nfe_recebidas (
  farm_id uuid not null references public.farms(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9]{44}$'),
  nsu text,
  situacao text not null default 'resumo' check (situacao in ('resumo', 'completa', 'cancelada')),
  numero text,
  emitente text,
  cnpj_emit text,
  valor numeric,
  emissao timestamptz,
  tp_nf text,
  xml text,                                -- nfeProc completo (depois da ciência)
  ciencia_em timestamptz,
  ciencia_cstat text,
  ciencia_motivo text,
  importada_em timestamptz,
  importada_por text,
  ignorada boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (farm_id, chave)
);
create index nfe_recebidas_farm_emissao on public.nfe_recebidas (farm_id, emissao desc);

alter table public.sefaz_config enable row level security;
alter table public.nfe_recebidas enable row level security;

-- Quem vê: quem tem Estoque ou Compras na fazenda (ADM e supervisor veem tudo)
create or replace function public.ve_notas_sefaz(p_farm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.farm_role(p_farm) in ('admin', 'supervisor') or public.tem_modulo(p_farm, 'estoque') or public.tem_modulo(p_farm, 'compras')
$$;
revoke all on function public.ve_notas_sefaz(uuid) from public, anon;
grant execute on function public.ve_notas_sefaz(uuid) to authenticated, service_role;

create policy sefaz_config_ler on public.sefaz_config for select to authenticated using ((select public.ve_notas_sefaz(farm_id)));
create policy nfe_recebidas_ler on public.nfe_recebidas for select to authenticated using ((select public.ve_notas_sefaz(farm_id)));
revoke all on public.sefaz_config, public.nfe_recebidas from anon, authenticated;
grant select on public.sefaz_config, public.nfe_recebidas to authenticated;
grant all on public.sefaz_config, public.nfe_recebidas to service_role;

-- O app marca a nota como importada (deu entrada) ou ignorada (não é compra de estoque)
create or replace function public.nfe_recebida_marcar(p_farm uuid, p_chave text, p_acao text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ve_notas_sefaz(p_farm) then raise exception 'Sem acesso às notas desta fazenda.'; end if;
  if p_acao = 'importada' then
    update public.nfe_recebidas set importada_em = coalesce(importada_em, now()), importada_por = coalesce(importada_por, auth.jwt()->>'email'), ignorada = false, atualizado_em = now()
     where farm_id = p_farm and chave = p_chave;
  elsif p_acao = 'ignorar' then
    update public.nfe_recebidas set ignorada = true, atualizado_em = now() where farm_id = p_farm and chave = p_chave and importada_em is null;
  elsif p_acao = 'desfazer' then
    update public.nfe_recebidas set ignorada = false, atualizado_em = now() where farm_id = p_farm and chave = p_chave;
  else raise exception 'Ação inválida.';
  end if;
end $$;
revoke all on function public.nfe_recebida_marcar(uuid, text, text) from public, anon;
grant execute on function public.nfe_recebida_marcar(uuid, text, text) to authenticated, service_role;

-- Certificado A1 no Vault: só o servidor grava, lê e apaga
create or replace function public.sefaz_cert_salvar(p_farm uuid, p_valor text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nome text := 'sefaz_cert_' || p_farm::text;
begin
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then perform vault.create_secret(p_valor, v_nome, 'Certificado A1 da fazenda (Notas da SEFAZ)');
  else perform vault.update_secret(v_id, p_valor); end if;
end $$;
create or replace function public.sefaz_cert_ler(p_farm uuid) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'sefaz_cert_' || p_farm::text limit 1
$$;
create or replace function public.sefaz_cert_apagar(p_farm uuid) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where name = 'sefaz_cert_' || p_farm::text
$$;
revoke all on function public.sefaz_cert_salvar(uuid, text) from public, anon, authenticated;
revoke all on function public.sefaz_cert_ler(uuid) from public, anon, authenticated;
revoke all on function public.sefaz_cert_apagar(uuid) from public, anon, authenticated;
grant execute on function public.sefaz_cert_salvar(uuid, text) to service_role;
grant execute on function public.sefaz_cert_ler(uuid) to service_role;
grant execute on function public.sefaz_cert_apagar(uuid) to service_role;
