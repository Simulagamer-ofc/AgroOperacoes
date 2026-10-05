"""Extrai tabelas HTML expandindo rowspan/colspan em uma grade retangular."""
from html.parser import HTMLParser
import re


def _int(v):
    try:
        return max(1, int(v))
    except (TypeError, ValueError):
        return 1


class _P(HTMLParser):
    def __init__(self, classe=None):
        super().__init__(convert_charrefs=True)
        self.classe = classe
        self.tabelas, self.prof, self.atual, self.linha, self.celula = [], 0, None, None, None
        self.ignorar = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'):
            self.ignorar += 1
        if tag == 'table':
            if self.prof == 0 and (self.classe is None or self.classe in (a.get('class') or '')):
                self.atual = []; self.prof = 1
            elif self.prof:
                self.prof += 1
        elif self.prof == 1:
            if tag == 'tr':
                self.linha = []
            elif tag in ('td', 'th'):
                self.celula = {'txt': [], 'th': tag == 'th', 'cs': _int(a.get('colspan')), 'rs': _int(a.get('rowspan'))}
            elif tag == 'br' and self.celula is not None:
                self.celula['txt'].append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignorar -= 1
        if not self.prof:
            return
        if self.prof == 1 and tag in ('td', 'th') and self.celula is not None and self.linha is not None:
            self.celula['txt'] = re.sub(r'[\s​]+', ' ', ''.join(self.celula['txt'])).strip()
            self.linha.append(self.celula); self.celula = None
        elif self.prof == 1 and tag == 'tr' and self.linha is not None:
            self.atual.append(self.linha); self.linha = None
        elif tag == 'table':
            self.prof -= 1
            if self.prof == 0:
                self.tabelas.append(self.atual); self.atual = None

    def handle_data(self, d):
        if self.prof == 1 and self.celula is not None and not self.ignorar:
            self.celula['txt'].append(d)


def _grade(linhas):
    """Expande rowspan/colspan. Retorna lista de linhas de dicts {txt, th}."""
    grade, pend = [], {}  # pend[(r, c)] = célula herdada
    for r, linha in enumerate(linhas):
        out, c = [], 0
        fila = list(linha)
        while fila or (r, c) in pend:
            if (r, c) in pend:
                out.append(pend.pop((r, c))); c += 1; continue
            cel = fila.pop(0)
            for dc in range(cel['cs']):
                item = {'txt': cel['txt'], 'th': cel['th']}
                out.append(item)
                for dr in range(1, cel['rs']):
                    pend[(r + dr, c + dc)] = item
            c += cel['cs']
        grade.append(out)
    return grade


def tabelas(html, classe=None, com_th=False):
    p = _P(classe)
    p.feed(html)
    res = []
    for t in p.tabelas:
        g = [row for row in _grade(t) if any(x['txt'] for x in row)]
        res.append(g if com_th else [[x['txt'] for x in row] for row in g])
    return res


def tabela_modelos(grade):
    """Recebe grade (com_th=True). Separa cabeçalho (linhas iniciais só com th, ou a primeira linha)
    e devolve (colunas, linhas_de_dados, problemas)."""
    if not grade:
        return [], [], ['tabela vazia']
    n = max(len(r) for r in grade)
    cab = [grade[0]]
    k = 1
    while k < len(grade) and all(x['th'] for x in grade[k]) and grade[k]:
        cab.append(grade[k]); k += 1
    colunas = []
    for c in range(n):
        partes = []
        for row in cab:
            t = row[c]['txt'] if c < len(row) else ''
            if t and t not in partes:
                partes.append(t)
        colunas.append(' — '.join(partes))
    dados, problemas = [], []
    for row in grade[k:]:
        vals = [x['txt'] for x in row]
        if len([v for v in vals if v]) <= 1:
            continue  # nota/rodapé
        if len(vals) != n:
            problemas.append(f'linha com {len(vals)} colunas (esperado {n}): {vals[:3]}')
            continue
        dados.append(vals)
    return colunas, dados, problemas
