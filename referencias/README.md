# Banco de referências — aferição e calibragem

Módulo independente da interface. Pode ser incorporado ao Nexus Agro 2.23 ou ao AgroOperacoes sem alterar telas existentes.

| Arquivo | Conteúdo |
|---|---|
| `regras-afericao.json` | Regras com escopo, limites, condições, fontes e status de validação; tabela ISO 10625; fórmulas |
| `avaliador.js` | Avaliação (`avaliar`) e fluxos compostos; funciona no navegador (`window.NexusAvaliador`) e no Node |
| `catalogo-fabricantes.json` | Fabricantes de máquinas e implementos atuantes no Brasil (identificação; sem parâmetros técnicos) |
| `modelos/` | Modelos por marca, com especificações copiadas do site do fabricante (`indice.json` lista as marcas) |
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
| **Total** | **1050** | **905** | |

- **Valores:** copiados como texto literal. A releitura de 60 modelos mostrou 99,4% dos valores idênticos à página; o restante são diferenças de formatação.
- **Uso na regulagem:** as especificações servem para identificar e consultar. Para preencher sozinho um parâmetro de regulagem, o sistema exige confirmação no manual ou folheto do modelo e do ano.
- **Manuais:** quando a página do produto tem link para manual, catálogo de peças ou folheto, ele fica em `documentos`. São a fonte a usar para confirmar parâmetros de regulagem.
- **Pendentes:**
  - New Holland: o robots.txt proíbe a coleta automática da seção Brasil.
  - Tatu Marchesan: o site (`marchesan.com.br`) busca o catálogo em `api.marchesan.com.br`, que precisa ser liberado no ambiente.
  - Fendt: linha brasileira não verificada.
  - Semeato, Agrale, Menta, Kubota, Grazmec, Civemasa, Vicon e Nogueira: o site não tem sitemap utilizável ou usa endereços sem padrão. Precisam de um coletor próprio.
