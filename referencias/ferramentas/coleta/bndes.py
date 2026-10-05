"""Lista oficial de produtos credenciados no BNDES/FINAME (listasno.zip) -> catálogo de identificação agrícola.
Uso: python3 bndes.py <pasta_com_TXT> <saida.json>"""
import json
import re
import sys
import unicodedata
from collections import defaultdict

PASTA, SAIDA = sys.argv[1], sys.argv[2]
CLASSES = {'1': 'Máquinas/equipamentos/implementos agrícolas', '55': 'Plataforma de corte', '91': 'Moderinfra — armazenagem', '92': 'Moderinfra — irrigação'}


def ler(nome):
    L = open(f'{PASTA}/{nome}', encoding='latin-1').read().splitlines()
    return L[0], [l for l in L[1:] if l.strip()]


cab, FL = ler('FABRICAN.TXT')
fab = {l[0:14]: {'cnpj': l[0:14], 'razaoSocial': l[14:69].strip(), 'cidade': l[140:160].strip(), 'uf': l[160:162].strip(), 'situacaoBNDES': l[185:205].strip()} for l in FL}
_, CL = ler('CLASSIF.TXT')
cls = defaultdict(set)
for l in CL:
    cls[(l[0:14], l[14:21])].add(l[126:129].strip())
cabp, PL = ler('PRODUTOS.TXT')
datas = re.findall(r'\d{8}', cabp)
fech = datas[-2] if len(datas) >= 2 else ''
por_fab = defaultdict(list)
for l in PL:
    c = cls.get((l[0:14], l[14:21]), set()) & set(CLASSES)
    if c:
        por_fab[l[0:14]].append({'codigoFiname': l[14:21], 'nome': l[21:81].strip(), 'modelo': l[81:126].strip(), 'classificacoes': [CLASSES[x] for x in sorted(c, key=int)]})
fabricantes = []
for cnpj, prods in sorted(por_fab.items(), key=lambda kv: fab.get(kv[0], {}).get('razaoSocial', '')):
    fabricantes.append({**fab.get(cnpj, {'cnpj': cnpj}), 'produtos': sorted(prods, key=lambda p: (p['nome'], p['modelo']))})
doc = {'catalogo': 'Produtos agrícolas credenciados no BNDES (CFI/FINAME)',
       'fonte': {'organizacao': 'BNDES', 'arquivo': 'https://www.bndes.gov.br/arquivos/produtos-credenciados/listasno.zip',
                 'pagina': 'https://www.bndes.gov.br/wps/portal/site/home/financiamento/servicos-online/credenciamento-de-equipamentos',
                 'dataFechamentoLista': f'{fech[4:8]}-{fech[2:4]}-{fech[0:2]}' if fech else None, 'dataConsulta': '2026-10-04'},
       'classificacoesIncluidas': CLASSES,
       'observacoes': ['Camada de IDENTIFICAÇÃO: fabricante (CNPJ), nome do produto, modelo e código FINAME. Não contém especificações técnicas.',
                       'Campos copiados literalmente do arquivo oficial (largura fixa: nome com até 60 e modelo com até 45 caracteres; textos maiores aparecem truncados na origem).',
                       'Produtos importados não credenciados no FINAME (ex.: Kubota) não aparecem nesta lista.'],
       'totalFabricantes': len(fabricantes), 'totalProdutos': sum(len(f['produtos']) for f in fabricantes), 'fabricantes': fabricantes}
json.dump(doc, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(doc['totalFabricantes'], 'fabricantes;', doc['totalProdutos'], 'produtos; fechamento', doc['fonte']['dataFechamentoLista'])
