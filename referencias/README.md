# Banco de referências — aferição e calibragem

Módulo independente da interface. Pode ser incorporado ao Nexus Agro 2.23 ou ao AgroOperacoes sem alterar telas existentes.

| Arquivo | Conteúdo |
|---|---|
| `regras-afericao.json` | Regras com escopo, limites, condições, fontes e status de validação; tabela ISO 10625; fórmulas |
| `avaliador.js` | Avaliação (`avaliar`) e fluxos compostos; funciona no navegador (`window.NexusAvaliador`) e no Node |
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

## Situação das regras (versão 1.0.0 do banco)

**Nenhuma regra está validada.** As fontes foram localizadas por pesquisa, mas o acesso direto aos documentos estava bloqueado no ambiente em que o banco foi montado. Por isso todas estão `pendente_conferencia`, e o sistema devolve `SEM_REFERENCIA` mostrando a referência candidata.

| ID | Avaliação | Limite candidato | Fonte principal | Confiança |
|---|---|---|---|---|
| PULV-BICO-CAT-01 | Vazão do bico × catálogo | ±10% | Embrapa Documentos 102; ISO 16122-2 | alta |
| PULV-BICO-MED-01 | Vazão do bico × média da barra | ±10% | Embrapa Documentos 102 | alta |
| PULV-SENSOR-01 | Sensor de velocidade / fluxômetro × referência | ±5% | ISO 16122-2 | média |
| SEM-ESPAC-01 | % espaçamentos aceitáveis (0,5–1,5 Xref) | ≥ 90% (mín. 50 espaçamentos) | ABNT (1984); Kurachi et al. (1989) | média |
| ADUB-CV-N-01 | CV transversal, fertilizante nitrogenado | ≤ 15% | Spreadmark (NZ); método ISO 5690-1 | média |
| ADUB-CV-OUT-01 | CV transversal, não nitrogenado/calcário | ≤ 25% | Spreadmark (NZ) | média |
| COLH-PERDA-SOJA-01 | Perdas na colheita — **somente soja** | ≤ 1 sc 60 kg/ha | Embrapa Soja (copo medidor) | alta |
| PULV-TAXA-01 | Taxa medida × planejada | **sem fonte** | — | — |
| DOSE-PLAN-01 | Dose adubo/semente × planejada | **sem fonte** | — | — |

Sem referência no banco (o sistema não avalia): perdas de milho, trigo, feijão e outras culturas; pressão do manômetro; tamanho de gota; condições climáticas de aplicação.

## Como validar uma regra

1. Abrir o documento da fonte (URL na regra) e localizar o trecho.
2. Conferir valor, unidade, escopo e condições. Se o documento disser algo diferente, corrigir a regra e **subir a `versao`**.
3. Preencher `statusValidacao: "validada"`, `validadoPor` e `dataValidacao`.
4. Rodar os testes. A auditoria rejeita regra validada sem responsável, data, fonte ou limite.

Para retirar uma regra de uso, marcar `statusValidacao: "suspensa"`. Não apagar, para manter a rastreabilidade dos registros antigos.
