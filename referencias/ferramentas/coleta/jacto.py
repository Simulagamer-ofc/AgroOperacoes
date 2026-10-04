import html as H
import json
import re
from comum import slug, salvar, DATA


def txt(v):
    if isinstance(v, dict):
        v = v.get('pt_BR') or ''
    if not isinstance(v, str):
        return ''
    v = re.sub(r'<br\s*/?>|</p>\s*<p>', ' / ', v, flags=re.I)
    v = H.unescape(re.sub(r'<[^>]+>', '', v))
    return re.sub(r'\s+', ' ', v).strip(' /')


EXCLUIR = ('Lubrificantes', 'Comunicados', 'LAVADORAS', 'ASPIRADORES', 'EXTRATORAS', 'SANITIZADORAS', 'Treinamentos', 'Agricultura Digital', 'Ecossistema digital', 'INTELIGÊNCIA PREDITIVA')
FAMS = [('Pulverizadores Automotrizes', 'pulverizador_autopropelido'), ('Pulverizador Autônomo', 'pulverizador_autonomo'),
        ('Pulverizadores de Barras', 'pulverizador_barra_tratorizado'), ('Pulverizadores Turbo', 'pulverizador_turbo'),
        ('Drones', 'pulverizador_drone'), ('Costa', 'pulverizador_costal'), ('Bicos', 'bico_pulverizacao'), ('Plantadeiras', 'semeadora'),
        ('Adubadoras', 'adubadora'), ('Distribuidores de Grânulos', 'distribuidor'), ('Colhedoras de Café', 'colhedora_cafe'),
        ('Colhedora de Cana', 'colhedora_cana'), ('poda', 'equipamento_poda'), ('Agricultura de Precisão', 'agricultura_precisao'),
        ('SmartSelector', 'agricultura_precisao'), ('MOTOBOMBAS', 'motobomba'), ('Bomba de Pistões', 'bomba'), ('Saúde Ambiental', 'pulverizador_costal')]


def fam(cat):
    for k, f in FAMS:
        if k.lower() in cat.lower():
            return f
    return None


prods = json.load(open('jacto_api.json'))
cats = {c['id']: c for c in json.load(open('jacto_cat.json'))}


def nome_cat(i):
    c = cats.get(i)
    if not c:
        return None
    pai = cats.get(c.get('parent_id'))
    return ' > '.join(x for x in [txt(pai['name']) if pai else None, txt(c['name'])] if x)


modelos = []
for p in prods:
    if not (1 in (p.get('markets_ids') or []) and p.get('status') == 1 and p.get('enabled') == 1):
        continue
    esp = []
    for g in [g for g in (p.get('specifications') or []) if isinstance(g, dict)]:
        gt = txt(g.get('title')).rstrip(' /')
        sub = g.get('subgroup') or []
        sub = [x for x in (sub if isinstance(sub, list) else []) if isinstance(x, dict)]
        blocos = [{'title': None, 'items': g.get('items') or []}] + sub
        for sg in blocos:
            st = txt(sg.get('title'))
            for it in [i for i in (sg.get('items') or []) if isinstance(i, dict)]:
                t, d = txt(it.get('title')), txt(it.get('description'))
                if d:
                    esp.append({'secao': gt, 'campo': ' — '.join(x for x in [st, t] if x), 'valor': d})
                elif t and st:
                    esp.append({'secao': gt, 'campo': st, 'valor': t})
    # junta itens do mesmo campo (ex.: Cultura: Cereais, Hortaliças)
    junt = {}
    for e in esp:
        junt.setdefault((e['secao'], e['campo']), []).append(e['valor'])
    esp = [{'secao': s, 'campo': c, 'valor': ' | '.join(v)} for (s, c), v in junt.items()]
    cs = [nome_cat(i) for i in p.get('categories_ids') or []]
    if not any(cs) or all(any(x.lower() in (c or '').lower() for x in EXCLUIR) for c in cs):
        continue
    nome = txt(p['name'])
    sl = (p.get('slug') or {}).get('pt_BR') or slug(nome)
    folhetos = [f.get('file', {}).get('url') if isinstance(f.get('file'), dict) else None for f in p.get('files') or []]
    modelos.append({'id': 'jacto-' + sl, 'marca': 'Jacto', 'modelo': nome, 'linha': None, 'familia': fam(' '.join(c or '' for c in cs)),
                    'categoriaFabricante': ' ; '.join(c for c in cs if c), 'url': f'https://jacto.com/brasil/products/{sl}',
                    'atualizadoNoFabricante': p.get('updated_at'), 'especificacoes': esp,
                    'origemEspecificacoes': 'dados públicos do catálogo do site (jacto.com/api/v1/products), idioma pt_BR, texto literal'})

ids = {}
for m in modelos:
    ids[m['id']] = ids.get(m['id'], 0) + 1
    if ids[m['id']] > 1:
        m['id'] += f"-{ids[m['id']]}"
salvar('jacto.json', {'fabricanteId': 'jacto', 'marca': 'Jacto', 'fonte': 'https://jacto.com/api/v1/products (filtro: mercado Brasil, ativo)', 'dataConsulta': DATA, 'modelos': modelos})
from collections import Counter
print(len(modelos), sum(1 for m in modelos if m['especificacoes']))
print(Counter(m['categoriaFabricante'] for m in modelos).most_common(40))
