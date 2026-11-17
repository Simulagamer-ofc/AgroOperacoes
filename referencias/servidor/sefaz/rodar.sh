#!/usr/bin/env bash
# Testes do servidor das Notas da SEFAZ: núcleo (assinatura validada pelo esquema oficial) e integração da função.
set -e
cd "$(dirname "$0")"
D=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/k.pem" -out "$D/c.pem" -days 30 -subj "/C=BR/O=ICP-Brasil/CN=FAZENDA ZAMADEI TESTE LTDA:12345678000195" 2>/dev/null
openssl pkcs12 -export -inkey "$D/k.pem" -in "$D/c.pem" -out "$D/a1.pfx" -passout pass:s3nh@ 2>/dev/null
base64 -w0 "$D/a1.pfx" > "$D/a1.b64"
CERT_B64="$D/a1.b64" deno run -A --import-map mapa.json teste.ts
