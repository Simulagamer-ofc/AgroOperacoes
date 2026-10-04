import json
import re
from comum import baixar, slug, salvar, DATA

FAM = {'tratores': 'trator', 'colheitadeiras-de-graos': 'colhedora_graos', 'colhedoras-de-cana': 'colhedora_cana',
       'plantadeiras': 'semeadora', 'plataformas': 'plataforma_colheita', 'pulverizadores': 'pulverizador', 'implementos': 'carregadora_frontal'}
BASE = 'https://www.caseih.com/pt-br/brasil/produtos/'
sm = open('case_br.xml', encoding='utf-8').read()
urls = sorted(set(u for u in re.findall(r'<loc>(.*?)</loc>', sm) if u.startswith(BASE) and len(u[len(BASE):].split('/')) >= 2))
dec = json.JSONDecoder()
modelos, sem, erros = {}, [], []
for u in urls:
    cat = u[len(BASE):].split('/')[0]
    if cat == 'tecnologia-de-precisao':
        continue
    s = baixar(u)
    if not s:
        erros.append({'url': u, 'motivo': 'download'}); continue
    achou = False
    for m in re.finditer(r'"componentName":"ProductModelSpecifications"', s):
        i = s.find('"fields":', m.end())
        try:
            obj, _ = dec.raw_decode(s, i + len('"fields":'))
        except ValueError as e:
            erros.append({'url': u, 'motivo': f'JSON: {e}'}); continue
        for md in (obj.get('apiData') or {}).get('models') or []:
            esp = []
            for g in md.get('specs') or []:
                for it in g.get('items') or []:
                    v = (it.get('value') or '').strip()
                    if v:
                        esp.append({'secao': g.get('group'), 'campo': (it.get('key') or '').strip(), 'valor': v})
            chave = md.get('id') or md.get('title')
            if chave in modelos:
                modelos[chave]['urls'].append(u); continue
            nome = re.sub(r'^(Trator|Colheitadeira|Plantadeira|Pulverizador|Colhedora de Cana|Plataforma)\s+', '', md.get('title') or '').strip()
            modelos[chave] = {'id': 'case-ih-' + slug(md.get('titleUrl') or nome), 'marca': 'Case IH', 'modelo': nome, 'tituloFabricante': md.get('title'),
                              'familia': FAM.get(cat), 'categoriaFabricante': cat, 'url': u, 'urls': [u], 'especificacoes': esp,
                              'origemEspecificacoes': 'dados estruturados "ProductModelSpecifications" embutidos na página (texto literal)'}
            achou = True
    if not achou:
        sem.append(u)
    print(cat, u.split('/')[-1], achou)

lista = list(modelos.values())
for m in lista:
    m.pop('urls') if len(m['urls']) == 1 else None
salvar('case-ih.json', {'fabricanteId': 'cnh', 'marca': 'Case IH', 'fonte': 'https://www.caseih.com/pt-br/brasil/sitemap.xml', 'dataConsulta': DATA,
                        'modelos': lista, 'paginasSemEspecificacao': sem, 'erros': erros})
print(len(lista), 'modelos;', sum(1 for m in lista if m['especificacoes']), 'com especificações; páginas sem spec', len(sem))
