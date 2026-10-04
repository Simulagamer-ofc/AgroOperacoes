"""Cruza catalogo-fabricantes.json com a lista do BNDES pelo nome da empresa (razão social normalizada)."""
import json
import re
import unicodedata

SUF = r'\b(LTDA|LIMITADA|S\s*/?\s*A|SA|ME|EPP|EIRELI|IND|INDUSTRIA|COM|COMERCIO|E|DE|DO|DA|DOS|DAS|EM RECUPERACAO JUDICIAL|IMPORTACAO|EXPORTACAO|IMP|EXP)\b'


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().upper()
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    s = re.sub(SUF, ' ', s)
    return ' '.join(s.split())


cat = json.load(open('catalogo-fabricantes.json'))
bn = json.load(open('bndes/produtos-agricolas-finame.json'))
idx = {}
for f in bn['fabricantes']:
    idx.setdefault(norm(f['razaoSocial']), []).append(f)
usados, casados = set(), 0
for f in cat['fabricantes']:
    if not f.get('razaoSocial'):
        if not f.get('nome'):
            continue
        alvo = norm(f['nome'])
        m = [b for k, bs in idx.items() if re.search(rf'\b{re.escape(alvo)}\b', k) for b in bs] if len(alvo) >= 4 else []
        if len(m) == 1:  # só vincula quando a marca identifica uma única empresa
            f['razaoSocial'] = m[0]['razaoSocial']; f['cnpj'] = m[0]['cnpj']; f['produtosCredenciadosBNDES'] = len(m[0]['produtos'])
            usados.add(m[0]['cnpj']); casados += 1
        elif m:
            f['observacao'] = ((f.get('observacao') or '') + f" Possíveis correspondências no BNDES (não vinculadas automaticamente): {', '.join(b['razaoSocial'] for b in m[:5])}.").strip()
        continue
    n = norm(f['razaoSocial'])
    m = idx.get(n)
    if not m:  # nome da BNDES truncado em 55 caracteres
        m = [b for k, bs in idx.items() if len(k) >= 12 and (n.startswith(k) or k.startswith(n)) for b in bs]
    if len(m) >= 1:
        f['cnpj'] = [b['cnpj'] for b in m] if len(m) > 1 else m[0]['cnpj']
        f['produtosCredenciadosBNDES'] = sum(len(b['produtos']) for b in m)
        usados.update(b['cnpj'] for b in m)
        casados += 1
novos = 0
for b in bn['fabricantes']:
    if b['cnpj'] in usados:
        continue
    cat['fabricantes'].append({'id': 'bndes-' + b['cnpj'], 'nome': None, 'razaoSocial': b['razaoSocial'], 'cnpj': b['cnpj'], 'marcas': [],
                               'associadaCSMIA': False, 'site': {'url': None, 'status': 'nao_verificado', 'dataVerificacao': None},
                               'segmentos': [], 'cidade': b['cidade'], 'uf': b['uf'], 'produtosCredenciadosBNDES': len(b['produtos']),
                               'observacao': 'Incluído a partir da lista de produtos agrícolas credenciados no BNDES/FINAME.'})
    novos += 1
cat['versao'] = '0.2.0'
cat['fontes'].append({'id': 'BNDES-FINAME', 'organizacao': 'BNDES', 'url': bn['fonte']['arquivo'], 'dataConsulta': bn['fonte']['dataConsulta'],
                      'observacao': f"Produtos agrícolas credenciados (fechamento {bn['fonte']['dataFechamentoLista']}); cruzamento por razão social normalizada."})
json.dump(cat, open('catalogo-fabricantes.json', 'w'), ensure_ascii=False, indent=1)
print('casados', casados, '| novos fabricantes', novos, '| total', len(cat['fabricantes']))
