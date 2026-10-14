-- Fotos dos registros (pragas, manutenção, inspeção): bucket privado "fotos", caminho {fazenda}/{coleção}/{registro}/{foto}.jpg
-- Só quem é da fazenda (ativo) vê e envia; apaga quem enviou, o supervisor ou o ADM. Até 3 MB por foto, só imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Fazenda dona do arquivo (primeira pasta do caminho); nulo se o caminho não começar com um uuid
create or replace function public.fazenda_da_foto(p_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;

drop policy if exists fotos_ler on storage.objects;
drop policy if exists fotos_enviar on storage.objects;
drop policy if exists fotos_apagar on storage.objects;
create policy fotos_ler on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.is_farm_member(public.fazenda_da_foto(name)));
create policy fotos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_farm_member(public.fazenda_da_foto(name)));
create policy fotos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (owner_id = (select auth.uid())::text or public.farm_role(public.fazenda_da_foto(name)) in ('admin', 'supervisor')));
