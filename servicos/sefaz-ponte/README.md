# Ponte da SEFAZ (Google Cloud Run)

Serviço pequeno que leva as mensagens das **Notas da SEFAZ** do servidor do Supabase até os web services da SEFAZ (Ambiente Nacional), usando o certificado digital A1 da fazenda.

## Por que existe
A SEFAZ pede o certificado do cliente **renegociando a conexão TLS**. O servidor do Supabase (Deno/rustls) não faz renegociação e a conexão é recusada. O Node (OpenSSL) faz. Prova: `bash teste-renegociacao.sh`.

## O que ele faz e o que não faz
- Recebe do servidor do Supabase: serviço (`dist` ou `evento`), ambiente, a mensagem SOAP pronta e o certificado (.pfx + senha).
- Envia para o endereço **fixo** da SEFAZ correspondente e devolve a resposta.
- **Não guarda nada:** o certificado fica só na memória durante a conexão e não vai para o log. Ele fica guardado no Vault do Supabase.
- Só aceita chamadas com a chave `PONTE_CHAVE` (cabeçalho `x-ponte-chave`), e não aceita endereço vindo de fora.

## Publicar
No Cloud Shell do Google Cloud (projeto com faturamento ativo; fica no nível gratuito do Cloud Run):

```bash
git clone https://github.com/Simulagamer-ofc/AgroOperacoes.git
cd AgroOperacoes/servicos/sefaz-ponte && bash publicar.sh
```

No fim aparecem `SEFAZ_PONTE_URL` e `SEFAZ_PONTE_CHAVE`, que vão para os segredos das funções do Supabase.

## Testes
```bash
node --test teste.js           # repasse, chave, serviço fora da lista, senha errada
bash teste-renegociacao.sh     # renegociação TLS com certificado do cliente (como a SEFAZ)
```
