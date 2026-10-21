-- Chave da API REDEMET guardada no Vault (vault.create_secret(..., 'redemet_api_key')); só a função de borda (service_role) lê
create or replace function public.redemet_chave()
returns text
language sql
security definer
set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'redemet_api_key' limit 1 $$;
revoke all on function public.redemet_chave() from public, anon, authenticated;
grant execute on function public.redemet_chave() to service_role;
