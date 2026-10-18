# Qualidade e publicação — Nexus Agro

Este documento descreve o processo de alterações sem mudar o funcionamento do sistema.

## Fluxo recomendado

1. Criar uma branch a partir da versão mais recente da `main`.
2. Alterar somente os arquivos necessários; registrar impactos em módulos relacionados.
3. Abrir Pull Request, verificar os logs e corrigir eventuais falhas.
4. Conferir manualmente o recurso em dispositivos e navegadores pertinentes.
5. Incorporar à `main` somente após aprovação e verificações verdes.

## Testes automáticos

O workflow reutilizável `.github/workflows/quality.yml` executa:

- testes Node existentes: `node --test referencias/tests/*.test.js` (incluem localização/GPS, relatórios, painel e referências);
- verificação de sintaxe dos arquivos JavaScript próprios;
- leitura e validação sintática dos catálogos e regras JSON;
- comparação entre o avaliador e as regras de origem e as cópias enviadas ao aplicativo.

O workflow do Android executa essa validação **antes** de compilar e publicar o APK.
O workflow do Pages executa a mesma validação **antes** de publicar o site.

Para repetir localmente em ambiente com Node 22, Linux e GNU find/xargs:

```bash
node --test referencias/tests/*.test.js
find app/src/main/assets/www referencias -type f -name '*.js' -not -path '*/lib/*' -print0 | xargs -0 -r -n1 node --check
find referencias app/src/main/assets/www/dados -type f -name '*.json' -print0 | xargs -0 -r -n1 node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))"
cmp referencias/avaliador.js app/src/main/assets/www/avaliador.js
cmp referencias/regras-afericao.json app/src/main/assets/www/dados/regras-afericao.json
```

## Limites dessa verificação

O CI verifica a sintaxe, regras cobertas pelos testes e se o projeto compila. **Não comprova ausência de bugs**.
Não substitui testes manuais de GPS/permissões no Safari do iPhone, download e visualização real de PDF,
login e perfis no Supabase, sincronização em mais de um aparelho, nem validação técnica das normas agrícolas.
Os testes de localização e PDF presentes no repositório exercitam a lógica, não os aparelhos físicos.

## Proteger a versão principal

A `main` ainda aceita alterações diretas. Em **GitHub → Settings → Rules → Rulesets**,
crie uma regra para `main` exigindo Pull Request e os checks de qualidade e compilação,
**depois que esses checks aparecerem e estiverem verdes**. Use o nome do check exatamente
como o GitHub mostrar. Ative a regra apenas após conferir que ela não impedirá a manutenção
do repositório. Não dê bypass irrestrito aos colaboradores.

Nunca colocar senhas, chaves privadas ou tokens no repositório.
