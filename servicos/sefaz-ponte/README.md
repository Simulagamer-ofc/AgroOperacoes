# Ponte da SEFAZ (Netlify ou Google Cloud Run)

Serviço pequeno que leva as mensagens das **Notas da SEFAZ** do servidor do Supabase até os web services da SEFAZ (Ambiente Nacional), usando o certificado digital A1 da fazenda.

## Por que existe
A SEFAZ pede o certificado do cliente **renegociando a conexão TLS**. O servidor do Supabase (Deno/rustls) não faz renegociação e a conexão é recusada. O Node (OpenSSL) faz. Prova: `bash teste-renegociacao.sh`.

## O que ele faz e o que não faz
- Recebe do servidor do Supabase: serviço (`dist` ou `evento`), ambiente, a mensagem SOAP pronta e o certificado (.pfx + senha).
- Envia para o endereço **fixo** da SEFAZ correspondente e devolve a resposta.
- **Não guarda nada:** o certificado fica só na memória durante a conexão e não vai para o log. Ele fica guardado no Vault do Supabase.
- Só aceita chamadas com a chave `PONTE_CHAVE` (cabeçalho `x-ponte-chave`), e não aceita endereço vindo de fora.

## Publicar no Netlify (plano grátis, sem cartão)
1. Crie a conta em https://app.netlify.com/signup (entrar com o GitHub é o mais simples).
2. **Add new project → Import an existing project → GitHub** e escolha `Simulagamer-ofc/AgroOperacoes`.
3. Em **Base directory** coloque `servicos/sefaz-ponte` (o resto vem do `netlify.toml`).
4. Em **Environment variables** crie `PONTE_CHAVE` com uma frase longa só sua (32 caracteres ou mais).
5. **Deploy**. O endereço fica como `https://NOME.netlify.app`; teste `https://NOME.netlify.app/saude` (deve mostrar `{"ok":true}`).
6. No Supabase: `SEFAZ_PONTE_URL` = o endereço e `SEFAZ_PONTE_CHAVE` = a mesma frase.

Créditos: o plano grátis tem 300 por mês. Cada publicação custa 15 (o `netlify.toml` só publica quando esta pasta muda) e o uso da função é pequeno (poucos créditos por mês para uma fazenda). Se os créditos acabarem, o Netlify pausa só a ponte até o mês seguinte; o app continua funcionando, só a busca de notas para.

## Publicar no Google Cloud Run (alternativa)
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
