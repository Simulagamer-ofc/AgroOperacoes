"""Monta dados/pontas.json com vários fabricantes.
Uso (na raiz): python3 referencias/ferramentas/montar_pontas.py app/src/main/assets/www/dados/pontas.json referencias/pontas/{jacto,jacto_extra,teejet,hypro,hypro_eu,hypro_br,lechler,albuz,magnojet}.json
Os arquivos de referencias/pontas/ são as extrações dos catálogos oficiais (fonte, página e método em cada linha).
Regras: só linhas extraídas como texto (pdftotext/OCR conferido); unidade como impressa;
células que contradizem a própria tabela (vazão menor que numa pressão menor, ou fora de ±8% da classe ISO
em pontas de leque sem pré-orifício) não são sugeridas — vão para naoSugeridos com o motivo."""
import json, re, sys, math
saida, entradas = sys.argv[1], sys.argv[2:]
# Exclusões conferidas à mão (Jacto, ver revisão de 07/10/2026)
MANUAIS = {('Jacto','J3D - 10008','15'):'igual à J3D 10006 (provável erro de impressão)',('Jacto','J3D - 10008','20'):'igual à J3D 10006 (provável erro de impressão)',
 ('Jacto','ADI 11003','30'):'valor incompatível com as demais pressões da tabela',('Jacto','ADI 11004','30'):'valor incompatível com as demais pressões da tabela',
 ('Jacto','JEF 80015','25'):'pressão impressa "25" onde as demais pontas JEF usam 35',('Jacto','JHC 8002','135'):'valor fora da sequência das demais pressões',
 ('Jacto','AXI 11003','20'):'diferente das demais pontas 110-03 do mesmo folheto',
 ('TeeJet','TTI11010','*'):'de 2 a 7 bar o catálogo imprime as vazões da capacidade 15, não 10 (erro de impressão; igual no Catálogo 52-PT)',
 **{('Hypro (Pentair)','LDC90-01',x):'linha aparentemente deslocada uma pressão (abaixo da classe ISO 01 de 1,5 a 3,5 bar; igual na seção em espanhol)' for x in ('1.5','2','2.5','3','3.5')},
 ('TeeJet','DGTJ60-110015','4'):'salto de 0,64 para 0,76 entre 3,5 e 4 bar, incoerente com os demais tamanhos (igual no Catálogo 52-PT)'}
ISO = {'01':.4,'015':.6,'02':.8,'025':1.0,'03':1.2,'04':1.6,'05':2.0,'06':2.4,'08':3.2,'10':4.0}
PSI = 0.0689476
TIPOS = {'indução de ar': 'inducao_ar', 'inducao de ar': 'inducao_ar', 'cone vazio': 'cone_vazio', 'cone cheio': 'cone_cheio', 'duplo leque': 'duplo_leque',
         'leque triplo': 'leque_triplo', 'leque antideriva': 'leque_antideriva'}
# Sizes conferidos com uma célula de L/ha divergente (critério mais frouxo): ficam de fora por coerência com o critério da Magnojet
FORA_TAMANHO = {('Jacto', 'ESI 015'), ('Jacto', 'ESI 03'), ('Jacto', 'XT 10'), ('Jacto', 'XT 20')}
def kp(p): return str(float(p)).rstrip('0').rstrip('.')
def unidade_pressao(u):
    u = (u or '').lower()
    if 'psi' in u or 'lbf' in u: return 'psi'
    if 'bar' in u: return 'bar'
    raise ValueError('unidade desconhecida: ' + u)
