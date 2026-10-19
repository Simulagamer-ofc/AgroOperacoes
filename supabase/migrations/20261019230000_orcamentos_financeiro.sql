-- Planejado x realizado: os orçamentos da safra (valores em R$) são dados financeiros.
-- Mesma proteção de gastos, contas e vendas: quem não vê o financeiro não lê nem altera.
-- (is_fin_store consulta public.colecoes; coleção não cadastrada já é tratada como financeira)
insert into public.colecoes (store, financeiro) values ('orcamentos', true)
on conflict (store) do update set financeiro = excluded.financeiro;
