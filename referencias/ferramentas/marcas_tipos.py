"""Agrupa o catálogo por MARCA COMERCIAL e por TIPO de máquina (usado por gerar_dados_app.py).

- Fichas dos fabricantes já vêm com a marca comercial (Stara, John Deere...).
- A lista do BNDES/FINAME traz a razão social: CNH, AGCO e Marchesan fabricam várias marcas,
  separadas pelo nome do produto (que cita a marca: "COLHEITADEIRA ... NEW HOLLAND CR10").
- O tipo vem da família da ficha ou de palavras do nome do produto; sem palavra conhecida → "Outros".
  É só agrupamento para navegação: não altera nenhum dado de origem.
"""
import re
import unicodedata

TIPOS = [
    ('tratores', 'Tratores'),
    ('colheita', 'Colheitadeiras e plataformas'),
    ('pulverizacao', 'Pulverizadores'),
    ('plantio', 'Plantadeiras e semeadoras'),
    ('distribuicao', 'Distribuidores e adubadoras'),
    ('solo', 'Preparo de solo'),
    ('tratos', 'Roçadeiras e tratos culturais'),
    ('forragem', 'Forragem e pecuária'),
    ('transporte', 'Carretas e transporte'),
    ('armazenagem', 'Armazenagem, secagem e beneficiamento'),
    ('irrigacao', 'Irrigação'),
    ('movimentacao', 'Movimentação e carga'),
    ('precisao', 'Agricultura de precisão'),
    ('outros', 'Outros'),
]

# família da ficha do fabricante → tipo
FAMILIA_TIPO = {
    'trator': 'tratores', 'utilitario': 'tratores',
    'colhedora_graos': 'colheita', 'colhedora_cana': 'colheita', 'colhedora_cafe': 'colheita', 'colhedora_algodao': 'colheita',
    'plataforma_colheita': 'colheita', 'plataforma_milho': 'colheita',
    'colhedora_forragem': 'forragem', 'forragem': 'forragem', 'enfardadora': 'forragem',
    'semeadora': 'plantio', 'distribuidor': 'distribuicao', 'adubadora': 'distribuicao',
    'grade': 'solo', 'arado': 'solo', 'plaina': 'solo', 'plaina_niveladora': 'solo', 'subsolador': 'solo',
    'escarificador': 'solo', 'preparo_solo': 'solo',
    'cultivador': 'tratos', 'rocadeira': 'tratos', 'equipamento_poda': 'tratos',
    'carreta_graneleira': 'transporte', 'agricultura_precisao': 'precisao',
}

