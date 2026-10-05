"""Tatu Marchesan: catálogo público usado pelo site (api.marchesan.com.br). Especificações só existem como imagem/PDF:
o modelo entra com identificação, descrição e links verificados de manual, folheto e ficha técnica."""
import json
import re
import subprocess
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from comum import slug, salvar, DATA, UA

BASE = 'https://marchesan.com.br/uploads/produtos/'
PASTA = {'Manual': ('manual/', 'Manual de instruções'), 'Flyer': ('folheto/', 'Folheto'), 'Datasheet': ('fichatecnica/', 'Ficha técnica (imagem)')}
FAM = {'ARADOS': 'arado', 'COLHEITA': 'colheita', 'CULTIVADORES': 'cultivador', 'GRADES': 'grade', 'DISTRIBUIDORES': 'distribuidor',
       'PLAINAS': 'plaina', 'PLANTADEIRAS': 'semeadora', 'ROÇADEIRAS': 'rocadeira', 'SEMEADEIRAS': 'semeadora', 'UTILITÁRIOS': 'utilitario',
       'PULVERIZADORES': 'pulverizador'}


def existe(url):
    r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, '-o', '/dev/null', '-r', '0-0', '-w', '%{http_code}', url], capture_output=True)
    return r.stdout.decode().strip() in ('200', '206')


prods = json.load(open('tatu_produtos.json'))
cands = []
for p in prods:
    for f in p.get('files') or []:
        if f.get('type') in PASTA:
            pasta, titulo = PASTA[f['type']]
            cands.append((p['id'], titulo, BASE + pasta + urllib.parse.quote(f['path'])))
with ThreadPoolExecutor(8) as ex:
    ok = dict(zip(cands, ex.map(lambda c: existe(c[2]), cands)))

modelos, faltando = [], []
for p in prods:
    tipos = [t for t in p['_tipos'] if t not in ('LANÇAMENTOS', 'PEÇAS', 'PEÇAS GENUÍNAS')]
    if not tipos and set(p['_tipos']) & {'PEÇAS', 'PEÇAS GENUÍNAS'}:
        continue  # peças, não máquinas
    docs = [{'titulo': t, 'url': u} for (pid, t, u) in cands if pid == p['id'] and ok[(pid, t, u)]]
    faltando += [u for (pid, t, u) in cands if pid == p['id'] and not ok[(pid, t, u)]]
    titulo = re.sub(r'\s+', ' ', p['title']).strip()
    modelos.append({'id': 'tatu-' + slug(p.get('slug') or titulo), 'marca': 'Tatu Marchesan', 'modelo': titulo, 'linha': p.get('initials'),
                    'familia': FAM.get(tipos[0]) if tipos else None, 'categoriaFabricante': ' ; '.join(tipos or p['_tipos']),
                    'url': f"https://marchesan.com.br/produto/detalhe/{urllib.parse.quote(p['slug'])}/pt-BR",
                    'descricaoFabricante': re.sub(r'\s*\r?\n\s*', ' ', p.get('description') or '').strip(),
                    'especificacoes': [], 'origemEspecificacoes': None, 'documentos': docs,
                    'observacao': 'O fabricante publica as especificações como imagem e no folheto PDF; não foram transcritas automaticamente (risco de erro de leitura). Consultar os documentos.'})
salvar('tatu-marchesan.json', {'fabricanteId': 'tatu-marchesan', 'marca': 'Tatu Marchesan', 'fonte': 'https://api.marchesan.com.br/api/v1/tatu-site-api/products (catálogo usado pelo site)',
                               'dataConsulta': DATA, 'modelos': modelos, 'documentosNaoEncontrados': faltando})
print(len(modelos), 'modelos;', sum(len(m['documentos']) for m in modelos), 'documentos verificados;', len(faltando), 'não encontrados')
