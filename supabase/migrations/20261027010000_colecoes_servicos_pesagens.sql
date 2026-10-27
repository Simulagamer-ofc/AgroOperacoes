-- Coleções que o app sincroniza e ainda não estavam na lista do servidor:
--  • servicosManut: tabela de serviços de manutenção (preço por tipo de serviço) — vale para a fazenda toda
--  • pesagens: caminhões no pátio da moega (chegada / tara) — antes ficavam só no aparelho que pesou
--  • avaliacoes: avaliações técnicas (avaliador) — antes ficavam só no aparelho
-- Nenhuma é financeira (preço de serviço é referência de custo, não conta a pagar).
insert into public.colecoes (store, financeiro) values ('servicosManut', false), ('pesagens', false), ('avaliacoes', false)
on conflict (store) do nothing;