# palavras (sem acento, maiúsculas) → tipo; a ordem decide os casos ambíguos
PALAVRAS = [
    ('precisao', ['PRECISAO', 'PILOTO AUTOMATICO', 'PILOTO ELETRICO', 'MONITOR DE', 'BARRA DE LUZ', 'BARRA LUZ', 'GPS', 'TAXA VARIAVEL']),
    ('irrigacao', ['IRRIG', 'PIVO', 'ASPERS', 'GOTEJ', 'MOTOBOMBA', 'CARRETEL', 'FERTIRRIG']),
    ('forragem', ['FORRAG', 'ENSILAD', 'ENFARD', 'SEGADEIRA', 'ANCINHO', 'VAGAO', 'TRONCO', 'MISTURADOR', 'MISTURADORA', 'ALIMENTADOR', 'DESINTEGRADOR', 'PICADEIRA', 'PICADOR', 'ORDENH', 'RESFRIADOR', 'TANQUE DE EXPANSAO', 'BALANCA PARA BOVINOS', 'COMEDOURO', 'BEBEDOURO', 'COCHO', 'BAIA', 'CANZIL', 'CONTENCAO', 'BRETE', 'AQUECEDOR', 'CAMPANULA', 'AVIARIO', 'PELETIZ', 'EXTRUSOR', 'MOINHO', 'HOMOGENEIZ', 'GAIOLA', 'LEITE']),
    ('armazenagem', ['SILO', 'SECADOR', 'ARMAZEN', 'ELEVADOR', 'TRANSPORTADOR', 'TRANPORTADOR', 'MOEGA', 'CLASSIFICAD', 'BENEFICIAD', 'MAQUINA DE LIMPEZA', 'PRE-LIMPEZA', 'PRE LIMPEZA', 'DESPOLPAD', 'DESCASCAD', 'TRILHAD', 'DEBULHAD', 'TOMBADOR', 'AERACAO', 'AERADOR', 'TERMOMETRIA', 'MESA DENSIMETRICA', 'TRATADOR DE SEMENTES', 'BIG BAG', 'ENSACAD', 'EMBOLSAD', 'TULHA', 'ROSCA', 'REDLER', 'PENEIRA', 'FORNALHA', 'QUEIMADOR', 'DESIDRATADOR', 'CALADOR', 'AMOSTR', 'DETERMINADOR DE UMIDADE', 'SUGADOR', 'ESTEIRA', 'CORREIA TRANSPORTADORA', 'ABANADOR', 'CATADOR', 'BATEDOR', 'EXTRATORA DE GRAOS']),
    ('colheita', ['COLHE', 'PLATAFORMA', 'RECOLHEDOR']),
    ('pulverizacao', ['PULVERIZ', 'ATOMIZ', 'NEBULIZ', 'INSETICIDA', 'BICO', 'TURBO']),
    ('plantio', ['PLANTAD', 'SEMEAD', 'TRANSPLANTAD']),
    ('distribuicao', ['DISTRIBUID', 'ADUBAD', 'CALCARIO', 'FERTILIZ', 'CORRETIV', 'APLICADOR DE ADUBO', 'ESPALHAD']),
    ('transporte', ['CARRETA', 'REBOQUE', 'TRANSBORD', 'GRANELEIRA', 'CACAMBA', 'BASCULANTE']),
    ('movimentacao', ['GUINCHO', 'GUINDASTE', 'CARREGAD', 'PA CARREG', 'CONCHA', 'GARRA', 'GARFO', 'EMPILHAD', 'MUNCK', 'RASPADEIRA', 'RETROESCAV']),
    ('tratos', ['ROCAD', 'PODA', 'CAPINAD', 'CULTIVADOR', 'SULCADOR', 'ENLEIRAD', 'TRITURADOR']),
    ('solo', ['GRADE', 'ARADO', 'SUBSOL', 'ESCARIF', 'PLAINA', 'ENXADA', 'DESCOMPACT', 'NIVELADORA', 'TERRAC', 'LAMINA', 'ROLO', 'ENCANTEIRAD', 'DESTOCAD']),
]

# razão social (trecho) → marca comercial
APELIDOS = [
    ('JOHN DEERE', 'John Deere'), ('MAQUINAS AGRICOLAS JACTO', 'Jacto'), ('STARA S', 'Stara'), ('KUHN', 'Kuhn'),
    ('BALDAN', 'Baldan'), ('JUMIL', 'Jumil'), ('SEMEATO', 'Semeato'), ('VENCE TUDO', 'Vence Tudo'), ('HORSCH', 'Horsch'),
    ('AGRALE', 'Agrale'), ('MAHINDRA', 'Mahindra'), ('YANMAR', 'Yanmar'), ('LS MTRON', 'LS Tractor'),
    ('AGRITECH LAVRALE', 'Lavrale'), ('DMB MAQUINAS', 'DMB'), ('AGRIMEC', 'Agrimec'), ('IKEDA', 'Ikeda'),
    ('TRITON', 'Triton'), ('SOLLUS', 'Sollus'), ('KEPLER WEBER', 'Kepler Weber'), ('GSI BRASIL', 'GSI'),
    ('ANTONIOSI', 'Antoniosi'), ('PINHALENSE', 'Pinhalense'), ('IPACOL', 'Ipacol'), ('KOHLER IMPLEMENTOS', 'Kohler'),
    ('GTS DO BRASIL', 'GTS'), ('TRAMONTINI', 'Tramontini'), ('SAUR EQUIPAMENTOS', 'Saur'), ('MACHINA ZACCARIA', 'Zaccaria'),
    ('SANGATI BERGA', 'Sangati Berga'), ('MENTA MAQUINAS', 'Menta'), ('RUGERI', 'Rugeri'), ('FANKHAUSER', 'Fankhauser'),
]
# fabricantes de várias marcas: a marca vem do nome do produto
MULTIMARCA = [
    ('CNH INDUSTRIAL', [('NEW HOLLAND', 'New Holland'), ('CASE', 'Case IH')], 'CNH Industrial'),
    ('AGCO DO BRASIL', [('MASSEY', 'Massey Ferguson'), ('VALTRA', 'Valtra'), ('FENDT', 'Fendt'), ('CHALLENGER', 'Challenger')], 'AGCO'),
    ('MARCHESAN', [('CIVEMASA', 'Civemasa')], 'Tatu Marchesan'),
]

