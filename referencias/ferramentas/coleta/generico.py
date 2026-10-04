"""Coletor genérico: sitemap -> páginas de produto -> tabelas. Uso: python3 generico.py <id> <marca> <dominio> [regex_produto]"""
import re
import sys
import urllib.parse
import urllib.robotparser
from comum import baixar, titulo, slug, salvar, DATA, linhas_texto
from tabelas import tabelas, tabela_modelos

fid, marca, dom = sys.argv[1:4]
padrao = re.compile(sys.argv[4] if len(sys.argv) > 4 else r'/(produtos?|products?|maquinas|implementos|tratores|linha|equipamentos)/[^/]+', re.I)
EXCL = re.compile(r'/(category|categoria|tag|page|blog|noticias?|news|wp-content|autor|author|feed|eventos?|imprensa)/|\.(jpg|png|pdf|webp)$', re.I)
base = f'https://{dom}'

rp = urllib.robotparser.RobotFileParser()
rob = baixar(base + '/robots.txt') or ''
rp.parse(rob.splitlines())

urls, vistos, fila = set(), set(), [base + '/sitemap.xml', base + '/sitemap_index.xml', base + '/wp-sitemap.xml']
for m in re.finditer(r'(?im)^sitemap:\s*(\S+)', rob):
    fila.append(m.group(1))
while fila and len(vistos) < 60:
    sm = fila.pop(0)
    if sm in vistos:
        continue
    vistos.add(sm)
    s = baixar(sm)
    if not s or '<loc>' not in s:
        continue
    for loc in re.findall(r'<loc>\s*(.*?)\s*</loc>', s):
        loc = loc.replace('&amp;', '&').replace('http://', 'https://')
        if urllib.parse.urlparse(loc).netloc.replace('www.', '') != dom.replace('www.', ''):
            continue
        if loc.endswith('.xml'):
            fila.append(loc)
        elif padrao.search(loc) and not EXCL.search(loc):
            urls.add(loc.rstrip('/'))

bloqueadas = sorted(u for u in urls if not rp.can_fetch('*', u))
urls = sorted(u for u in urls if rp.can_fetch('*', u))
print(len(urls), 'URLs de produto;', len(bloqueadas), 'bloqueadas pelo robots.txt')
modelos, rejeitadas = [], []
for u in urls:
    s = baixar(u)
    if not s:
        continue
    t = titulo(s)
    nome = re.split(r'\s+[|–—-]\s+', t)[0].strip().strip('|').strip()
    if not nome:
        h = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S) or re.search(r'<h2[^>]*>(.*?)</h2>', s, re.S)
        nome = re.sub(r'<[^>]+>|\s+', ' ', h.group(1)).strip() if h else ''
    nome = nome or u.split('/')[-1]
    itens, especs = [], []
    for g in tabelas(s, com_th=True):
        cols, dados, probs = tabela_modelos(g)
        if cols and re.match(r'(?i)\s*(modelos?|models?)\b', cols[0] or '') and dados and not probs:
            for r in dados:
                itens.append((r[0], [{'campo': cols[i], 'valor': r[i]} for i in range(1, len(cols)) if r[i]]))
        else:
            for row in g:
                vals = [x['txt'] for x in row]
                if len(vals) == 2 and vals[0] and vals[1] and vals[0] != vals[1]:
                    especs.append({'campo': vals[0], 'valor': vals[1]})
                elif len(vals) > 2 and len(set(vals)) > 1:
                    rejeitadas.append({'url': u, 'linha': vals[:5]})
    if not itens and not especs:
        L = linhas_texto(s)
        for i in range(len(L) - 1):
            a, b = L[i], L[i + 1]
            if a.endswith(':') and 2 < len(a) < 50 and b and not b.endswith(':') and len(b) < 60 and a.lower() not in ('características:', 'caracteristicas:'):
                especs.append({'campo': a[:-1], 'valor': b})
    docs = []
    for href, txt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', s, re.S):
        t2 = re.sub(r'<[^>]+>|\s+', ' ', txt).strip()
        if re.search(r'(?i)manual|cat[aá]logo|folheto|prospecto', t2 + ' ' + href) and not href.startswith(('#', 'javascript')):
            docs.append({'titulo': t2[:80], 'url': urllib.parse.urljoin(u, href)})
    if itens:
        for n, e in itens:
            modelos.append({'id': f'{fid}-' + slug(n), 'modelo': n, 'linha': nome, 'url': u, 'especificacoes': e,
                            'origemEspecificacoes': 'tabela de modelos da página do produto (texto literal)', 'documentos': docs})
    else:
        modelos.append({'id': f'{fid}-' + slug(nome), 'modelo': nome, 'linha': None, 'url': u, 'especificacoes': especs,
                        'origemEspecificacoes': 'pares campo/valor da página do produto (texto literal)' if especs else None, 'documentos': docs})
    print(nome[:60], '|', len(itens) or len(especs))
for m in modelos:
    m.update({'marca': marca, 'familia': None, 'categoriaFabricante': None})
salvar(f'{fid}.json', {'fabricanteId': fid, 'marca': marca, 'fonte': f'sitemap de {dom}', 'dataConsulta': DATA, 'modelos': modelos,
                       'bloqueadasRobots': bloqueadas, 'linhasRejeitadas': rejeitadas[:200]})
print(len(modelos), 'itens;', sum(1 for m in modelos if m['especificacoes']), 'com especificações')
