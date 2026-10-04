import html as H
import re
import subprocess
import urllib.parse
from comum import titulo, slug, salvar, DATA, UA

CATS = {'tratores': 'trator', 'colheitadeiras': None, 'soluções-para-plantio': 'semeadora', 'tratos-culturais': None,
        'forrageira': 'forragem', 'pulverizadores': 'pulverizador', 'picadoras-de-forragem-automotrizes': 'forragem',
        'carregadoras-frontais-para-tratores': 'carregadora_frontal', 'preparo-de-solo': 'preparo_solo'}


def familia(cat, rel):
    r = rel.lower()
    if cat == 'colheitadeiras':
        if 'plataforma' in r: return 'plataforma_colheita'
        if 'cana' in r: return 'colhedora_cana'
        if 'algod' in r: return 'colhedora_algodao'
        if 'forrage' in r: return 'colhedora_forragem'
        return 'colhedora_graos'
    if cat == 'tratos-culturais':
        if 'pulverizador' in r or 'm40' in r or 'drybox' in r: return 'pulverizador'
        if 'distribuidor' in r: return 'distribuidor'
        if 'descompactador' in r: return 'preparo_solo'
        return None
    return CATS.get(cat)


def limpar(x):
    x = re.sub(r'<br\s*/?>', ' / ', x, flags=re.I)
    x = H.unescape(re.sub(r'<[^>]+>', '', x))
    return re.sub(r'\s+', ' ', x).strip(' /')


def specs(s):
    out = []
    for bloco in re.split(r'<div class="specification-container', s)[1:]:
        m = re.search(r'<div class="table-title">\s*<h3>(.*?)</h3>', bloco, re.S)
        secao = limpar(m.group(1)) if m else None
        for tr in re.findall(r'<tr data-spec="[^"]*">(.*?)</tr>', bloco, re.S):
            th = re.search(r'<th class="column-1">(.*?)</th>', tr, re.S)
            td = re.search(r'<td class="column-2">(.*?)</td>', tr, re.S)
            if th and td and limpar(td.group(1)):
                out.append({'secao': secao, 'campo': limpar(th.group(1)), 'valor': limpar(td.group(1))})
    return out


if __name__ != '__main__':
    raise SystemExit
sm = open('deere_sitemap.xml', encoding='utf-8').read()
entradas = re.findall(r'<loc>(.*?)</loc>\s*<lastmod>(.*?)</lastmod>', sm)
cand = {}
for u, lm in entradas:
    rel = urllib.parse.unquote(u).split('/pt/')[1] if '/pt/' in u else ''
    partes = [p for p in rel.split('/') if p]
    if len(partes) < 2 or partes[0] not in CATS:
        continue
    if any(k in rel for k in ('simulador', 'simulator', 'advisor', '.html')):
        continue
    chave = rel.lower()
    cand.setdefault(chave, (u, lm, partes[0], rel))

modelos, sem_spec, redirecionadas = [], [], []
for chave, (u, lm, cat, rel) in sorted(cand.items()):
    r = subprocess.run(['curl', '-sSL', '-m', '30', '-A', UA, '-w', '\n__URL__%{url_effective}', u], capture_output=True)
    out = r.stdout.decode('utf-8', errors='replace')
    if '__URL__' not in out:
        sem_spec.append({'url': u, 'motivo': 'falha no download'}); continue
    s, final = out.rsplit('\n__URL__', 1)
    if urllib.parse.unquote(final).lower().rstrip('/') != urllib.parse.unquote(u).lower().rstrip('/'):
        redirecionadas.append({'url': u, 'redirecionaPara': final, 'lastmodSitemap': lm}); continue
    e = specs(s)
    t = titulo(s)
    if not e:
        sem_spec.append({'url': u, 'titulo': t, 'lastmodSitemap': lm}); continue
    nome = t.split('|')[0].strip()
    modelos.append({'id': 'john-deere-' + slug(rel), 'marca': 'John Deere', 'modelo': nome, 'linha': t.split('|')[1].strip() if '|' in t else None,
                    'familia': familia(cat, rel), 'categoriaFabricante': cat, 'url': u, 'lastmodSitemap': lm,
                    'especificacoes': e, 'origemEspecificacoes': 'tabela de especificações da página do modelo (texto literal)'})
    print(len(modelos), nome, '|', familia(cat, rel), '|', len(e))

salvar('john-deere.json', {'fabricanteId': 'john-deere', 'marca': 'John Deere', 'fonte': 'https://www.deere.com.br/pt/sitemap.xml', 'dataConsulta': DATA,
                           'observacao': 'Páginas que redirecionam (modelos fora de linha) foram descartadas e listadas em "redirecionadas".',
                           'modelos': modelos, 'paginasSemEspecificacao': sem_spec, 'redirecionadas': redirecionadas})
print('modelos', len(modelos), 'sem spec', len(sem_spec), 'redirecionadas', len(redirecionadas))
