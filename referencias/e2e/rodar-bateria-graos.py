# Bateria de testes de moega, secador e silos (MercaPlant).
# Uso: na pasta app/src/main/assets/www rode `python3 -m http.server 8772` e depois
#      python3 referencias/e2e/rodar-bateria-graos.py   (requer: pip install playwright)
# Gera bateria-graos.json com cada caso (esperado × obtido) e o resumo da safra simulada.
import json, pathlib, sys
from playwright.sync_api import sync_playwright
AQUI = pathlib.Path(__file__).parent
JS = (AQUI / 'bateria-graos.js').read_text()
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8772/index.html'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1200, 'height': 900})
    erros = []; pg.on('pageerror', lambda e: erros.append(str(e)[:300]))
    pg.goto(URL); pg.wait_for_timeout(6000)
    r = pg.evaluate(JS); r['errosJs'] = erros
    (pathlib.Path.cwd() / 'bateria-graos.json').write_text(json.dumps(r, ensure_ascii=False, indent=1))
    ok = sum(c['ok'] for c in r['casos'])
    for c in r['casos']:
        if not c['ok']: print('FALHOU', c['id'], c['desc'], '\n  esperado:', c['esperado'], '\n  obtido:  ', c['obtido'])
    print(f"{ok}/{len(r['casos'])} casos aprovados • erros de JavaScript: {len(erros)}")
    b.close(); sys.exit(0 if ok == len(r['casos']) and not erros else 1)
