-- Caminhões da moega com a tara cadastrada (placa, motorista, transportadora, tara e data da pesagem vazia, histórico).
-- Permite fechar o romaneio com uma pesagem só (bruto − tara cadastrada há até 30 dias). Não é financeira.
insert into public.colecoes (store, financeiro) values ('caminhoes', false)
on conflict (store) do nothing;
