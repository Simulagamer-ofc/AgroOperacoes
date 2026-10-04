import re
import sys
from comum import baixar, titulo, slug, salvar, DATA
from tabelas import tabelas, tabela_modelos

FAM = {
    'tractors': 'trator', 'tratores': 'trator', 'combine-harvesters': 'colhedora_graos', 'colheitadeiras-axiais': 'colhedora_graos',
    'balers': 'enfardadora', 'hay-and-forage': 'forragem', 'materials-handling': 'carregadora_frontal',
    'seeders-planters': 'semeadora', 'plantadeiras': 'semeadora', 'sprayers': 'pulverizador', 'pulverizadores': 'pulverizador',
    'platforms': 'plataforma_colheita', 'plataformas': 'plataforma_colheita', 'distribuidor': 'distribuidor', 'implementos': None,
}

CONF = {
    'massey-ferguson': dict(marca='Massey Ferguson', sitemap='mf_sm.xml', padrao=r'https://www\.masseyferguson\.com/pt_br/product/([^/]+)/([^/]+)\.html'),
    'valtra': dict(marca='Valtra', sitemap='valtra_sm.xml', padrao=r'https://www\.valtra\.com\.br/produtos/([^/]+)/([^/]+)\.html'),
}

fid = sys.argv[1]
c = CONF[fid]
sm = open(c['sitemap'], encoding='utf-8').read()
urls = sorted(set(u for u in re.findall(r'<url><loc>(.*?)</loc>', sm) if re.fullmatch(c['padrao'], u)))
modelos, erros, rejeitadas = [], [], []
for u in urls:
    cat, prod = re.fullmatch(c['padrao'], u).groups()
    if cat == 'produtos':
        continue
    s = baixar(u)
    if not s:
        erros.append({'url': u, 'motivo': 'download'}); continue
    t = titulo(s)
    linha = re.split(r'\s+[|–-]\s+', t)[0].strip() or prod
    achou = False
    for g in tabelas(s, com_th=True):
        cols, dados, probs = tabela_modelos(g)
        if not cols or not re.match(r'(?i)\s*(modelos?|models?)\b', cols[0] or ''):
            if cols:
                rejeitadas.append({'url': u, 'cabecalho': cols[:4]})
            continue
        if probs:
            erros.append({'url': u, 'problemas': probs})
        for r in dados:
            nome = r[0].strip()
            esp = [{'campo': cols[i], 'valor': r[i]} for i in range(1, len(cols)) if r[i]]
            modelos.append({'id': f'{fid}-' + slug(nome), 'marca': c['marca'], 'modelo': nome, 'linha': linha,
                            'familia': FAM.get(cat), 'categoriaFabricante': cat, 'url': u, 'especificacoes': esp,
                            'origemEspecificacoes': 'tabela de modelos da página do produto (texto literal; células mescladas expandidas)'})
            achou = True
    if not achou:
        modelos.append({'id': f'{fid}-' + slug(linha), 'marca': c['marca'], 'modelo': linha, 'linha': linha, 'familia': FAM.get(cat),
                        'categoriaFabricante': cat, 'url': u, 'especificacoes': [], 'origemEspecificacoes': None,
                        'observacao': 'Página do produto sem tabela de modelos; incluído apenas para identificação.'})
    print(cat, '|', linha, '|', achou)

vistos = {}
for m in modelos:
    vistos[m['id']] = vistos.get(m['id'], 0) + 1
    if vistos[m['id']] > 1:
        m['id'] += f"-{vistos[m['id']]}"
salvar(f'{fid}.json', {'fabricanteId': fid, 'marca': c['marca'], 'fonte': 'sitemap do site oficial', 'dataConsulta': DATA, 'modelos': modelos, 'erros': erros, 'tabelasRejeitadas': rejeitadas})
print(len(modelos), 'modelos;', sum(1 for m in modelos if m['especificacoes']), 'com especificações')
