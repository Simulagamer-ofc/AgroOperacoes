# Coleta de modelos nos sites dos fabricantes

Scripts usados para gerar `referencias/modelos/*.json`. Rodam com Python 3 e `curl`, a partir de uma pasta de trabalho que contenha os sitemaps baixados.

| Script | Fonte |
|---|---|
| `stara.py` | Sitemap e comparador de modelos de stara.com.br |
| `deere.py` | Sitemap `deere.com.br/pt/sitemap.xml` e tabelas de especificação. Páginas que redirecionam (modelos fora de linha) são descartadas |
| `agco.py massey-ferguson` / `agco.py valtra` | Sitemaps e tabelas de modelos (células mescladas expandidas por `tabelas.py`) |
| `caseih.py` | Sitemap `caseih.com/pt-br/brasil` e dados estruturados `ProductModelSpecifications` da página |
| `jacto.py` | Catálogo público usado pelo próprio site (`jacto.com/api/v1/products`), filtrado para mercado Brasil e produtos ativos |
| `consolidar.py` | Padroniza, junta duplicatas e grava `referencias/modelos/` |

Regras seguidas:
- **Robots.txt:** respeitado. A New Holland proíbe a coleta de `/pt-br/southamerica` e por isso não foi coletada.
- **Valores:** copiados como texto literal, sem conversão.
- **Verificação em 04/10/2026:** amostra de 60 modelos (5 marcas, 1364 valores) baixada de novo. 99,4% dos valores aparecem literalmente na página. As diferenças restantes são de formatação (m³ em sobrescrito, aspas escapadas).
