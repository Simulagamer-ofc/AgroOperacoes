-- Catálogo de peças do fabricante (PDF) importado pela fazenda: cabeçalho (fabricante, modelo, conjuntos, em que modelo serve)
-- e a lista de peças em partes de até ~45 KB. Não é financeira.
insert into public.colecoes (store, financeiro) values ('catalogosPecas', false)
on conflict (store) do nothing;
