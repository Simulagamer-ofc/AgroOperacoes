-- Catálogo de peças das máquinas e fornecedores de peças: coleções novas que o app sincroniza.
-- Não são financeiras (o preço de cotação é referência de compra, não conta a pagar).
insert into public.colecoes (store, financeiro) values ('pecas', false), ('fornecedores', false)
on conflict (store) do nothing;
