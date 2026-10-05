# Agro Operações

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.5.0-beta1` — classificação da soja na moega (IN 11/2007), secador e moega, aferição e calibragem com referências técnicas validadas e catálogo de máquinas offline.

### Funcionalidades

- **Visão geral**: indicadores calculados a partir dos registros, ações rápidas e alertas (estoque baixo, revisão próxima/vencida, manutenção aberta, lote aguardando análise, operação atrasada).
- **Operações**: planejar, iniciar e concluir atividades por talhão, máquina, área e equipe; filtros por hoje, próximas, em aberto e concluídas.
- **Máquinas e manutenção**: horímetro com histórico, revisão programada por intervalo de horas, ordens de manutenção preventiva/corretiva com custo. Ao concluir uma preventiva, a próxima revisão é recalculada.
- **Talhões**: área, cultura, cultivar, safra e histórico de operações e insumos aplicados (com dose por hectare).
- **Produção de sementes / lotes**: etapas do lote (campo → análise → expedição), germinação e vigor, e linha do tempo de rastreabilidade (eventos do lote + operações e insumos do talhão de origem).
- **Estoque**: itens com estoque mínimo, entradas, saídas (com bloqueio de saldo negativo), ajuste de inventário e consumo por talhão.
- **Relatórios**: operações por tipo, horas por máquina, consumo de insumos e custo de manutenção (7/30/90 dias ou 12 meses); exportação CSV (compatível com Excel).
- **Aferição e calibragem** (fluxo em 4 etapas: equipamento → condições → medições → resultado): vazão de bicos, taxa de aplicação, sensor de velocidade/fluxômetro, distribuição de sementes, dose (kg/ha), CV de distribuidor a lanço e perdas na colheita. O resultado só é concluído quando existe referência validada aplicável (ver `referencias/`); caso contrário mostra "Não foi possível avaliar" e o que falta. Cada registro guarda o resultado, a regra, a versão e os limites do momento, e gera relatório de medição e comparação (imprimir/PDF).
- **Secador e moega** (4 etapas: equipamento e produto/lote → etapa e ponto de medição → medições → resultado): temperatura avaliada somente contra referência do mesmo ponto (ar de entrada, massa de grãos…), produto, destino e etapa; umidade inicial/final/meta, quebra de peso estimada, registro no histórico do lote e relatório. Sem referência aplicável: "Não foi possível avaliar".
- **Classificação na moega** (recebimento): avariados, partidos/quebrados/amassados e matérias estranhas da amostra. Soja para comercialização é comparada com as tolerâncias da IN 11/2007 (avariados 8%, quebrados 30%, conferidas em publicação da Embrapa), com o excesso em p.p. sujeito a desconto direto. Milho (IN 60/2011) e impurezas ainda sem referência validada.
- **Catálogo de máquinas offline**: 1.243 modelos com fichas técnicas e manuais dos sites dos fabricantes e 11.107 produtos agrícolas da lista oficial BNDES/FINAME. Máquinas da frota podem ser vinculadas a um modelo do catálogo.
- **Cadastros e backup**: dados da propriedade, exportação/restauração de backup JSON, dados de exemplo e limpeza.
- **Pesquisa** global (sem acentos) e tema claro/escuro.

### Estrutura

- `app/src/main/assets/www/` — interface web (`index.html`, `styles.css`, `app.js`), também utilizável como PWA.
- `app/src/main/assets/www/afericao.js` — catálogo e aferição; `avaliador.js` e `dados/` são gerados a partir de `referencias/` por `python3 referencias/ferramentas/gerar_dados_app.py`.
- `app/src/main/java/.../MainActivity.kt` — WebView que carrega os arquivos do APK e expõe `AndroidBridge.saveFile` (backup/CSV) e `AndroidBridge.printPage` (relatório em PDF).
- `referencias/` — regras de aferição com fontes conferidas, avaliador, catálogos e ferramentas de coleta (ver `referencias/README.md`). Testes: `node --test referencias/tests/*.test.js`.

Os dados ficam em `localStorage` (chave `agro-db-v1`). Registros da versão `0.1.0-beta1` são migrados automaticamente.

### Build

O APK de depuração é gerado pelo GitHub Actions (`.github/workflows/android.yml`) a cada push na `main` e em pull requests.