fabs = {}
for arq in entradas:
    d = json.load(open(arq))
    nome = d['fabricante']
    fab = fabs.setdefault(nome, {'id': re.sub(r'[^a-z0-9]+','-',nome.lower()).strip('-'), 'nome': nome, 'fontes': {}, 'linhas': [], 'naoSugeridos': [], 'deFora': []})
    for f in d['fontes']:
        fab['fontes'][f['id']] = {'id': f['id'], 'titulo': re.sub(r'\s*–\s*jacto\.com$','',f['titulo']), 'url': f.get('urlArquivo') or f['url'], 'ano': str(f.get('ano') or '')}
    for l in d['linhas']:
        met = (l.get('metodoExtracao') or '').lower()
        if met.startswith('leitura visual') or not met:
            fab['deFora'].append({'linha': l['linha'], 'motivo': 'valores lidos só pela imagem do PDF'}); continue
        if any(x['linha'] == l['linha'] for x in fab['linhas']):
            raise SystemExit(f'linha repetida {nome} {l["linha"]}')
        ups = {unidade_pressao(t.get('unidade')) for t in l['tamanhos']}
        if len(ups) != 1: raise SystemExit(f'unidades misturadas em {nome} {l["linha"]}')
        up = ups.pop()
        tipo = l.get('tipo') or ''
        tipo = TIPOS.get(tipo.lower(), tipo)
        # Classe ISO: ±8% em leque comum; ±15% nas demais pontas de leque (pré-orifício, indução, duplo/triplo) — só pega erro de impressão
        tol = 0.08 if tipo == 'leque' and not l.get('preOrificioOuInducao') else 0.15
        iso_ok = tipo not in ('cone_vazio', 'cone_cheio')
        tams = []
        for t in l['tamanhos']:
            if t['codigo'] == 'JMD 130003' or (nome, t['codigo']) in FORA_TAMANHO: continue
            vz = {}
            ordem = sorted(t['vazoes'].items(), key=lambda kv: float(kv[0]))
            anterior = None
            for p, q in ordem:
                motivo = MANUAIS.get((nome, t['codigo'], p)) or MANUAIS.get((nome, t['codigo'], kp(p))) or MANUAIS.get((nome, t['codigo'], '*'))
                if not motivo and anterior is not None and q < anterior[1]:
                    motivo = f'vazão menor que a de {kp(anterior[0]).replace(".", ",")} {up} ({str(anterior[1]).replace(".", ",")})'
                cod = t['codigo'].split(' / ')[0]
                m = re.search(r'(?:80|90|95|110|120|130)(0\d{1,2}|10)$', re.sub(r'[^0-9]', '', cod))
                if not m and t.get('corIso'): m = re.search(r'\s(0\d{1,2}|10)$', cod)  # numeração ISO sem o ângulo (ex.: AD 015)
                if not motivo and iso_ok and m and m.group(1) in ISO:
                    bar = float(p) * (PSI if up == 'psi' else 1)
                    esp = ISO[m.group(1)] * math.sqrt(bar / 3)
                    if abs(q / esp - 1) > tol: motivo = f'fora de ±{round(tol * 100)}% da classe ISO {m.group(1)} nessa pressão (provável erro de impressão)'
                if motivo:
                    fab['naoSugeridos'].append({'linha': l['linha'], 'tamanho': t['codigo'], 'pressao': float(p), 'impresso': q, 'motivo': motivo}); continue
                vz[kp(p)] = q
                if anterior is None or q >= anterior[1]: anterior = (p, q)
            if vz: tams.append({'codigo': t['codigo'], 'corIso': t.get('corIso'), 'vazoes': vz})
        mf = re.match(r'([\d.,]+)\s*a\s*([\d.,]+)', l.get('faixaPressaoImpressa') or '')
        pag = re.sub(r'^PDF\s*p\.\s*', '', str(l.get('pagina') or ''))
        if pag: pag = (f"{l['paginaImpressa']} ({pag} do PDF)" if l.get('paginaImpressa') else f'{pag} do PDF')
        fab['linhas'].append({'id': re.sub(r'[^a-z0-9]+','-',l['linha'].lower()).strip('-'), 'linha': l['linha'], 'tipo': tipo, 'angulos': l.get('angulos') or [],
            'preOrificioOuInducao': bool(l.get('preOrificioOuInducao')), 'unidadePressao': up,
            'faixaPressao': [float(mf.group(1).replace(',','.')), float(mf.group(2).replace(',','.'))] if mf else None,
            'fonte': l['fonte'], 'pagina': pag, 'observacao': l.get('observacoes') or l.get('observacao') or '', 'tamanhos': tams})
out = []
for fab in fabs.values():
    usadas = {l['fonte'] for l in fab['linhas']}
    ids = [l['id'] for l in fab['linhas']]
    assert len(set(ids)) == len(ids), fab['nome']
    if not fab['linhas']: continue
    out.append({'id': fab['id'], 'nome': fab['nome'], 'fontes': [f for i, f in fab['fontes'].items() if i in usadas], 'linhas': fab['linhas'], 'naoSugeridos': fab['naoSugeridos']})
    print(fab['nome'], len(fab['linhas']), 'linhas', sum(len(l['tamanhos']) for l in fab['linhas']), 'tamanhos', len(fab['naoSugeridos']), 'não sugeridos', 'de fora:', [x['linha'] for x in fab['deFora']])
json.dump({'versao': '1.1.0', 'geradoEm': '2026-10-08', 'aviso': 'Vazões copiadas das tabelas dos catálogos oficiais dos fabricantes, na unidade de pressão impressa. Valores impressos que contradizem a própria tabela não são sugeridos. Confira sempre a referência gravada na ponta.', 'fabricantes': out}, open(saida, 'w'), ensure_ascii=False, separators=(',', ':'))
