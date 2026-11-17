# Bateria das Notas da SEFAZ (servidor e SEFAZ simulados): cadastro do certificado pelo ADM, busca, lista,
# conferência pelo XML e entrada no estoque, ignorar, regra de 1 hora e usuário comum.
# Uso: (cd app/src/main/assets/www && python3 -m http.server 8772 &) ; python3 referencias/e2e/rodar-notas-sefaz.py [pasta-das-imagens]
import json, sys, time, urllib.parse, os, base64
from playwright.sync_api import sync_playwright
BASE = 'https://gfvtudfdhooavcchdpnm.supabase.co'
FAZ = {'id': '11111111-1111-1111-1111-111111111111', 'name': 'Fazenda Teste', 'join_code': 'AAA'}
SAIDA = sys.argv[1] if len(sys.argv) > 1 else '.'
def chave(n): return f'43261198765432000110550010000{n:05d}1123456780'[:43] + '0'
CA, CB, CC = chave(4521), chave(4522), chave(4523)
CFG = {'doc': '12345678000195', 'tipo_doc': 'CNPJ', 'nome': 'FAZENDA TESTE LTDA', 'validade': '2027-08-30T12:00:00Z', 'uf': '43', 'ambiente': 1, 'prox_consulta': None, 'ult_consulta': None, 'ult_cstat': None, 'ult_motivo': None}
XML_A = f'''<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe{CA}" versao="4.00"><ide><nNF>4521</nNF><serie>1</serie><dhEmi>2026-11-10T09:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>98765432000110</CNPJ><xNome>AGRO EXEMPLO INSUMOS LTDA</xNome></emit>
<det nItem="1"><prod><cProd>A1</cProd><xProd>GLIFOSATO 480 20L</xProd><NCM>38089324</NCM><uCom>GL</uCom><qCom>5.0000</qCom><vProd>1000.00</vProd></prod></det>
<det nItem="2"><prod><cProd>B2</cProd><xProd>UREIA 46% SC 50KG</xProd><NCM>31021010</NCM><uCom>SC</uCom><qCom>4.0000</qCom><vProd>500.00</vProd></prod></det>
<total><ICMSTot><vProd>1500.00</vProd><vNF>1500.00</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-12-10</dVenc><vDup>1500.00</vDup></dup></cobr></infNFe></NFe>
<protNFe><infProt><chNFe>{CA}</chNFe></infProt></protNFe></nfeProc>'''
S = {'cfg': None, 'notas': [], 'chamadas': [], 'marcar': []}
NOTAS = [
  {'chave': CA, 'situacao': 'completa', 'numero': '4521', 'emitente': 'AGRO EXEMPLO INSUMOS LTDA', 'cnpj_emit': '98765432000110', 'valor': 1500, 'emissao': '2026-11-10T12:00:00Z', 'ciencia_em': None, 'ciencia_cstat': None, 'ciencia_motivo': None, 'importada_em': None, 'importada_por': None, 'ignorada': False},
  {'chave': CB, 'situacao': 'resumo', 'numero': '4522', 'emitente': 'POSTO BOA VIAGEM', 'cnpj_emit': '11222333000144', 'valor': 820.5, 'emissao': '2026-11-12T12:00:00Z', 'ciencia_em': '2026-11-17T13:00:00Z', 'ciencia_cstat': '135', 'ciencia_motivo': 'Evento registrado', 'importada_em': None, 'importada_por': None, 'ignorada': False},
  {'chave': CC, 'situacao': 'cancelada', 'numero': '4523', 'emitente': 'AGRO EXEMPLO INSUMOS LTDA', 'cnpj_emit': '98765432000110', 'valor': 90, 'emissao': '2026-11-08T12:00:00Z', 'ciencia_em': None, 'ciencia_cstat': None, 'ciencia_motivo': None, 'importada_em': None, 'importada_por': None, 'ignorada': False}]
