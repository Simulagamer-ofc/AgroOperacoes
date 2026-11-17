#!/usr/bin/env bash
# Publica a ponte da SEFAZ no Google Cloud Run (região São Paulo).
# Rodar no Cloud Shell (console.cloud.google.com → ícone ">_" no alto), dentro desta pasta:
#   git clone https://github.com/Simulagamer-ofc/AgroOperacoes.git && cd AgroOperacoes/servicos/sefaz-ponte && bash publicar.sh
# No fim ele mostra o ENDEREÇO e a CHAVE para cadastrar no Supabase (segredos SEFAZ_PONTE_URL e SEFAZ_PONTE_CHAVE).
set -euo pipefail
REGIAO=southamerica-east1
SERVICO=sefaz-ponte
PROJETO=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJETO" ]; then echo "Escolha o projeto do Google Cloud primeiro: gcloud config set project NOME-DO-PROJETO"; exit 1; fi
echo "Projeto: $PROJETO • Região: $REGIAO"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --quiet
# Reaproveita a chave se o serviço já existe (para não ter de trocar no Supabase)
CHAVE=$(gcloud run services describe $SERVICO --region $REGIAO --format 'value(spec.template.spec.containers[0].env[0].value)' 2>/dev/null || true)
[ ${#CHAVE} -ge 32 ] || CHAVE=$(openssl rand -hex 32)
gcloud run deploy $SERVICO --source . --region $REGIAO --allow-unauthenticated \
  --set-env-vars "PONTE_CHAVE=$CHAVE" --memory 256Mi --cpu 1 --max-instances 2 --concurrency 10 --timeout 120 --quiet
URL=$(gcloud run services describe $SERVICO --region $REGIAO --format 'value(status.url)')
echo
echo "================ PRONTO ================"
echo "SEFAZ_PONTE_URL   = $URL"
echo "SEFAZ_PONTE_CHAVE = $CHAVE"
echo "Teste: curl -s $URL/saude   (deve responder {\"ok\":true})"
echo "Cadastre os dois valores acima nos segredos das funções do Supabase (o Claude abre o formulário para você)."
