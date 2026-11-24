-- Contorno do talhão trancado: quem pode liberar uma mudança (além do ADM, que sempre pode).
-- O app confere a senha de quem libera na nuvem; esta marca diz quem aparece na lista. Só o ADM muda (função usuarios).
alter table public.farm_members add column if not exists libera_contorno boolean not null default false;
