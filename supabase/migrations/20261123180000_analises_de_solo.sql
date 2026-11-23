-- Análises de solo por talhão (laudo do laboratório) para a recomendação de calagem e adubação. Não é financeira.
insert into public.colecoes (store, financeiro) values ('analisesSolo', false)
on conflict (store) do nothing;