def resp(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}, body=json.dumps(body))
def api(route):
    req = route.request; u = urllib.parse.urlparse(req.url); q = urllib.parse.parse_qs(u.query); p = u.path
    if req.method == 'OPTIONS': return resp(route, {})
    corpo = json.loads(req.post_data or 'null') if req.method == 'POST' else None
    if p == '/functions/v1/sefaz':
        S['chamadas'].append(corpo['acao'])
        if corpo['acao'] == 'certificado':
            if corpo.get('senha') != 's3nh@': return resp(route, {'message': 'Senha do certificado incorreta.'}, 400)
            S['cfg'] = dict(CFG); return resp(route, {'config': S['cfg']})
        if corpo['acao'] == 'buscar':
            S['notas'] = [dict(n) for n in NOTAS]
            S['cfg'].update(prox_consulta=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3660)), ult_consulta=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), ult_cstat='137', ult_motivo='Nenhum documento localizado')
            return resp(route, {'novas': 3, 'completas': 1, 'canceladas': 1, 'ciencias': 1, 'cienciaFalhas': [], 'aguardar': S['cfg']['prox_consulta'], 'motivo': '', 'config': S['cfg']})
        if corpo['acao'] == 'remover': S['cfg'] = None; return resp(route, {'ok': True})
        return resp(route, {'message': 'Ação inválida.'}, 400)
    if p == '/rest/v1/sefaz_config': return resp(route, [S['cfg']] if S['cfg'] else [])
    if p == '/rest/v1/nfe_recebidas':
        if q.get('select', [''])[0] == 'xml': return resp(route, [{'xml': XML_A}] if q['chave'][0] == 'eq.' + CA else [{'xml': None}])
        return resp(route, S['notas'])
    if p == '/rest/v1/rpc/nfe_recebida_marcar':
        S['marcar'].append((corpo['p_chave'], corpo['p_acao']))
        for n in S['notas']:
            if n['chave'] == corpo['p_chave']:
                if corpo['p_acao'] == 'importada': n['importada_em'] = '2026-11-17T14:00:00Z'
                if corpo['p_acao'] == 'ignorar': n['ignorada'] = True
                if corpo['p_acao'] == 'desfazer': n['ignorada'] = False
        return resp(route, None)
    if p == '/rest/v1/rpc/meu_acesso': return resp(route, [{'farm_id': FAZ['id'], 'fazenda': FAZ['name'], 'status': 'ativo', 'role': 'admin', 'funcao': 'diretor', 'modulos': None}])
    if p == '/rest/v1/farm_members' and 'user_id' in q: return resp(route, [{'role': S.get('papel', 'admin'), 'funcao': 'diretor', 'modulos': None}])
    if p == '/rest/v1/farms': return resp(route, [FAZ])
    if p.startswith('/rest/v1/rpc/'): return resp(route, [] if 'push' in p else None)
    return resp(route, [])
