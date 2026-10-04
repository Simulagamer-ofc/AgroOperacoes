"""Consolida os arquivos por marca no formato do catálogo do Nexus Agro."""
import json
import os
import re
from comum import slug, salvar, DATA

DEST = '/home/user/AgroOperacoes/referencias/modelos'
os.makedirs(DEST, exist_ok=True)
MARCAS = [('stara.json', 'stara'), ('john-deere.json', 'john-deere'), ('massey-ferguson.json', 'agco'), ('valtra.json', 'agco'),
          ('case-ih.json', 'cnh'), ('jacto.json', 'jacto'),
          ('lavrale.json', 'lavrale'), ('dmb.json', 'dmb'), ('imasa.json', 'imasa')]


def familia_pulv(m):
    texto = ' '.join([m.get('modelo') or '', m.get('linha') or '', m.get('tituloPagina') or '', m.get('categoriaFabricante') or '']).lower()
    if re.search(r'autopropel|automotri', texto):
        return 'pulverizador_autopropelido'
    if 'drone' in texto:
        return 'pulverizador_drone'
    if 'arrasto' in texto:
        return 'pulverizador_arrasto'
    if 'montado' in texto:
        return 'pulverizador_montado'
    return 'pulverizador'


indice = []
for arq, fab in MARCAS:
    d = json.load(open(arq))
    marca = d['marca']
    saida, por_nome = [], {}
    descartados = []
    for m in d['modelos']:
        nome = (m.get('modelo') or '').strip()
        if not nome or nome.startswith('|'):
            descartados.append({'nome': nome[:120], 'url': m.get('url'), 'motivo': 'página sem conteúdo (produto retirado do site, URL ainda no sitemap)'}); continue
        if nome.startswith('*') or len(nome) > 90:
            descartados.append({'nome': nome[:120], 'url': m.get('url'), 'motivo': 'nota de rodapé ou nome inválido'}); continue
        if fab == 'dmb' and nome.lower().startswith('linha '):
            descartados.append({'nome': nome, 'url': m.get('url'), 'motivo': 'página de categoria'}); continue
        fam = m.get('familia')
        if fam == 'pulverizador':
            fam = familia_pulv(m)
        item = {
            'id': m['id'], 'marca': marca, 'fabricanteId': fab, 'modelo': nome, 'linha': m.get('linha'), 'familia': fam,
            'categoriaFabricante': m.get('categoriaFabricante'), 'url': m.get('url'),
            'especificacoes': [{k: (re.sub(r'\s*\n+\s*', ' / ', v).strip() if isinstance(v, str) else v) for k, v in e.items() if v not in (None, '')} for e in m.get('especificacoes') or []],
            'origemEspecificacoes': m.get('origemEspecificacoes'), 'dataConsulta': DATA,
        }
        for e in item['especificacoes']:
            if not e.get('campo') and e.get('secao'):
                e['campo'] = e.pop('secao')
        if not item['categoriaFabricante'] and fab in ('lavrale', 'dmb', 'imasa'):
            partes = [p for p in (item['url'] or '').split('/')[3:] if p]
            item['categoriaFabricante'] = partes[-2] if len(partes) >= 2 else None
        docs = [x for x in m.get('documentos') or [] if x.get('titulo') or x['url'].lower().endswith('.pdf')]
        if docs:
            item['documentos'] = docs
        for k in ('lastmodSitemap', 'atualizadoNoFabricante', 'prospectos', 'observacao'):
            if m.get(k):
                item[k] = m[k]
        chave = nome.lower()
        if chave in por_nome:
            ant = por_nome[chave]
            if ant['especificacoes'] == item['especificacoes'] or not item['especificacoes']:
                ant.setdefault('urlsAdicionais', []).append(item['url']); continue
            if not ant['especificacoes']:
                item.setdefault('urlsAdicionais', []).append(ant['url']); saida[saida.index(ant)] = item; por_nome[chave] = item; continue
            # mesmo nome, especificações diferentes: diferencia pela linha (ou pela 1ª especificação)
            dif = item['linha'] if item['linha'] and item['linha'] != ant['linha'] else (item['especificacoes'][0]['valor'] if item['especificacoes'] else str(len(saida)))
            item['modelo'] = f"{nome} ({dif})"
            item['observacao'] = 'Nome repetido no site do fabricante com especificações diferentes; diferenciado entre parênteses.'
        por_nome[item['modelo'].lower()] = item
        saida.append(item)
    ids = {}
    for it in saida:
        ids[it['id']] = ids.get(it['id'], 0) + 1
        if ids[it['id']] > 1:
            it['id'] = f"{it['id']}-{ids[it['id']]}"
    nome_arq = slug(marca) + '.json'
    doc = {'catalogo': 'Nexus Agro — modelos de máquinas e implementos', 'marca': marca, 'fabricanteId': fab, 'fonte': d.get('fonte'),
           'dataConsulta': DATA, 'regras': [
               'Especificações copiadas como texto literal do site oficial do fabricante, sem conversão nem interpretação.',
               'Valores servem para identificação e consulta. Para preencher automaticamente um parâmetro de regulagem, o valor precisa ser confirmado no manual/folheto do modelo e ano.',
               'O site pode não refletir variações por ano-modelo, mercado ou opcionais.'],
           'totalModelos': len(saida), 'comEspecificacoes': sum(1 for x in saida if x['especificacoes']),
           'modelos': saida, 'descartados': descartados}
    for k in ('redirecionadas', 'paginasSemEspecificacao', 'tabelasRejeitadas', 'erros'):
        if d.get(k):
            doc[k] = d[k]
    salvar(os.path.join(DEST, nome_arq), doc)
    indice.append({'marca': marca, 'fabricanteId': fab, 'arquivo': f'modelos/{nome_arq}', 'totalModelos': len(saida), 'comEspecificacoes': doc['comEspecificacoes']})
    print(marca, len(saida), doc['comEspecificacoes'], 'descartados', len(descartados))

salvar(os.path.join(DEST, 'indice.json'), {'dataConsulta': DATA, 'marcas': indice,
    'pendentes': [
        {'marca': 'New Holland', 'motivo': 'O robots.txt de www.newholland.com proíbe a coleta automática de /pt-br/southamerica; o site de agricultura (agriculture.newholland.com) não está liberado no ambiente.'},
        {'marca': 'Tatu Marchesan', 'motivo': 'Site oficial www.marchesan.com.br não liberado no ambiente.'},
        {'marca': 'Fendt', 'motivo': 'Site respondeu apenas com página da América do Norte; linha brasileira não verificada.'},
    ]})
print('total', sum(x['totalModelos'] for x in indice))
