# Banco de referências — aferição e calibragem

Módulo independente da interface. Pode ser incorporado ao Nexus Agro 2.23 ou ao AgroOperacoes sem alterar telas existentes.

| Arquivo | Conteúdo |
|---|---|
| `regras-afericao.json` | Regras com escopo, limites, condições, fontes e status de validação; tabela ISO 10625; fórmulas |
| `avaliador.js` | Avaliação (`avaliar`) e fluxos compostos; funciona no navegador (`window.NexusAvaliador`) e no Node |
| `catalogo-fabricantes.json` | Fabricantes de máquinas e implementos atuantes no Brasil (identificação; sem parâmetros técnicos) |
| `modelos/` | Modelos por marca, com especificações copiadas do site do fabricante (`indice.json` lista as marcas) |
| `bndes/produtos-agricolas-finame.json` | Lista oficial do BNDES: 11.107 produtos agrícolas credenciados no FINAME, de 1.891 fabricantes (identificação + código FINAME) |
| `ferramentas/coleta/` | Scripts de coleta e consolidação dos modelos |
| `tests/avaliador.test.js` | Testes: `node --test referencias/tests/*.test.js` |

## Como o avaliador decide

Antes de devolver `OK`, `ATENCAO` ou `FORA_DO_PADRAO`, verifica nesta ordem:

1. existe regra para a variável;
2. equipamento/família, 3. produto, 4. destino, 5. etapa, 6. ponto e posição, 7. unidade (sem conversão automática);
8. condições adicionais da regra foram informadas; 9. foram satisfeitas;
10. a regra está **validada** e tem limite; 11. não há duas regras validadas com limites diferentes.

Se algo falhar → `SEM_REFERENCIA` ou `DADOS_INSUFICIENTES`, com `pendencias` explicando o que falta. `DADOS_INSUFICIENTES` só é usado quando uma regra validada passaria a valer com os dados pedidos.

Escopo `"*"` na regra significa que ela **declara** não depender daquele campo (ex.: vazão de bico não depende da cultura). Campo vazio na regra = regra incompleta = não aplicada.

`congelar(resultado)` gera a cópia imutável a ser gravada no registro (regra, versão, limites, fonte, data da análise). Mudanças futuras no banco não alteram registros antigos.

## Situação das regras (versão 1.1.0 do banco)

Conferência documental feita em 04/10/2026 a partir dos documentos originais. O trecho literal e a página ficam em `fontes[].trechoLiteral`. Recomenda-se revisão por responsável técnico.

| ID | Avaliação | Limite | Fonte | Status |
|---|---|---|---|---|
| PULV-BICO-CAT-01 | Vazão do bico × tabela do fabricante | ±10% | Embrapa Agroindústria Tropical, Documentos 102 (2006), p. 30 | **validada** |
| COLH-PERDA-SOJA-01 | Perda total na colheita — **somente soja**, média de ≥ 5 pontos, armação de 2,0 m² | ≤ 60 kg/ha | Embrapa Soja, manual do copo medidor (2013) | **validada** |
| ISO10625-CORES (tabela) | Cor da ponta × vazão nominal a 300 kPa (19 classes, tolerância ±5%) | — | ISO 10625:2018, Tabela 1 | **validada** |
| SEM-ESPAC-01 | % de espaçamentos aceitáveis | ≥ 90% (sem fonte) | Classes 0,5/1,5 × Xref conferidas: Embrapa Soja; ABNT (1994) apud Kurachi (1989) | pendente: falta fonte para o limite de 90% |
| PULV-BICO-MED-01 | Vazão do bico × média da barra | ±10% | **Não consta do Doc. 102**; visto só em portal comercial | pendente (só informativa) |
| PULV-SENSOR-01 | Sensor de velocidade / fluxômetro | ±5% | ISO 16122-2: a revisão de 2024 alterou o erro máximo dos fluxômetros | pendente: falta o texto vigente |
| ADUB-CV-N-01 / ADUB-CV-OUT-01 | CV transversal do distribuidor | ≤ 15% / ≤ 25% | Spreadmark (NZ); acesso às fontes bloqueado | pendente |
| PULV-TAXA-01 / DOSE-PLAN-01 | Taxa ou dose × planejada | **sem fonte** | — | pendente |

Fórmulas conferidas: classes de espaçamento (F-ESPAC-CLASSES) e perdas internas PMI = PTT − PPC (F-PERDA-PMI). As demais fórmulas são conversões de unidade.

Sem referência no banco (o sistema não avalia): perdas de milho, trigo, feijão e outras culturas; pressão do manômetro; tamanho de gota; condições climáticas de aplicação.

## Secador, moega e armazenagem (banco 1.4.0)

Conferência documental em 05/10/2026. O ponto de medição faz parte do escopo: uma regra da massa de grãos nunca é aplicada ao ar de entrada.

