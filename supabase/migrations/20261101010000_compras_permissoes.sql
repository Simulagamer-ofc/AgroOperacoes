-- Auditoria 01/11: as funções do setor de Compras não ficam abertas para quem não entrou na conta.
-- push_records (security definer) continua chamando as duas normalmente.
revoke execute on function public.faz_compras(uuid) from public, anon;
revoke execute on function public.compra_do_comum(jsonb, jsonb) from public, anon;
