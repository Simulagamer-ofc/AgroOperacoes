-- Análises de sementes por lote (boletim do laboratório) e padrões de sementes por espécie (limites de outras
-- sementes por categoria C1, C2, S1, S2), usados na classificação automática. Não são financeiras.
insert into public.colecoes (store, financeiro) values ('analisesSementes', false), ('padroesSementes', false)
on conflict (store) do nothing;