| ID | Produto / destino | Etapa / ponto | Limite | Fonte | Status |
|---|---|---|---|---|---|
| SEC-SOJA-SEM-MASSA-01 | soja / semente | secagem / massa de sementes | até 40 °C | Embrapa Soja, Doc. 380 (2016), pp. 45-46 | **validada** |
| SEC-SOJA-SEM-URAR-01 | soja / semente — secador estático | secagem / ar de secagem | UR ≥ 35% | Embrapa Soja, Doc. 380 (2016) | **validada** |
| SEC-SOJA-AGRO-MASSA-01 | soja / agroindústria | secagem / massa de grãos | até 48 °C | Embrapa, Manual de Segurança e Qualidade da Soja (2005) | **validada** |
| SEC-MILHO-SEM-AR-01 · MOAG · RACAO | milho / semente · moagem · ração | secagem / ar de secagem | 44 · 55 · 82 °C | Embrapa Milho e Sorgo, Cultivo do Milho (2015), p. 28 | **validada** (confiança média: a p. 20 do mesmo texto fala em temperatura "dos grãos") |
| ARM-SOJA-AGRO-UMID-01 | soja / agroindústria | pós-secagem e armazenamento / amostra | abaixo de 14% | Manual Embrapa (2005) | **validada** |
| ARM-MILHO-GRAO-UMID-01 | milho / grão | pós-secagem e armazenamento / amostra | até 13% | Cultivo do Milho (2015), p. 10 | **validada** |
| ARM-SOJA-SEM-UMID-* (6 regras) | soja / semente, por região e embalagem | armazenamento / amostra | 13,5 · 12,0 · 11,5% (sacaria); 1 p.p. a menos em big-bag | Doc. 380 (2016), p. 49 | **validada** (big-bag: confiança média, valor derivado) |
| ARM-SOJA-SEM-TEMP-01 / URAR-01 | soja / semente | armazenamento | abaixo de 25 °C / UR abaixo de 70% | Manual Embrapa (2005) | **validada** |
| SEC-SOJA-SEM-MASSA-2005 | soja / semente | secagem / massa | 38 °C | Manual Embrapa (2005) | suspensa — substituída pelo Doc. 380 (2016) |
| COM-SOJA-UMID-01 / COM-MILHO-UMID-01 | soja / milho — destinos de grão | recebimento (moega) / amostra | até 14% (recomendado; não entra no tipo) | IN 11/2007, Art. 4º, § 4º · IN 60/2011, Art. 11 | **validada** |
| CLA-SOJA-AVAR-01 · QUEB-01 · IMPUR-01 | soja | recebimento | 8% · 30% · 1% | Embrapa | suspensas — substituídas pelas tabelas abaixo |

### Classificação oficial (`tabelasClassificacao`)

Conferida em 05/10/2026 no texto consolidado do SISLEGIS/MAPA; cópia do texto em `fontes/mapa/`. Vale no recebimento para destinos de grão (não para semente).

| ID | Norma | Tipos (limites máximos, %) | Fora de tipo / desclassificação |
|---|---|---|---|
| CLA-SOJA-IN11-GI | IN 11/2007, Tabela 1 (Grupo I — consumo in natura) | Tipo 1: ardidos+queimados 1,0; queimados 0,3; mofados 0,5; avariados 4,0; esverdeados 2,0; partidos/quebrados/amassados 8,0; matérias estranhas e impurezas 1,0 · Tipo 2: 2,0; 1,0; 1,5; 6,0; 4,0; 15,0; 1,0 | acima do Tipo 2 = Fora de Tipo (Art. 6º); defeitos graves > 12% = desclassificada (Art. 8º, II) |
| CLA-SOJA-IN11-GII | IN 11/2007, Tabela 2 (Grupo II — outros usos) | Padrão Básico: 4,0; 1,0; 6,0; 8,0; 8,0; 30,0; 1,0 | Fora do Padrão Básico; defeitos graves > 40% = desclassificada (Art. 8º, III) |
| CLA-MILHO-IN60 | IN 60/2011, Tabela 1 | ardidos · avariados · quebrados · impurezas · carunchados — Tipo 1: 1; 6; 3; 1; 2 · Tipo 2: 2; 10; 4; 1,5; 3 · Tipo 3: 3; 15; 5; 2; 4 | acima do Tipo 3 = Fora de Tipo; ardidos > 5, avariados > 20 ou carunchados > 8 = desclassificado (Art. 5º, § 3º, II, d) |

Regras de cálculo seguidas: enquadramento pelo pior tipo (IN 11, Art. 27); resultado de cada defeito com 1 casa decimal na soja (Art. 25, VII) e 2 no milho; picados por percevejo entram divididos por 4 nos danificados da soja (Art. 25, III — o operador informa o total já calculado). As normas **não definem desconto**; desconto é acordo comercial e não é calculado. Desclassificação por mau estado, odor, sementes tóxicas etc. depende de inspeção do classificador e não é calculada.

Sem referência no banco: temperatura do ar de entrada para soja, temperatura na moega, classificação de trigo, feijão, arroz e outras culturas.

