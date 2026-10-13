# Nexus Agro

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.28.1-beta1` — revisão geral (todas as telas e botões testados sem erro, análise estática sem referências quebradas) e correções: aviso de praga no nível de ação agora some após 30 dias ou quando há aplicação no talhão depois do monitoramento; os avisos (sininho e Visão geral) mostram só as telas liberadas para a função da pessoa; no navegador, aviso de **nova versão** com botão “Atualizar agora” (não precisa mais fechar e abrir o site).

`0.28.0-beta1` — aferição profissional e simples: **inspeção periódica do pulverizador** pelos critérios da ISO 16122-2 (por exceção, 10 grupos, aferição do manômetro em 4 pontos com tolerância ±0,2 bar / ±10%, bomba ≥ 90% da nominal, bicos pela aferição já registrada, relatório com responsável, registro profissional e validade no calendário; só para funções técnicas); **coleta rápida** com cronômetro do app, volume ou peso no tempo de coleta (convertido para L/min) e **velocidade pelo GPS do celular**, com o método registrado no relatório; **impacto estimado** em reais, sacas e sementes com a conta aberta e a origem de cada número (área dos talhões, preço das vendas, custo informado); condições da medição numa **confirmação única**. Teste que impede nomes globais repetidos entre os scripts.

`0.27.0-beta1` — aferição e calibragem mais inteligentes (offline): **diagnóstico automático** da causa provável (trecho da barra com vazão baixa, bico entupido, pontas gastas e quando trocar o jogo todo, barra inteira acima/abaixo, duplos × falhas no plantio, lado/bordas no lanço, perda na plataforma × interna); **ajuste calculado** (velocidade, pressão ou ponta para acertar a taxa; novo fator de calibração do sensor/fluxômetro; quanto mudar a regulagem da dose); **previsão de troca das pontas** pela tendência das aferições (por horas de uso ou dias); **reaferição adaptativa** (resultado fora → confirmar em 3 dias; desgaste previsto → antecipa). Nova opção **ponta nova como referência** quando não há a tabela do fabricante (critério prático de ±10%, marcado no relatório). As orientações não mudam o resultado oficial, que continua só com referências validadas.

`0.26.0-beta1` — login profissional com **acesso por solicitação**: a pessoa toca em *Solicitar acesso*, escolhe o próprio usuário e senha e digita o código da fazenda; fica *aguardando autorização* (sem ver dados) até o ADM **Autorizar** (escolhendo função e nível) ou **Recusar**. O ADM vê os pedidos com número no menu, o **código da fazenda** (com *Gerar novo código*), o **último acesso** de cada um, **desativa/reativa** e gera **senha provisória** (a pessoa é obrigada a criar a dela no próximo login). *Minha conta* para trocar a própria senha; *Esqueci minha senha* (usuário → senha provisória com o ADM; e-mail → link de recuperação); olho para mostrar a senha e botão *Entrando…*. Corrige também uma regra antiga do banco que barrava os níveis ADM e Supervisor. Migração `supabase/migrations/20261012210000_solicitacao_acesso.sql` (já aplicada).

`0.25.3-beta1` — envio automático sem controle do usuário: os dados sobem sozinhos com internet (ao salvar, a cada minuto, ao voltar o sinal, ao sair do app e ao sair da conta); não há mais botão de sincronizar nem troca por arquivo com a nuvem ligada; dados ainda não enviados não podem ser apagados, restaurados por backup nem trocados por outra fazenda — se sair sem internet, sobem no próximo login.

`0.25.2-beta1` — segurança: só o Admin do sistema cria fazendas e não há mais cadastro aberto na tela de entrada; senhas novas com pelo menos 8 caracteres (e aviso de senha vazada); **Sair e apagar os dados** deste aparelho; visitantes sem login sem nenhuma permissão nas tabelas (migração `supabase/migrations/20261012200000_seguranca.sql`, já aplicada).

`0.25.1-beta1` — nova logo e ícone do app: globo em 3D com os ícones em hexágono (azul e verde) em volta, sem fundo (APK, navegador/PWA e tela de entrada).

`0.25.0-beta1` — **funções**: cada usuário é cadastrado com a sua função (Diretor, Gerente, Administrativo/Financeiro, Agrônomo, Encarregado de campo, Operador de máquinas/Tratorista, Monitor de pragas, Aplicador, Chefe de oficina, Mecânico, Abastecedor, Responsável UBS, Operador de secador, Classificador, Almoxarife ou Personalizado) e vê no menu só as telas dela. O ADM pode acrescentar ou tirar telas de cada pessoa em **Função e telas**. A função decide as telas; o nível decide o que a pessoa faz nelas. Um usuário comum com Financeiro ou Produção na função recebe e vê o financeiro (migração `supabase/migrations/20261012190000_funcoes.sql`).

`0.24.1-beta1` — o topo do menu mostra quem está usando: o nome da fazenda aberta (vindo da nuvem) e o usuário com o nível; o ADM do sistema passa a se chamar **Admin do sistema** e, sem fazenda aberta, aparece como "Admin do sistema" no lugar de "Minha fazenda".

`0.24.0-beta1` — no rodapé do menu, botões só com ícone: **sol/lua** para trocar o tema e **desligar** para sair do sistema (pede confirmação e envia o que falta antes). Painel com mais períodos: **Hoje, 7, 30, 90 dias, 12 meses** e **Datas** (escolha de início e fim).

`0.23.1-beta1` — ícones do menu no estilo da tela de abertura: hexágonos com brilho verde (campo, grãos e gestão) e azul (máquinas e sistema), também na barra inferior do celular. Com o menu recolhido, ficam só os ícones, e cada um continua abrindo a sua tela.

`0.23.0-beta1` — **ADM do sistema**: entra sem precisar de fazenda e, em Cadastros e backup, tem o painel **Administração do sistema** com todas as fazendas: cria fazendas, entra em qualquer uma como ADM e gerencia os usuários de todas. Sem fazenda aberta, o que ele lança fica só no aparelho. A conta é marcada na tabela `system_admins` (migração `supabase/migrations/20261012170000_adm_do_sistema.sql`).

`0.22.1-beta1` — menu lateral recolhível: o botão « no topo do menu recolhe para uma faixa estreita com ☰ (a escolha fica guardada no aparelho), deixando a tela inteira para o conteúdo. No tablet em pé o menu fica recolhido e abre por cima do conteúdo.

`0.22.0-beta1` — o sistema só abre com **usuário e senha** (tela de entrada no APK e no navegador); depois de entrar uma vez, continua funcionando sem internet. Ao sair, pede o login de novo. Se outra pessoa de outra fazenda entrar no mesmo aparelho, os dados da fazenda anterior saem do aparelho. Menu lateral mais largo, com os nomes em uma linha.

`0.21.0-beta1` — **níveis de acesso**: o ADM cria o login e a senha de cada pessoa (sem precisar de e-mail) e escolhe o nível. **ADM**: tudo, inclusive usuários. **Supervisor**: lança, edita e exclui tudo e vê o financeiro. **Usuário comum**: lança no dia a dia, edita só o que ele lançou, não exclui e não vê o financeiro (gastos, contas, vendas, produção e margem). As regras valem no aparelho e no servidor (`supabase/migrations` e a função `supabase/functions/usuarios`).

`0.20.0-beta1` — **nuvem da equipe (Supabase)**: em Cadastros e backup, cada pessoa cria a própria conta, cria uma fazenda ou entra numa com o código de convite, e o app sincroniza sozinho entre celulares, tablets e computadores. Continua funcionando sem internet: as alterações ficam guardadas no aparelho e sobem quando o sinal volta. Conflitos: vale a alteração mais recente; no estoque, os lançamentos dos dois aparelhos somam no saldo. A sincronização por arquivo continua disponível para quem não tem internet.

`0.19.2-beta1` — abertura com o globo Nexus por 5 segundos, disponível offline no navegador/PWA e APK, sem repetir ao trocar de menu; tipografia unificada entre telas. Painel com o visual aprovado: custos por categoria em barras horizontais, evolução mensal em colunas, rosca de operações e insumos em atenção. O filtro de 7/30/90 dias aplica-se aos custos por categoria, às operações e aos indicadores adicionais. A evolução mensal mostra seis meses (com o mês atual identificado como parcial); estoque mostra o saldo atual. Os quadros usam somente registros reais e mostram estados vazios quando não há dados. Ações rápidas, operações, alertas e indicadores adicionais continuam disponíveis na seção expansível abaixo do painel.

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
- **Configuração da máquina para aferição** (menu ⋯ do cartão da máquina): espaçamento e número de bicos, barra, modelo da ponta, faixas de pressão e velocidade, linhas e espaçamento, largura da plataforma e da faixa de aplicação. Se a máquina está vinculada ao catálogo, a ficha do fabricante mostra as opções com o texto original e o usuário escolhe (nada é escolhido automaticamente). As aferições usam esses valores com selo de origem, avisam quando a medição foge da configuração (sem mudar o resultado) e o relatório registra de onde veio cada valor.
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
