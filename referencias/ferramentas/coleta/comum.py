"""Funções comuns para extrair modelos dos sites dos fabricantes."""
import html
import json
import re
import subprocess
import time
import unicodedata

DATA = '2026-10-04'
UA = 'Mozilla/5.0 (compatible; NexusAgroCatalogo/0.1)'


def baixar(url, tentativas=2):
    for i in range(tentativas):
        r = subprocess.run(['curl', '-sSL', '-m', '30', '-A', UA, url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout.decode('utf-8', errors='replace')
        time.sleep(2)
    return None


def linhas_texto(s):
    t = re.sub(r'<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>', '', s, flags=re.S | re.I)
    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
    return [re.sub(r'\s+', ' ', x).strip() for x in t.split('\n') if x.strip()]


def titulo(s):
    m = re.search(r'<title[^>]*>(.*?)</title>', s, re.S | re.I)
    return html.unescape(re.sub(r'\s+', ' ', m.group(1))).strip() if m else ''


def slug(s):
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def salvar(caminho, dados):
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
