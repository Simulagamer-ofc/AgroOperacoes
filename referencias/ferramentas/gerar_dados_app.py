"""Gera os dados offline usados pelo aplicativo (app/src/main/assets/www/dados) a partir de referencias/.

Uso (na raiz do repositório): python3 referencias/ferramentas/gerar_dados_app.py
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from marcas_tipos import TIPOS, marca_finame, slug, tipo_de  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(RAIZ, 'referencias')
WWW = os.path.join(RAIZ, 'app', 'src', 'main', 'assets', 'www')
DEST = os.path.join(WWW, 'dados')
os.makedirs(DEST, exist_ok=True)


def gravar(nome, obj):
    with open(os.path.join(DEST, nome), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(os.path.join(DEST, nome))


# 1) Regras de aferição e avaliador (cópias exatas)
shutil.copyfile(os.path.join(REF, 'regras-afericao.json'), os.path.join(DEST, 'regras-afericao.json'))
shutil.copyfile(os.path.join(REF, 'avaliador.js'), os.path.join(WWW, 'avaliador.js'))

# 2) Catálogo de modelos (sites dos fabricantes)
indice = json.load(open(os.path.join(REF, 'modelos', 'indice.json'), encoding='utf-8'))
marcas, modelos = [], []
for m in indice['marcas']:
    d = json.load(open(os.path.join(REF, m['arquivo']), encoding='utf-8'))
    marcas.append({'marca': d['marca'], 'fonte': d.get('fonte'), 'dataConsulta': d.get('dataConsulta')})
    mi = len(marcas) - 1
    for x in d['modelos']:
        item = {'i': x['id'], 'm': mi, 'n': x['modelo'], 'f': x.get('familia'), 'u': x.get('url')}
        if x.get('linha'):
            item['l'] = x['linha']
        if x.get('categoriaFabricante'):
            item['c'] = x['categoriaFabricante']
        if x.get('especificacoes'):
            item['e'] = [[e.get('secao') or '', e['campo'], e['valor']] for e in x['especificacoes']]
            item['o'] = x.get('origemEspecificacoes')
        if x.get('familiaIdentificacao'):
            item['fi'] = x['familiaIdentificacao']
        if x.get('documentos'):
            item['d'] = [[doc.get('titulo') or 'Documento', doc['url']] for doc in x['documentos']]
        modelos.append(item)

# 2b) Identificação de famílias/modelos (sem ficha técnica), já sem os itens que as fichas acima cobrem.
#     Família só para agrupar e sugerir o tipo de máquina; nunca as famílias que disparam sugestão na aferição.
FAMILIA_IDENT = {
    'semeadora': 'semeadora', 'plantadeira': 'semeadora', 'distribuidor_fertilizante': 'distribuidor', 'pulverizador': 'pulverizador',
    'carreta_graneleira': 'carreta_graneleira', 'plaina': 'plaina', 'cultivador': 'cultivador', 'escarificador': 'escarificador',
    'descompactador': 'preparo_solo', 'segadora': 'forragem', 'espalhador_feno': 'forragem', 'enleirador': 'forragem',
    'misturador_racao': 'forragem', 'distribuidor_esterco': 'forragem', 'enfardadora': 'enfardadora', 'trator': 'trator',
    'colhedora_forragem': 'colhedora_forragem', 'colheitadeira_graos': 'colhedora', 'plataforma_milho': 'plataforma_milho',
}
ident = json.load(open(os.path.join(REF, 'modelos', 'identificacao.json'), encoding='utf-8'))
# Uma família que ganhou ficha técnica não aparece de novo como “identificação” (mesma marca e mesmo nome, ou ficha que aponta a família)
def _norm(t):
    import unicodedata, re as _re
    return _re.sub(r'[^a-z0-9+]+', ' ', unicodedata.normalize('NFD', str(t or '')).encode('ascii', 'ignore').decode().lower()).strip()
_com_ficha = set()
for x in modelos:
    mk = slug(marcas[x['m']]['marca'])
    for nome in (x['n'], x.get('l'), x.get('fi')):
        if nome:
            _com_ficha.add((mk, _norm(nome)))
for r in ident['equipamentos']:
    if (slug(r['marca']), _norm(r['nome'])) in _com_ficha:
        continue
    mi = next((i for i, m in enumerate(marcas) if slug(m['marca']) == slug(r['marca'])), None)
    if mi is None:
        marcas.append({'marca': r['marca'], 'fonte': None, 'dataConsulta': None})
        mi = len(marcas) - 1
    item = {'i': r['id'], 'm': mi, 'n': r['nome'], 'f': FAMILIA_IDENT.get(r['categoriaId']), 'u': r['fontes'][0]['url'], 'c': r['categoria'],
            'k': 'id', 'v': r['nivel'], 'dc': r['fontes'][0]['consultadoEm']}
    if r.get('observacao'):
        item['ob'] = r['observacao']
    if r['status'] != 'confirmado_em_fonte_oficial':
        item['st'] = r.get('motivoConfirmar') or r['status']
    modelos.append(item)
assert len({x['i'] for x in modelos}) == len(modelos), 'ID repetido no catálogo'
t1 = gravar('catalogo-modelos.json', {'dataConsulta': indice.get('dataConsulta'), 'marcas': marcas, 'modelos': modelos})

# 3) Lista oficial BNDES/FINAME (compacta)
bn = json.load(open(os.path.join(REF, 'bndes', 'produtos-agricolas-finame.json'), encoding='utf-8'))
fabs, prods = [], []
for f in bn['fabricantes']:
    fabs.append([f['cnpj'], f['razaoSocial'], f.get('uf') or ''])
    for p in f['produtos']:
        prods.append([len(fabs) - 1, p['codigoFiname'], p['nome'], p['modelo']])
t2 = gravar('finame.json', {'fonte': bn['fonte'], 'fabricantes': fabs, 'produtos': prods})

# 4) Marcas comerciais e tipos (navegação do catálogo): fichas e BNDES unidos pela marca
marcas_idx, lista_marcas = {}, []


def marca_id(nome):
    k = slug(nome)
    if k not in marcas_idx:
        marcas_idx[k] = len(lista_marcas)
        lista_marcas.append({'id': k, 'nome': nome, 'f': 0, 'b': 0, 't': {}, 'razoes': set()})
    return marcas_idx[k]


for x in modelos:
    t = tipo_de(' '.join(filter(None, [x['n'], x.get('c'), x.get('l')])), x.get('f'))
    b = marca_id(marcas[x['m']]['marca'])
    x['b'], x['t'] = b, t
    if x.get('k') == 'id':
        lista_marcas[b]['i'] = lista_marcas[b].get('i', 0) + 1
    else:
        lista_marcas[b]['f'] += 1
    lista_marcas[b]['t'][t] = lista_marcas[b]['t'].get(t, 0) + 1
for p in prods:
    razao = fabs[p[0]][1]
    t = tipo_de(f'{p[2]} {p[3]}')
    b = marca_id(marca_finame(razao, f'{p[2]} {p[3]}'))
    p += [b, t]
    lista_marcas[b]['b'] += 1
    lista_marcas[b]['t'][t] = lista_marcas[b]['t'].get(t, 0) + 1
    lista_marcas[b]['razoes'].add(razao)
for m in lista_marcas:
    m['razoes'] = sorted(m['razoes'])
t1 = gravar('catalogo-modelos.json', {'dataConsulta': indice.get('dataConsulta'), 'marcas': marcas, 'modelos': modelos})
t2 = gravar('finame.json', {'fonte': bn['fonte'], 'fabricantes': fabs, 'produtos': prods})
t3 = gravar('marcas.json', {'tipos': TIPOS, 'marcas': lista_marcas})

print(f'catalogo-modelos.json: {len(modelos)} modelos ({t1 // 1024} KB)')
print(f'finame.json: {len(prods)} produtos ({t2 // 1024} KB)')
print(f'marcas.json: {len(lista_marcas)} marcas ({t3 // 1024} KB)')
