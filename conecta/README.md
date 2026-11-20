# MercaPlant Conecta (Windows)

Programa do computador da fazenda. Hoje ele faz as **Notas da SEFAZ com certificado A3** (token USB ou cartão), de qualquer marca e tanto e-CNPJ quanto e-CPF. Depois vai ler também a termometria e a balança.

## Como funciona
- No A3, a chave do certificado não sai do token/cartão. Por isso, quem conversa com a SEFAZ é este programa, no computador onde o token está.
- O servidor do MercaPlant (função `sefaz-conecta`) prepara as mensagens e processa as respostas. O código é o mesmo do A1.
- O Conecta só faz o que exige o token: abre a conexão segura com a SEFAZ usando o certificado, e assina a Ciência da Operação (RSA-SHA1).
- Funciona com qualquer marca, porque usa o repositório de certificados do Windows. O PIN é pedido pela janela do fabricante.

## Instalar (no computador da fazenda)
1. Instale o programa do fabricante do token ou cartão (SafeNet, GD, Watchdata, Gemalto…) e conecte o aparelho.
2. Baixe `MercaPlantConecta.exe` em https://github.com/Simulagamer-ofc/AgroOperacoes/releases/download/conecta/MercaPlantConecta.exe e abra.
3. No MercaPlant (ADM): **Notas da SEFAZ → Certificado → A3 → Gerar código**.
4. No Conecta: **Ligar com código**, digite o código e escolha o certificado.

O programa fica na bandeja, perto do relógio, e abre sozinho com o Windows. Ele busca as notas sozinho, respeitando a regra da SEFAZ de 1 hora entre consultas sem novidade.

## Compilar
O workflow `.github/workflows/conecta.yml` compila no Windows (.NET Framework 4.8, que já vem no Windows 10/11) e roda `--autoteste`. Na main, publica o arquivo na versão fixa `conecta`.