SUFIXOS = r'\b(LTDA\.?|S\.?\s?/?\s?A\.?|EIRELI|ME|EPP|EM RECUPERACAO JUDICIAL|EM RECUPERACAO|EM RE\w*|INDUSTRIA E COMERCIO|IND\.? E COM\.?|COMERCIO E INDUSTRIA|INDUSTRIA|COMERCIO|IMPORTACAO E EXPORTACAO|DO BRASIL|DE MAQUINAS|MAQUINAS AGRICOLAS|MAQUINAS E IMPLEMENTOS AGRICOLAS|IMPLEMENTOS AGRICOLAS|IMPLEMENTOS E MAQUINAS AGRICOLAS|MAQUINAS E EQUIPAMENTOS AGRICOLAS|MAQUINAS E EQUIPAMENTOS|EQUIPAMENTOS AGRICOLAS|AGROINDUSTRIAL|E CIA|& CIA)\b'
MINUSC = {'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'PARA', 'A', 'O'}


def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').upper()


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', sem_acento(s).lower()).strip('-')


def limpar_razao(razao):
    s = sem_acento(razao)
    for _ in range(3):
        s = re.sub(SUFIXOS, ' ', s)
    s = re.sub(r'\(\d+\)', ' ', s)
    s = re.sub(r'\s*[,&]\s*(?=[,&]|$)', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    # pontas soltas que sobram da remoção ("Schemaq de", "Agrijet e L", "Dryeration - , e")
    for _ in range(4):
        s = re.sub(r'(\s+(DE|DA|DO|DOS|DAS|E|EM|PARA|&|-|,|[A-Z]))+$', '', s).strip(' -,.&/')
        s = re.sub(r'\s+[-,]\s*(?=[-,]|\s(DE|E)\b)', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    if not s:
        return razao.strip()
    # siglas curtas ficam em maiúsculas (NB, TMA, GSI); conectivos em minúsculas; o resto capitalizado
    return ' '.join(p.lower() if p in MINUSC and i else p if len(p) <= 3 and p not in MINUSC else p.capitalize()
                    for i, p in enumerate(s.split(' ')))


def marca_finame(razao, texto_produto):
    r, t = sem_acento(razao), sem_acento(texto_produto)
    for chave, marcas, padrao in MULTIMARCA:
        if chave in r:
            for k, nome in marcas:
                if re.search(r'\b' + k + r'\b', t):
                    return nome
            return padrao
    for chave, nome in APELIDOS:
        if chave in r:
            return nome
    return limpar_razao(razao)


def tipo_de(texto, familia=None):
    if familia in FAMILIA_TIPO:
        return FAMILIA_TIPO[familia]
    if familia and familia.startswith('pulverizador') or familia == 'bico_pulverizacao':
        return 'pulverizacao'
    t = sem_acento(texto)
    if re.match(r'\s*(TRATOR|TRATORES|MICROTRATOR|MINI ?TRATOR)\b', t):
        return 'tratores'
    for tipo, palavras in PALAVRAS:
        if any(p in t for p in palavras):
            return tipo
    if re.search(r'\bTRATOR(ES)?\b', t) and 'PARA TRATOR' not in t:
        return 'tratores'
    return 'outros'
