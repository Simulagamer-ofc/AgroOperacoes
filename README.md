# Nexus Agro

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.38.0-beta2` — **Relatório em PDF**:
- botão **Baixar relatório (PDF)** em Relatórios, respeitando o período selecionado, com resumo, consumo e operações detalhadas; funciona offline. Exportações CSV preservadas.
- salvamento binário no Android e paginação automática para relatórios longos.
- consumo de insumos exclui movimentações futuras, como os demais indicadores do período.

`0.38.0-beta1` — **Todas as culturas de grãos e "Inserir norma"**:
- moega, secador, silos e relatórios aceitam as culturas de grão do Brasil (soja, milho, trigo, arroz, feijão, sorgo, algodão, amendoim, girassol, aveia, cevada, centeio, triticale, gergelim, ervilha, café, canola, milheto, grão-de-bico, lentilha, chia, crambe) e **Outro** com nome digitado.
- normas oficiais conferidas com trecho literal: trigo (IN MAPA 38/2010 — classificação Grupo I; umidade de comercialização e armazenagem; temperatura da massa na secagem — Embrapa) e arroz em casca (IN MAPA 6/2009 alterada pela IN 2/2012; semente — Embrapa Arroz e Feijão). Não carregados por falta de fonte sem ambiguidade: trigo Grupo II e arroz beneficiado.
- **Inserir norma**: onde o app diria "Não foi possível avaliar" (leitura do secador, umidade de saída, classificação, aferição de máquinas e implementos) aparece o botão. Ele abre uma tela própria só com os campos que aquela avaliação precisa (nas mesmas unidades das normas oficiais, fonte obrigatória); **Inserir** salva e volta exatamente ao ponto onde estava, com tudo preservado e a avaliação refeita; **Cancelar** volta sem salvar. A regra fica marcada como "referência da fazenda, por <nome>, em <data>", separada das oficiais — se houver norma oficial, ela prevalece.
- só ADM, supervisor e agrônomo inserem ou editam; o operador não vê o botão. Nova tela **Referências técnicas** para listar, editar, desativar e excluir as referências da fazenda.

`0.37.0-beta1` — **Grãos completo para o setor**:
- tabela de desconto da cooperativa (% por ponto) e quebra técnica no romaneio (lembra por produto); classificação oficial da carga (IN 11/2007 soja, IN 60/2011 milho) ligada ao romaneio; **comprovante impresso** da carga e da expedição com assinaturas; **grão de terceiros** (saldo separado, não vira colheita, extrato com cobrança de secagem por tonelada e armazenagem por saca/mês, calculada por dia); expedição pode **lançar a venda** em Produção e Financeiro (excluir a saída tira a venda); umidade e impureza na expedição; temperatura do grão na descarga; secagem de semente ligada ao lote da UBS; **checklist de limpeza do secador** (aviso a cada 7 dias de uso); **expurgo** com fim da exposição (silo travado para saída) e vistoria de insetos; origem do grão de cada silo por talhão. Também: **previsão de término da secagem** pela umidade desejada (aviso quando chega), **inventário do silo** (medido × sistema, diferença em % e ajuste automático), **relatório da safra de grãos** para imprimir, **medidor de umidade** (conferência com referência, efeito no desconto em kg e verificação anual do Inmetro — Portaria Inmetro nº 47/2022), aviso de **placa repetida** em até 30 min, **amostra de contraprova** no romaneio e **energia elétrica** no custo da secagem.

`0.36.0-beta1` — **Moega, secador e silos ligados** (menu Grãos):
- **Moega (romaneio)**: placa, motorista, talhão, peso bruto e tara, umidade e impureza da amostra, padrões do contrato (lembra o último) → peso líquido, descontos por balanço de massa e peso final em kg e sacas. A carga **vira colheita do talhão em Produção** sozinha (editar o romaneio atualiza; excluir remove) e vai para o secador ou direto ao silo (carga úmida direto ao silo pede confirmação).
- **Secador (secagem por lote)**: iniciar puxa as cargas que esperam o secador (carga sem a impureza e umidade média ponderada); planilha de hora em hora (ar, massa, umidade de saída) avaliada pelo banco de referências, com gráfico da massa e alerta quando passa do limite; ao finalizar: umidade final conferida (soja em grão 12–13%), grão seco, água retirada, pontos/h, t/h, combustível por tonelada e custo por saca.
- **Silos**: saldo calculado (recebido direto + saída do secador + transferências − expedições), ocupação pela capacidade, umidade média, saída/transferência/ajuste (não deixa sair mais que o saldo), termometria por cabo com variação desde a leitura anterior e **horas boas para aerar** pela previsão do tempo (ar ≥ 5 °C abaixo dos grãos — Embrapa Milho e Sorgo, Circ. Téc. 55).
- Avisos na tela inicial: secador acima da referência, sem leitura há mais de 2 h, cargas esperando secagem, silo ≥ 95% e cabo subindo 2 °C ou mais.
- Servidor: a tabela de registros aceitava só nomes antigos de coleção e recusava o envio da maioria dos dados; corrigido (migração `20261015090000_records_store_livre.sql`, já aplicada).

`0.35.1-beta1` — **secador e moega revisados** (banco de referências 1.6.0): soja em grão passa a ter referência de secagem e armazenagem da Embrapa Soja, Circular Técnica 224 (2026) — massa de grãos até 40 °C e teor de água final entre 12% e 13% (acima de 13% fora; abaixo de 12% atenção por supersecagem); as regras antigas de 2005 (48 °C e 14% para agroindústria) foram suspensas; na moega, umidade acima de 14% virou **atenção** (encaminhar ao secador e aplicar desconto), não alerta vermelho a cada carga.

`0.35.0-beta1` — **visual profissional e funcional**:
- Padrão: um só estilo de ícone (linha) no lugar dos símbolos; três tipos de botão; cores com significado (verde ok, laranja atenção, vermelho urgente, azul informação; seleção em cor neutra); títulos em escala; números alinhados; gráfico mensal sem meses vazios no começo; telas vazias com a próxima ação.
- Menu lateral: grupos que abrem e fecham (o da tela aberta fica aberto), nomes inteiros e **Mais usados** (aprende com o uso).
- Campo: tema **Campo** (claro de alto contraste, letras maiores, para sol forte) e **Automático** (Campo de dia, Noturno à noite); alvos de toque de 44–48 px; botão **+** no celular com os registros mais comuns (respeita a função); sincronização sempre à vista no topo (sincronizado há X min, N na fila, sem internet, erro).
- Agrônomo: **situação de cada talhão** (praga no nível de ação, carência, colheita próxima, sem monitoramento, em dia); **mapa da fazenda** pintado pela situação (contornos GPS, sem internet); **cartão do talhão** (cultura e estágio, última aplicação e carência, último monitoramento com foto, chuva, produtividade); **linha do tempo da safra** no talhão e no relatório.
- Relatórios impressos/PDF com cabeçalho (fazenda, responsável técnico com CREA/CFTA, data de emissão) e linhas de assinatura; responsável técnico em Cadastros.
- Tela inicial por função: agrônomo, monitor e encarregado veem a situação dos talhões; equipe de campo vê a lista do dia já aberta.

`0.34.4-beta1` — **tela inicial organizada**: barra de pesquisa e avisos de volta ao topo; o quadro **Hoje** fica recolhido numa linha (quantas pendências, atrasadas, em andamento, avisos e a mais urgente) com botão para expandir, como o clima; os **gráficos voltam à mostra** logo abaixo dos indicadores.

`0.34.3-beta1` — **clima no estilo dos apps de previsão**: próximos 4 períodos (madrugada, manhã, tarde, noite) com temperatura, ícone do tempo (sol, nuvens, chuva, trovoada) e chance de chuva; 7 dias com máxima e mínima, ícone, horas de sol, chance e milímetros de chuva, vento e confiança (rolagem lateral no celular).

`0.34.2-beta1` — **previsão do tempo combinada de 4 modelos** (ECMWF, GFS, ICON e GEM, via Open-Meteo), a mesma ideia dos apps de clima grandes: a média erra menos que um modelo só. Cada dia mostra **✓ firme** ou **⚠ incerta** conforme os modelos concordam sobre chuva e temperatura; com o dia de hoje incerto, o app avisa para conferir de novo antes de pulverizar ou plantar. Se o serviço recusar os modelos, volta sozinho ao modelo automático.

`0.34.1-beta1` — **fotos mais leves, mesma nitidez**: WebP com qualidade automática (~150–250 KB por foto, antes ~300–450 KB; no iPhone, que não gera WebP, o app usa o codificador oficial libwebp embutido em `lib/webp` — Apache-2.0, ~320 KB, carregado só quando precisa), miniatura de ~15–25 KB para listas e relatórios (a foto inteira só é baixada ao tocar), limpeza automática no celular (foto já enviada e sem uso há 60 dias fica só a miniatura; fotos de registros excluídos saem) e na nuvem (excluir o registro ou a foto apaga os arquivos; sem internet, fica na fila).

`0.34.0-beta1` — **fotos nos registros** de pragas e doenças, manutenção e inspeção periódica: tirar pela câmera (no APK, a câmera aparece junto com a galeria) ou escolher da galeria; a foto é reduzida no celular (~200 KB), guardada no aparelho e enviada sozinha para a nuvem da fazenda quando há internet (bucket privado, só quem é da fazenda vê); os outros aparelhos baixam ao abrir. Até 6 fotos por registro; quem tirou, o supervisor ou o ADM podem remover. Migração `supabase/migrations/20261014000000_fotos.sql` (rodar no SQL Editor).

`0.33.0-beta1` — **comparativo de safras e talhões** (botão em Produção e margem): conclusões escritas pelo app (melhor e pior talhão, variação da produtividade e do custo por saca contra a safra anterior com a chuva de cada uma, talhão abaixo da média em várias safras); tabela safra a safra; ranking dos talhões em barras; cada talhão ao longo das safras. Custos e margem só para quem vê o financeiro.

`0.32.0-beta1` — talhão inteligente: **data de plantio automática** ao concluir o plantio; nos talhões, **dias após o plantio**, **chuva desde o plantio** e **colheita prevista** (com o ciclo da cultivar, campo novo opcional); avisos de **monitorar pragas** (mais de 7 dias sem monitoramento, com botão “Monitorar” já no talhão) e de **colheita prevista em até 10 dias** (com alerta de carência). Tela inicial mais leve: gráficos do painel recolhidos em “Ver gráficos” e o painel de custos só para quem vê o financeiro.

`0.31.0-beta1` — **ações direto nos avisos** (revisão → “Abrir revisão” já preenchida; estoque acabando → “Lista de compras”); **lista de compras** automática (itens abaixo do mínimo ou que acabam em 30 dias, com a quantidade para ~30 dias de consumo) e **resumo da semana** (operações, área, horas, colheita, aplicações, chuva, diesel, gastos, próximos 7 dias e pendências) para compartilhar no WhatsApp ou e-mail; **conferências** que pedem confirmação em horímetro com salto de mais de 24 h por dia e em lançamento repetido (abastecimento, aplicação, chuva).

`0.30.1-beta1` — tela inicial mais limpa: o clima vira uma linha (temperatura de hoje e as horas boas para pulverizar) com um botão para expandir os 4 dias, as janelas, a chuva e o critério, como o botão do menu; a escolha fica lembrada. O “Hoje” mostra os 4 itens mais urgentes e “Ver mais”.

`0.30.0-beta1` — mais automação: **custo por hora de cada máquina** (combustível + manutenção dos últimos 12 meses) e **custo de máquina de cada operação** (horas × custo/h; também no relatório da safra), só para quem vê o financeiro; **duração prevista** das operações programadas pelo rendimento das anteriores da mesma máquina e tipo; **chuva de ontem sugerida** pela previsão do tempo quando ninguém registrou (um toque abre o registro para conferir no pluviômetro); **aviso ao programar colheita dentro da carência**; avisos dos formulários ficam mais tempo na tela.

`0.29.1-beta1` — operações fora do talhão (beneficiamento e tratamento de sementes, transporte, manutenção) não pedem mais área trabalhada; beneficiamento e tratamento registram a quantidade de sementes (kg) e o rendimento em kg/h. A área desses tipos não entra mais nos totais de hectares.

`0.29.0-beta1` — automação do dia a dia: **Hoje** na Visão geral (o que fazer em ordem de prioridade, com Iniciar/Concluir direto); **clima e janelas de pulverização** (previsão Open-Meteo de 4 dias para a sede ou o contorno de um talhão; boas horas por vento, Delta T, temperatura, umidade e chuva; guardada para ver sem sinal); **concluir operação** já registra o horímetro final (atualiza máquina, revisões e consumo), as horas trabalhadas, a área e o rendimento em ha/h; **revisão prevista por data** pelo ritmo de uso; **estoque que avisa antes de acabar** (“compre até”); **aviso de pulverizador** com aferição/inspeção vencida ou reprovada ao iniciar pulverização ou lançar aplicação; **relatório da safra por talhão** (operações, aplicações com receituário e carência, monitoramento, chuva, colheita, custos e margem) para imprimir/PDF; **“lançado por”** com o nome de quem registrou.

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