NV = {'sessao': {'access_token': 't', 'refresh_token': 'r', 'expira': int(time.time()) + 36000, 'email': 'gestor@fazendateste.com', 'usuario': 'u1'}, 'sysadm': False, 'fazenda': FAZ, 'papel': 'admin', 'cursor': 0, 'rejeitados': {}}
ok = True
def check(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c
with sync_playwright() as p:
    b = p.chromium.launch()
    for mob in (False, True):
        px = 'm_' if mob else 'pc_'
        S.update(cfg=None, notas=[], chamadas=[], marcar=[])
        ctx = b.new_context(viewport={'width': 400 if mob else 1300, 'height': 860 if mob else 900}, device_scale_factor=2 if mob else 1)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.route(BASE + '/**', api); pg.route('**/api.open-meteo.com/**', lambda r: r.abort()); pg.route('**/tile.openstreetmap.org/**', lambda r: r.abort()); pg.route('**/redemet**', lambda r: r.abort())
        pg.add_init_script(f"if(!sessionStorage.getItem('ini')){{sessionStorage.setItem('ini','1'); localStorage.setItem('agro-nuvem', {json.dumps(json.dumps(NV))});}}")
        pg.goto('http://localhost:8772/index.html#/estoque'); pg.wait_for_timeout(3500)
        ev = pg.evaluate
        ev("document.querySelectorAll('.modal.open [data-close], .modal.open [data-no]').forEach(b=>b.click())")
        ev("go('estoque')"); pg.wait_for_timeout(500)
        check(pg.locator('[data-act="sf-abrir"]').count() >= 1, f'{px}Estoque tem o botão “🧾 Notas da SEFAZ”')
        ev("ACTIONS['sf-abrir']()"); pg.wait_for_timeout(800)
        t = pg.locator('main').inner_text()
        check('Como funciona' in t and pg.locator('main [data-act="sf-cert"]').count() >= 1, f'{px}sem certificado: explica e o ADM vê “Cadastrar certificado”')
        if not mob: pg.screenshot(path=os.path.join(SAIDA, px + 'sefaz_inicio.png'))
        # Certificado: senha errada, depois certa
        pg.locator('main [data-act="sf-cert"]').first.click(); pg.wait_for_timeout(300)
        pfx = os.path.join(SAIDA, 'teste.pfx'); open(pfx, 'wb').write(b'0' * 2000)
        pg.set_input_files('#sfPfx', pfx); pg.fill('#sfSenha', 'errada')
        if not mob: pg.screenshot(path=os.path.join(SAIDA, px + 'sefaz_certificado.png'))
        pg.click('#sfCertForm button[type="submit"]'); pg.wait_for_timeout(600)
        check('Senha do certificado incorreta' in pg.locator('#sfCertMsg').inner_text() and ev("modal.classList.contains('open')"), f'{px}senha errada: avisa sem fechar')
        pg.fill('#sfSenha', 's3nh@'); pg.click('#sfCertForm button[type="submit"]'); pg.wait_for_timeout(2500)
        check(S['chamadas'][:3] == ['certificado', 'certificado', 'buscar'], f'{px}certificado aceito e já busca as notas ' + str(S['chamadas']))
        t = pg.locator('main').inner_text()
        check('CNPJ 12.345.678/0001-95' in t and 'Para dar entrada (2)' in t and 'Canceladas (1)' in t, f'{px}lista: 2 para dar entrada e 1 cancelada; CNPJ do certificado no topo')
        check('Pronta para conferir' in t and 'Aguardando o XML' in t and 'Próxima busca às' in t, f'{px}situações: pronta, aguardando o XML (ciência feita) e próxima busca liberada')
        pg.screenshot(path=os.path.join(SAIDA, px + 'sefaz_lista.png'), full_page=True)
        al = ev("alerts().map(a=>a.title)")
        check('1 nota da SEFAZ para dar entrada' in al, f'{px}alerta de nota pronta para dar entrada')
        # Regra de 1 hora: não chama a SEFAZ
        n0 = len(S['chamadas']); ev("ACTIONS['sf-buscar']()"); pg.wait_for_timeout(300)
        check(len(S['chamadas']) == n0 and 'só permite consultar de novo' in ev("toastEl.textContent"), f'{px}antes de 1 hora: não consulta (evita bloqueio do CNPJ)')
        # Conferir e dar entrada
        pg.click(f'[data-act="sf-conferir"][data-id="{CA}"]'); pg.wait_for_timeout(800)
        check(ev("location.hash") == '#/nfe' and ev("nfeLida && nfeLida.origem") == 'sefaz' and 'GLIFOSATO 480 20L' in pg.locator('main').inner_text(), f'{px}“Conferir e dar entrada” abre a conferência do XML')
        if not mob: pg.screenshot(path=os.path.join(SAIDA, px + 'sefaz_conferencia.png'), full_page=True)
        ev("document.querySelectorAll('[data-nfe-item]').forEach(s=>{s.value='__novo'; s.dispatchEvent(new Event('change',{bubbles:true}))})"); pg.wait_for_timeout(300)
        ev("document.querySelectorAll('[data-nfe-qtd]').forEach((i,k)=>{ i.value = k===0 ? '100' : '200'; })")
        pg.click('[data-act="nfe-confirmar"]'); pg.wait_for_timeout(800)
        r = ev(f"(()=>{{ const g=db.expenses.find(e=>e.nfeChave==='{CA}'); return {{g: g&&g.value, movs: db.movements.filter(m=>m.nfeChave==='{CA}').length, contas: db.contas.filter(c=>g&&c.grupo===g.id).length}}; }})()")
        check(r['g'] == 1500 and r['movs'] == 2 and r['contas'] == 1 and (CA, 'importada') in S['marcar'], f'{px}entrada no estoque (2 itens), gasto R$ 1.500, duplicata, e a nota fica “Entrada feita” no servidor')
        ev("go('notassefaz')"); pg.wait_for_timeout(600)
        t = pg.locator('main').inner_text()
        check('Para dar entrada (1)' in t and 'Entrada feita (1)' in t, f'{px}lista atualizada: a nota sai de “Para dar entrada”')
        # Ignorar (ex.: combustível que não entra no estoque)
        pg.click(f'[data-act="sf-ignorar"][data-id="{CB}"]'); pg.wait_for_timeout(400)
        check((CB, 'ignorar') in S['marcar'] and 'Ignoradas (1)' in pg.locator('main').inner_text(), f'{px}Ignorar tira a nota da lista de entrada')
        # Usuário comum: não mexe no certificado
        ev("nv.papel='member'; render()"); pg.wait_for_timeout(300)
        check(pg.locator('main [data-act="sf-cert"]').count() == 0, f'{px}usuário comum não vê o certificado')
        check(not errs, f'{px}sem erros de JS ' + ('' if not errs else str(errs[:3])))
        ctx.close()
    b.close()
print('FIM', 'OK' if ok else 'FALHAS')
