"""Gera os dados offline usados pelo aplicativo (app/src/main/assets/www/dados) a partir de referencias/.

Uso (na raiz do repositório): python3 referencias/ferramentas/gerar_dados_app.py
"""
import json
import os
import shutil

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
        if x.get('documentos'):
            item['d'] = [[doc.get('titulo') or 'Documento', doc['url']] for doc in x['documentos']]
        modelos.append(item)
t1 = gravar('catalogo-modelos.json', {'dataConsulta': indice.get('dataConsulta'), 'marcas': marcas, 'modelos': modelos})

# 3) Lista oficial BNDES/FINAME (compacta)
bn = json.load(open(os.path.join(REF, 'bndes', 'produtos-agricolas-finame.json'), encoding='utf-8'))
fabs, prods = [], []
for f in bn['fabricantes']:
    fabs.append([f['cnpj'], f['razaoSocial'], f.get('uf') or ''])
    for p in f['produtos']:
        prods.append([len(fabs) - 1, p['codigoFiname'], p['nome'], p['modelo']])
t2 = gravar('finame.json', {'fonte': bn['fonte'], 'fabricantes': fabs, 'produtos': prods})

print(f'catalogo-modelos.json: {len(modelos)} modelos ({t1 // 1024} KB)')
print(f'finame.json: {len(prods)} produtos ({t2 // 1024} KB)')
