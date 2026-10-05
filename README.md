# Agro Operações

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.8.0-beta1` — aferição e calibragem simplificada (3 passos, um campo por medição, resultado que aponta o item a corrigir), indicadores com gráficos na Visão Geral, catálogo organizado por marca e tipo, cartões de máquina enxutos, classificação oficial de soja (IN 11/2007) e milho (IN 60/2011) na moega, secador e moega, aferição e calibragem com referências técnicas validadas e catálogo de máquinas offline.

### Funcionalidades

- **Visão geral**: indicadores calculados a partir dos registros, ações rápidas e alertas (estoque baixo, revisão próxima/vencida, manutenção aberta, lote aguardando análise, operação atrasada).
- **Operações**: planejar, iniciar e concluir atividades por talhão, máquina, área e equipe; filtros por hoje, próximas, em aberto e concluídas.
- **Máquinas e manutenção**: horímetro com histórico, revisão programada por intervalo de horas, ordens de manutenção preventiva/corretiva com custo. Ao concluir uma preventiva, a próxima revisão é recalculada.
- **Talhões**: área, cultura, cultivar, safra e histórico de operações e insumos aplicados (com dose por hectare).
- **Produção de sementes / lotes**: etapas do lote (campo → análise → expedição), germinação e vigor, e linha do tempo de rastreabilidade (eventos do lote + operações e insumos do talhão de origem).
- **Estoque**: itens com estoque mínimo, entradas, saídas (com bloqueio de saldo negativo), ajuste de inventário e consumo por talhão.
- **Relatórios**: operações por tipo, horas por máquina, consumo de insumos e custo de manutenção (7/30/90 dias ou 12 meses); exportação CSV (compatível com Excel).
- **Aferição e calibragem** (3 passos: o que aferir e máquina → medição → resultado; o tipo de equipamento é definido pela avaliação escolhida, perguntas de conferência em botões Sim/Não, um campo por bico/ponto/bandeja com prévia enquanto digita, e o resultado aponta qual item corrigir): vazão de bicos, taxa de aplicação, sensor de velocidade/fluxômetro, distribuição de sementes, dose (kg/ha), CV de distribuidor a lanço e perdas na colheita. O resultado só é concluído quando existe referência validada aplicável (ver `referencias/`); caso contrário mostra "Não foi possível avaliar" e o que falta. Cada registro guarda o resultado, a regra, a versão e os limites do momento, e gera relatório de medição e comparação (imprimir/PDF).
- **Secador e moega** (4 etapas: equipamento e produto/lote → etapa e ponto de medição → medições → resultado): temperatura avaliada somente contra referência do mesmo ponto (ar de entrada, massa de grãos…), produto, destino e etapa; umidade inicial/final/meta, quebra de peso estimada, registro no histórico do lote e relatório. Sem referência aplicável: "Não foi possível avaliar".
- **Indicadores na Visão Geral** (período de 7, 30 ou 90 dias): área trabalhada, horas por máquina, operações por situação e estoque × mínimo. Gráficos feitos no próprio app (funcionam offline), com cores testadas para daltonismo nos temas claro e escuro, dica ao tocar e tabela com os números.
- **Catálogo por marca**: 1.894 marcas que unem as fichas dos fabricantes e a lista oficial do BNDES/FINAME pela marca comercial (CNH → New Holland e Case IH; AGCO → Massey Ferguson, Valtra e Fendt; Marchesan → Tatu e Civemasa). Filtro por tipo de máquina, busca única e página da marca com os modelos agrupados por tipo.
- **Classificação na moega** (recebimento): enquadramento em tipo pelo texto oficial do MAPA — soja Grupo I (Tipo 1, Tipo 2) e Grupo II (Padrão Básico) pela IN 11/2007; milho Tipo 1 a 3 pela IN 60/2011. Pior tipo entre os defeitos, arredondamento da norma, Fora de Tipo com a consequência do artigo, desclassificação (defeitos graves da soja; ardidos, avariados e carunchados do milho). Umidade comparada com os 14% recomendados. A norma não define desconto; o app não calcula desconto.
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

## Plataformas

O mesmo código (`app/src/main/assets/www`) roda em todas as plataformas; recursos nativos ficam atrás de `window.AndroidBridge` e têm alternativa no navegador (download do backup, impressão/PDF pelo navegador).

| Plataforma | Como obter | Situação |
|---|---|---|
| Android (APK) | GitHub Actions → *Build Agro Operações APK* → artefato | disponível |
| Navegador | GitHub Pages: `https://simulagamer-ofc.github.io/AgroOperacoes/` (workflow `pages.yml`, publica a cada push na `main` que altere o app ou o banco) | requer ativar o Pages uma vez: *Settings → Pages → Source: GitHub Actions* |
| Windows (instalado) | Abrir o endereço acima no Edge ou Chrome → botão **Instalar aplicativo** (ou ícone de instalar na barra de endereço). Cria atalho no menu Iniciar, abre em janela própria e funciona sem internet | disponível assim que o Pages estiver ativo |
| Windows (instalador .exe) | Empacotar a mesma pasta `www` com Electron ou Tauri | futuro |

Os dados ficam no aparelho/navegador onde foram lançados (armazenamento local). Para levar dados de um para outro, use **Cadastros e Backup → Exportar / Restaurar backup (JSON)**. Não há sincronização automática.
