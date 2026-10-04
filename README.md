# Agro Operações

Sistema para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

Funciona em três lugares, com os **mesmos dados sincronizados** para toda a equipe da fazenda:

| Onde | Como acessar |
|---|---|
| **Celular Android** | APK gerado pelo GitHub Actions (aba *Actions* → build → *Artifacts*). |
| **Navegador** | https://simulagamer-ofc.github.io/AgroOperacoes/ |
| **Computador** | Abra o site no Chrome ou Edge e clique em **Instalar aplicativo** (ícone na barra de endereço ou botão no topo). Vira um programa com ícone na área de trabalho e no menu Iniciar. |

Tudo funciona **sem internet**: cada aparelho salva os dados localmente e envia/recebe as alterações quando a conexão volta.

## Versão atual

`0.3.0-beta1`

- **Sincronização com a equipe** (Supabase): conta com e-mail e senha, fazenda compartilhada por código, envio automático das alterações, funcionamento offline com fila de pendências.
- **Visão geral** com indicadores e alertas calculados a partir dos dados reais.
- **Operações**, **máquinas e manutenção**, **talhões**, **produção de sementes**, **lotes** com rastreabilidade, **estoque**, **relatórios** e **cadastros**.
- **Pesquisa** em todos os registros e **alertas** no sino.
- **Backup** e exportação **CSV**.

## Configuração (uma vez só)

### 1. Servidor de sincronização (Supabase)

1. Crie uma conta grátis em https://supabase.com e um projeto novo (região: *South America (São Paulo)*).
2. No projeto, abra **SQL Editor**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → URL Configuration**, coloque em *Site URL*: `https://simulagamer-ofc.github.io/AgroOperacoes/`.
4. (Opcional) Em **Authentication → Sign In / Providers → Email**, desligue *Confirm email* se não quiser que cada pessoa confirme o e-mail antes de entrar.
5. Em **Project Settings → API**, copie o *Project URL* e a chave *anon public* e coloque em [`app/src/main/assets/www/js/config.js`](app/src/main/assets/www/js/config.js). A chave anon é pública por natureza; quem protege os dados são as regras do banco.

Sem o passo 5, dá para informar o servidor em cada aparelho, em **Cadastros → Sincronização → Servidor**.

### 2. Site (GitHub Pages)

1. Em **Settings → General → Danger Zone**, deixe o repositório **público** (o GitHub Pages grátis exige isso; os dados da fazenda ficam no Supabase, não no repositório).
2. Em **Settings → Pages**, em *Source*, escolha **GitHub Actions**.
3. A cada mudança na `main`, o workflow *Publicar site* atualiza o endereço acima.

### 3. Equipe

1. O responsável abre **Cadastros**, cria a conta e clica em **Criar fazenda**. Os dados que já estavam no aparelho vão para a fazenda.
2. Ele passa o **código da fazenda** (aparece em Cadastros) para a equipe.
3. Cada pessoa cria a própria conta e escolhe **Entrar com código**.

## Estrutura

- `app/src/main/java/.../MainActivity.kt` — abre a página local em um WebView e salva/abre arquivos para exportação e importação.
- `app/src/main/assets/www/` — o aplicativo em si (HTML, CSS e JavaScript, sem etapa de build).
  - `js/schemas.js` — campos de cada cadastro.
  - `js/logic.js` — regras (saldos, alertas, relatórios, validação, backup). Sem acesso à tela, coberto por testes.
  - `js/db.js` — gravação no IndexedDB (dados, fila de envio e estado da sincronização).
  - `js/sync.js` — login e sincronização com o Supabase (envio da fila e recebimento por número de alteração).
  - `js/config.js` — endereço e chave pública do Supabase.
  - `js/app.js` — telas e interações.
- `supabase/schema.sql` — tabelas, regras de acesso por fazenda e funções de criar/entrar em fazenda.
- `tests/` — testes da lógica e da sincronização (`npm test`, Node 20+).

## Como compilar

```
npm test                       # testes da parte web
./gradlew :app:assembleDebug   # APK de teste
```

O APK fica em `app/build/outputs/apk/debug/app-debug.apk`. O GitHub Actions roda os testes e gera o APK a cada push na `main`, em pull requests, e pode ser disparado manualmente. O workflow *Publicar site* publica a pasta `www` no GitHub Pages.

Para testar só a parte web no navegador: `python3 -m http.server` na pasta `app/src/main/assets/www` e abra `http://localhost:8000`.

## Versão de produção assinada

O APK `release` é assinado com uma chave sua. Gere uma vez (guarde o arquivo e as senhas em local seguro — sem ela não é possível atualizar o app instalado):

```
keytool -genkeypair -v -keystore agro-release.jks -alias agro -keyalg RSA -keysize 2048 -validity 10000
```

Compilar localmente:

```
AGRO_KEYSTORE_PATH=/caminho/agro-release.jks AGRO_KEYSTORE_PASSWORD=... AGRO_KEY_ALIAS=agro AGRO_KEY_PASSWORD=... ./gradlew :app:assembleRelease
```

No GitHub, cadastre em *Settings → Secrets and variables → Actions*: `AGRO_KEYSTORE_BASE64` (saída de `base64 -w0 agro-release.jks`), `AGRO_KEYSTORE_PASSWORD`, `AGRO_KEY_ALIAS` e `AGRO_KEY_PASSWORD`. Com eles, o workflow também gera o APK de produção.
