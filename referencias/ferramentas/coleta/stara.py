import re
from comum import baixar, linhas_texto, titulo, slug, salvar, DATA

BASE = 'https://www.stara.com.br/produtos-servicos/'
FAMILIA = {
    'pulverizadores-maquinas-agricolas': 'pulverizador', 'plantadeiras-e-semeadoras': 'semeadora',
    'distribuidores': 'distribuidor', 'carretas-agricolas': 'carreta_graneleira', 'escarificadores': 'escarificador',
    'niveladores-de-solo-agricolas': 'plaina_niveladora', 'plainas-agricolas': 'plaina', 'plataformas-de-milho': 'plataforma_milho',
    'subsoladores-implementos-agricolas': 'subsolador', 'agricultura-de-precisao': 'agricultura_precisao',
}

urls = [u.strip() for u in open('stara_urls.txt') if u.strip()]
produtos = []
for u in urls:
    rel = u.replace(BASE, '').split('/')
    if rel[0] in ('servicos', 'outros-produtos') or len(rel) < 3:
        continue
    cat = rel[1] if rel[1] != 'produto' else rel[0]
    s = baixar(u)
    if not s:
        produtos.append({'url': u, 'erro': 'download'}); continue
    L = linhas_texto(s)
    pdfs = sorted(set(re.findall(r'https://cdn\.stara\.com\.br/[^"\']+\.pdf', s)))
    # nomes dos modelos do comparador
    modelos = {}
    try:
        ini = L.index('MODELO')
    except ValueError:
        ini = None
    if ini is not None:
        nomes = []
        for x in L[ini:ini + 60]:
            if x not in ('+', 'Selecione um modelo', 'MODELO') and not x.endswith(':') and len(x) < 60:
                if x in nomes:
                    break
                nomes.append(x)
        # depois da lista de seleção, cada modelo aparece seguido de pares "Campo:" / valor
        k = ini
        atual = None
        while k < len(L):
            x = L[k]
            if x.startswith('CONFIRA'):
                break
            if x in nomes and k + 1 < len(L) and L[k + 1].endswith(':'):
                atual = x; modelos.setdefault(atual, []); k += 1; continue
            if atual and x.endswith(':') and k + 1 < len(L):
                modelos[atual].append({'campo': x[:-1], 'valor': L[k + 1]}); k += 2; continue
            k += 1
    nome_pagina = re.sub(r'\s*[|\-–]\s*Stara.*$', '', titulo(s)).strip()
    produtos.append({'url': u, 'categoriaFabricante': cat, 'familia': FAMILIA.get(cat), 'nomePagina': nome_pagina,
                     'prospectos': pdfs, 'modelos': modelos})
    print(cat, '|', nome_pagina, '|', list(modelos), '|', len(pdfs))

itens = []
for p in produtos:
    if 'erro' in p:
        continue
    if p['modelos']:
        for nome, specs in p['modelos'].items():
            itens.append({'id': 'stara-' + slug(nome), 'marca': 'Stara', 'modelo': nome, 'linha': p['nomePagina'],
                          'familia': p['familia'], 'categoriaFabricante': p['categoriaFabricante'], 'url': p['url'],
                          'prospectos': p['prospectos'], 'especificacoes': specs,
                          'origemEspecificacoes': 'comparador de modelos da página do produto (texto literal)'})
    else:
        itens.append({'id': 'stara-' + slug(p['nomePagina'] or p['url'].split('/')[-1]), 'marca': 'Stara', 'modelo': p['nomePagina'],
                      'linha': p['nomePagina'], 'familia': p['familia'], 'categoriaFabricante': p['categoriaFabricante'], 'url': p['url'],
                      'prospectos': p['prospectos'], 'especificacoes': [], 'origemEspecificacoes': None})
salvar('stara.json', {'fabricanteId': 'stara', 'marca': 'Stara', 'fonte': 'https://www.stara.com.br/sitemap', 'dataConsulta': DATA, 'modelos': itens,
                      'erros': [p for p in produtos if 'erro' in p]})
print(len(itens), 'modelos')
