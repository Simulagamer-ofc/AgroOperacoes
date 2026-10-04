# Agro Operações

Aplicativo Android offline para operações agrícolas, máquinas, manutenção, talhões, produção de sementes, rastreabilidade e estoque.

## Versão atual

`0.2.0-beta1`

- **Visão geral** com indicadores e alertas calculados a partir dos dados reais.
- **Operações**: registro por data, situação (programada, em andamento, concluída, cancelada), edição e exclusão.
- **Máquinas e manutenção**: horímetro, próxima revisão com aviso, manutenções preventivas e corretivas com custo.
- **Talhões**, **produção de sementes** (campos de produção) e **lotes** com rastreabilidade do talhão até as movimentações.
- **Estoque e insumos**: saldos calculados pelas movimentações, alerta de estoque mínimo.
- **Relatórios** por período e exportação em CSV (abre no Excel).
- **Pesquisa** em todos os registros e **alertas** no sino.
- **Backup**: exportar e importar todos os dados em um arquivo JSON.

Os dados ficam só no aparelho (IndexedDB). Exporte backups com frequência.

## Estrutura

- `app/src/main/java/.../MainActivity.kt` — abre a página local em um WebView e salva/abre arquivos para exportação e importação.
- `app/src/main/assets/www/` — o aplicativo em si (HTML, CSS e JavaScript, sem etapa de build).
  - `js/schemas.js` — campos de cada cadastro.
  - `js/logic.js` — regras (saldos, alertas, relatórios, validação, backup). Sem acesso à tela, coberto por testes.
  - `js/db.js` — gravação no IndexedDB.
  - `js/app.js` — telas e interações.
- `tests/` — testes da lógica (`npm test`, Node 20+).

## Como compilar

```
npm test                       # testes da parte web
./gradlew :app:assembleDebug   # APK de teste
```

O APK fica em `app/build/outputs/apk/debug/app-debug.apk`. O GitHub Actions roda os testes e gera o APK a cada push na `main`, em pull requests, e pode ser disparado manualmente.

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
