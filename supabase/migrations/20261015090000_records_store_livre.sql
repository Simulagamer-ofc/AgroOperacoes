-- A lista fixa de coleções (nomes antigos: hourmeterLogs, maintenance, stockItems…) recusava quase tudo que o app envia
-- (hourLogs, maintenances, stock, afericoes, secagem, chuvas…) e derrubava o envio inteiro. Agora vale qualquer nome simples.
alter table public.records drop constraint if exists records_store_check;
alter table public.records add constraint records_store_check check (store ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$');