Limites "abaixo de" são exclusivos (`limiteMaxExclusivo`): 14,0% já está fora de "abaixo de 14%".

## Como validar uma regra

1. Abrir o documento da fonte (URL na regra) e localizar o trecho.
2. Conferir valor, unidade, escopo e condições. Se o documento disser algo diferente, corrigir a regra e **subir a `versao`**.
3. Preencher `statusValidacao: "validada"`, `validadoPor`, `dataValidacao` e, na fonte, `conferido: true`, `pagina` e `trechoLiteral`.
4. Rodar os testes. A auditoria rejeita regra validada sem responsável, data, trecho conferido ou limite.

Para retirar uma regra de uso, marcar `statusValidacao: "suspensa"`. Não apagar, para manter a rastreabilidade dos registros antigos.

## Catálogo de fabricantes (versão 0.1.0)

Base: lista pública de associadas da **CSMIA/ABIMAQ** (consulta em 04/10/2026), mais marcas relevantes não associadas cujo site foi confirmado. Total: 383 registros.

- **Site do fabricante:** só é registrado quando o título da página confirma a empresa. Alguns endereços óbvios pertencem a outras empresas: `www.tatu.com.br` é uma fábrica de pré-moldados e `www.ikeda.com.br` é um domínio à venda.
- **Segmentos e modelos:** começam vazios e são preenchidos fabricante por fabricante, a partir do site ou catálogo oficial.
- **Uso na regulagem:** este arquivo identifica quem fabrica. Nenhum parâmetro de regulagem vem dele.

## Catálogo de modelos (coleta de 04/10/2026)

| Marca | Modelos | Com especificações | Fonte |
|---|---|---|---|
| Stara | 66 | 50 | comparador de modelos do site |
| John Deere | 170 | 105 | tabelas de especificação (modelos fora de linha descartados) |
| Massey Ferguson | 160 | 156 | tabelas de modelos |
| Valtra | 109 | 108 | tabelas de modelos |
| Case IH | 95 | 95 | dados estruturados da página |
| Jacto | 187 | 158 | catálogo público do site (mercado Brasil, ativos) |
| Lavrale | 128 | 126 | tabelas de modelos (coletor genérico) |
| DMB | 36 | 33 | pares campo/valor da página + links de manual e catálogo de peças |
| Imasa | 15 | 0 | só identificação (páginas sem tabela) |
| Agrimec | 81 | 72 | tabelas transpostas (modelos nas colunas), detectadas automaticamente |
| Tatu Marchesan | 193 | 0 | catálogo do site; especificações só em imagem/PDF — links verificados para 180 manuais, 190 folhetos e 192 fichas técnicas |
| **Total** | **1243** | **905** | |

- **Valores:** copiados como texto literal. A releitura de 60 modelos mostrou 99,4% dos valores idênticos à página; o restante são diferenças de formatação.
- **Uso na regulagem:** as especificações servem para identificar e consultar. Para preencher sozinho um parâmetro de regulagem, o sistema exige confirmação no manual ou folheto do modelo e do ano.
- **Manuais:** quando a página do produto tem link para manual, catálogo de peças ou folheto, ele fica em `documentos`. São a fonte a usar para confirmar parâmetros de regulagem.
- **Pendentes:**
  - New Holland: o robots.txt proíbe a coleta automática da seção Brasil.
  - Fendt: linha brasileira não verificada.
  - Semeato, Agrale, Menta, Kubota, Grazmec, Civemasa, Vicon e Nogueira: o site não tem sitemap utilizável ou usa endereços sem padrão. Precisam de um coletor próprio.

## Lista oficial BNDES/FINAME (fechamento 01/10/2026)

Fonte: arquivo público [`listasno.zip`](https://www.bndes.gov.br/arquivos/produtos-credenciados/listasno.zip) do credenciamento de equipamentos do BNDES. Foram selecionadas as classificações 1 (máquinas e implementos agrícolas), 55 (plataforma de corte), 91 (armazenagem) e 92 (irrigação): **11.107 produtos de 1.891 fabricantes**.

- **Conteúdo:** fabricante (CNPJ, cidade, UF), nome do produto, modelo e **código FINAME**. Não traz especificações técnicas.
- **Cobertura:** inclui marcas que os sites não permitiram coletar, como New Holland e Case IH (CNH), Kuhn, Baldan, Jumil, Vence Tudo, Piccin, Semeato e Agrale, além de centenas de fabricantes regionais e de armazenagem (Kepler Weber, Comil, Pagé, GSI…).
- **Fora da lista:** máquinas importadas não credenciadas, como a Kubota.
- **Catálogo de fabricantes:** foi cruzado pela razão social e passou a ter 2.014 registros. 261 já existiam e ganharam CNPJ; 1.631 foram incluídos pelo BNDES. A marca só é vinculada automaticamente quando identifica uma única empresa.
- **Limite do arquivo:** o nome do produto é cortado em 60 caracteres e o modelo em 45. Textos maiores aparecem truncados.
