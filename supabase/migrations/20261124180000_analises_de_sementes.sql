-- Análises de sementes por lote (boletim do laboratório) e a classificação pela categoria (C1, C2, S1, S2). Não é financeira.
insert into public.colecoes (store, financeiro) values ('analisesSementes', false)
on conflict (store) do nothing;
