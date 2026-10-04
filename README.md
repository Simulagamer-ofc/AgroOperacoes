# Agro Operações

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.2.0-beta1` — módulos funcionais com dados salvos no próprio aparelho.

### Funcionalidades

- **Visão geral**: indicadores calculados a partir dos registros, ações rápidas e alertas (estoque baixo, revisão próxima/vencida, manutenção aberta, lote aguardando análise, operação atrasada).
- **Operações**: planejar, iniciar e concluir atividades por talhão, máquina, área e equipe; filtros por hoje, próximas, em aberto e concluídas.
- **Máquinas e manutenção**: horímetro com histórico, revisão programada por intervalo de horas, ordens de manutenção preventiva/corretiva com custo. Ao concluir uma preventiva, a próxima revisão é recalculada.
- **Talhões**: área, cultura, cultivar, safra e histórico de operações e insumos aplicados (com dose por hectare).
- **Produção de sementes / lotes**: etapas do lote (campo → análise → expedição), germinação e vigor, e linha do tempo de rastreabilidade (eventos do lote + operações e insumos do talhão de origem).
- **Estoque**: itens com estoque mínimo, entradas, saídas (com bloqueio de saldo negativo), ajuste de inventário e consumo por talhão.
- **Relatórios**: operações por tipo, horas por máquina, consumo de insumos e custo de manutenção (7/30/90 dias ou 12 meses); exportação CSV (compatível com Excel).
- **Cadastros e backup**: dados da propriedade, exportação/restauração de backup JSON, dados de exemplo e limpeza.
- **Pesquisa** global (sem acentos) e tema claro/escuro.

### Estrutura

- `app/src/main/assets/www/` — interface web (`index.html`, `styles.css`, `app.js`), também utilizável como PWA.
- `app/src/main/java/.../MainActivity.kt` — WebView que carrega os arquivos do APK e expõe `AndroidBridge.saveFile` para salvar backups/CSV pelo seletor de arquivos do Android.

Os dados ficam em `localStorage` (chave `agro-db-v1`). Registros da versão `0.1.0-beta1` são migrados automaticamente.

### Build

O APK de depuração é gerado pelo GitHub Actions (`.github/workflows/android.yml`) a cada push na `main` e em pull requests.
