#!/usr/bin/env bash
# Prova manual: a SEFAZ pede o certificado do cliente renegociando a conexão TLS 1.2 (HelloRequest).
# O Node (OpenSSL) renegocia e envia o certificado; o Deno do Supabase (rustls) recusa ("no renegotiation").
# Uso: bash teste-renegociacao.sh   (precisa de openssl e node)
set -e
D=$(mktemp -d); cd "$D"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj /CN=CA 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj /CN=localhost 2>/dev/null
echo "subjectAltName=DNS:localhost" > ext
openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out srv.crt -days 2 -extfile ext 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout cli.key -out cli.csr -subj "/CN=FAZENDA:12345678000195" 2>/dev/null
openssl x509 -req -in cli.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out cli.crt -days 2 2>/dev/null
openssl pkcs12 -export -inkey cli.key -in cli.crt -out cli.pfx -passout pass:x 2>/dev/null
cat > cli.js <<'JS'
const https=require('https'),fs=require('fs');
const r=https.request({host:'localhost',port:9447,method:'POST',pfx:fs.readFileSync('cli.pfx'),passphrase:'x',ca:fs.readFileSync('ca.crt'),agent:false},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('node recebeu',res.statusCode,d));});
r.on('error',e=>console.log('node erro',e.message)); r.end('hi');
JS
( (sleep 2; printf 'R\n'; sleep 2; printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'; sleep 1; printf 'Q\n') | timeout 9 openssl s_server -accept 9447 -cert srv.crt -key srv.key -CAfile ca.crt -tls1_2 -no_ticket -no_cache -verify_return_error > srv.log 2>&1 & )
sleep 1; node cli.js; sleep 3
grep -q "depth=0 CN = FAZENDA" srv.log && echo "OK: certificado do cliente enviado na renegociação" || { echo "FALHOU"; cat srv.log; exit 1; }
