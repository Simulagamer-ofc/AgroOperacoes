# Bateria da sincronização com a nuvem (servidor simulado): Admin do sistema, troca de fazenda sem internet,
# cofre por fazenda (cada dado sobe para a sua fazenda), aparelho de versão anterior e "Enviar e juntar".
# Uso: (cd app/src/main/assets/www && python3 -m http.server 8772 &) ; python3 referencias/e2e/rodar-sincronizacao.py
import json, urllib.parse, time
from playwright.sync_api import sync_playwright
BASE='https://gfvtudfdhooavcchdpnm.supabase.co'
F1={'id':'11111111-1111-1111-1111-111111111111','name':'Fazenda Zamadei','join_code':'AAA'}
F2={'id':'22222222-2222-2222-2222-222222222222','name':'Fazenda Dois','join_code':'BBB'}
S={'seq':0,'rec':{},'push':[]}  # rec[(farm,store,id)]={data,deleted,seq}
def corpo(route):
    try: return json.loads(route.request.post_data or 'null')
    except: return None
def resp(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}, body=json.dumps(body))
def api(route):
    req=route.request; u=urllib.parse.urlparse(req.url); q=urllib.parse.parse_qs(u.query); p=u.path
    if S.get('off'): return route.abort('internetdisconnected')
    if req.method=='OPTIONS': return resp(route, {})
    if p.startswith('/auth/v1/token'): return resp(route, {'access_token':'t','refresh_token':'r','expires_in':36000,'user':{'id':'u1','email':'edsonhsr@hotmail.com','app_metadata':{}}})
    if p=='/rest/v1/system_admins': return resp(route, [{'user_id':'u1'}])
    if p=='/rest/v1/farms':
        fs=[F1,F2]
        if 'id' in q: fs=[f for f in fs if 'eq.'+f['id']==q['id'][0]]
        return resp(route, fs)
    if p=='/rest/v1/farm_members':
        if 'status' in q: return resp(route, [])
        if 'user_id' in q and 'farm_id' in q: return resp(route, [{'role':'admin','funcao':'diretor','modulos':None}])
        return resp(route, [{'user_id':'u1','nome':'Edson','login':'edsonhsr@hotmail.com','farm_id':F1['id']}])
    if p=='/rest/v1/rpc/push_records':
        b=corpo(route); S['push'].append((b['p_farm'], len(b['p_rows'])))
        for r in b['p_rows']:
            S['seq']+=1; S['rec'][(b['p_farm'],r['store'],r['id'])]={'data':r.get('data',{}),'deleted':r.get('deleted',False),'seq':S['seq']}
        return resp(route, [])
    if p=='/rest/v1/records' and req.method=='GET':
        farm=q['farm_id'][0][3:]; gt=int(q['seq'][0][3:]); lim=int(q.get('limit',['500'])[0])
        rows=sorted([{'store':k[1],'id':k[2],'data':v['data'],'deleted':v['deleted'],'seq':v['seq']} for k,v in S['rec'].items() if k[0]==farm and v['seq']>gt], key=lambda x:x['seq'])[:lim]
        return resp(route, rows)
    if p.startswith('/rest/v1/rpc/'): return resp(route, [] if 'meu_acesso' in p else None, 200)
    if p.startswith('/functions/v1/'): return resp(route, {})
    return resp(route, [])
def nomes(farm): return sorted(v['data'].get('name') for k,v in S['rec'].items() if k[0]==farm and k[1]=='fields' and not v['deleted'])
NV_ADMIN={'sessao':{'access_token':'t','refresh_token':'r','expira':int(time.time())+36000,'email':'edsonhsr@hotmail.com','usuario':'u1'},'sysadm':True,'fazenda':None,'cursor':0,'rejeitados':{}}
def abrir(b, nv_estado, extra_db=None):
    ctx=b.new_context(viewport={'width':1300,'height':900}); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
    pg.route(BASE+'/**', api); pg.route('**/api.open-meteo.com/**', lambda r:r.abort()); pg.route('**/tile.openstreetmap.org/**', lambda r:r.abort())
    pg.add_init_script(f"if(!sessionStorage.getItem('ini')){{sessionStorage.setItem('ini','1'); localStorage.setItem('agro-nuvem', {json.dumps(json.dumps(nv_estado))}); {('localStorage.setItem(\"agro-db-v1\", '+json.dumps(json.dumps(extra_db))+');') if extra_db else ''}}}")
    pg.goto('http://localhost:8772/index.html'); pg.wait_for_timeout(4000)
    return ctx, pg, errs
def confirmar(pg): pg.wait_for_timeout(300); pg.locator('.modal.open [data-yes]').click(); pg.wait_for_timeout(500)
def entrar(pg, f):
    pg.evaluate("async()=>{ await nvCarregarFazendas(); }"); pg.evaluate(f"ACTIONS['nv-usar']('{f['id']}')"); pg.wait_for_timeout(1500)
    if pg.locator('.modal.open [data-yes]').count(): confirmar(pg); pg.wait_for_timeout(1500)
def talhao(pg, nome): pg.evaluate(f"()=>{{ upsert('fields', {{id: uid(), name: '{nome}', area: 10}}); }}"); pg.wait_for_timeout(200)
def sync(pg): pg.evaluate("()=>nvSincronizar(true)"); pg.wait_for_timeout(1500)
with sync_playwright() as p:
    b=p.chromium.launch(); ok=True
    def check(cond, msg):
        global ok
        print(('OK   ' if cond else 'FALHA ')+msg); ok = ok and cond
    # Aparelho A: admin do sistema sem fazenda
    ctxA,A,eA=abrir(b, NV_ADMIN)
    check(A.locator('.nv-semfazenda').count()==1, 'Admin sem fazenda: aviso "Nenhuma fazenda aberta" aparece')
    entrar(A, F1); check(A.evaluate('nvVinculado() && nv.fazenda.name')=='Fazenda Zamadei', 'Entrou na Zamadei como admin do sistema ('+A.evaluate('nvQuemTexto()')+')')
    check(A.locator('.nv-semfazenda').count()==0, 'Com fazenda aberta: sem o aviso')
    talhao(A,'A1'); sync(A); check(nomes(F1['id'])==['A1'], 'Online: cadastro na Zamadei subiu para a Zamadei '+str(nomes(F1['id'])))
    # sem internet: lança na Zamadei, troca para Fazenda Dois, lança, volta
    S['off']=True; ctxA.set_offline(True); A.evaluate("()=>window.dispatchEvent(new Event('offline'))")
    talhao(A,'A2')
    A.evaluate("ACTIONS['nv-trocar']()"); confirmar(A)
    check(A.evaluate('nv.dadosDe') is None and A.evaluate('db.fields.length')==0, 'Trocar sem internet: Zamadei guardada no cofre, aparelho sem fazenda')
    A.evaluate("()=>{ nvFazendas=[%s,%s]; ACTIONS['nv-usar']('%s'); }" % (json.dumps(F1),json.dumps(F2),F2['id'])); A.wait_for_timeout(800)
    check(A.evaluate('nv.fazenda && nv.fazenda.name')=='Fazenda Dois', 'Entrou na Fazenda Dois sem internet')
    talhao(A,'B1')
    A.evaluate("ACTIONS['nv-trocar']()"); confirmar(A)
    A.evaluate("()=>{ nvFazendas=[%s,%s]; ACTIONS['nv-usar']('%s'); }" % (json.dumps(F1),json.dumps(F2),F1['id'])); A.wait_for_timeout(800)
    check(sorted(A.evaluate("db.fields.map(f=>f.name)"))==['A1','A2'], 'Voltou à Zamadei sem internet: dados dela de volta (A1, A2) '+str(A.evaluate("db.fields.map(f=>f.name)")))
    print('pushes até aqui:', S['push']); check(A.evaluate('nvFaltamEnviar()')>=2, f"Pendências: {A.evaluate('nvFaltamEnviar()')} (A2 da Zamadei + B1 da Fazenda Dois)")
    # volta a internet
    S['off']=False; ctxA.set_offline(False); A.evaluate("()=>window.dispatchEvent(new Event('online'))"); sync(A); A.wait_for_timeout(1000)
    check(nomes(F1['id'])==['A1','A2'], 'Com internet: Zamadei recebeu A1, A2 '+str(nomes(F1['id'])))
    check(nomes(F2['id'])==['B1'], 'Com internet: Fazenda Dois recebeu B1 (cada um na sua fazenda) '+str(nomes(F2['id'])))
    check(A.evaluate('nvFaltamEnviar()')==0, 'Nada pendente depois de sincronizar')
    # Aparelho B (tablet): entra e vê os dados
    ctxB,B,eB=abrir(b, NV_ADMIN)
    entrar(B, F1); B.wait_for_timeout(1000)
    check(sorted(B.evaluate("db.fields.map(f=>f.name)"))==['A1','A2'], 'Tablet na Zamadei: vê A1, A2 '+str(B.evaluate("db.fields.map(f=>f.name)")))
    B.evaluate("ACTIONS['nv-sys-fechar']()"); confirmar(B); entrar(B, F2); B.wait_for_timeout(1000)
    check(B.evaluate("db.fields.map(f=>f.name)")==['B1'], 'Tablet na Fazenda Dois: vê só B1 '+str(B.evaluate("db.fields.map(f=>f.name)")))
    # Aparelho C: versão antiga — admin sem fazenda com dados da Zamadei não enviados
    estC=dict(NV_ADMIN); estC['dadosDe']=F1['id']; estC['dadosNome']=F1['name']
    dbC={'version':1,'settings':{'farm':'Fazenda Zamadei'},'fields':[{'id':'cc1','name':'C1 (celular)','area':5,'_mod':int(time.time()*1000)}]}
    ctxC,C,eC=abrir(b, estC, dbC); C.wait_for_timeout(2500)
    check(C.evaluate('nv.dadosDe') is None, 'Celular antigo em modo admin: dados da Zamadei foram para o cofre dela')
    check('C1 (celular)' in nomes(F1['id']), 'Celular antigo: cadastro pendente subiu sozinho para a Zamadei '+str(nomes(F1['id'])))
    # Aparelho D: lançou sem fazenda e depois entra numa fazenda
    ctxD,D,eD=abrir(b, NV_ADMIN); talhao(D,'D1 sem fazenda'); entrar(D, F2); D.wait_for_timeout(1500)
    check(sorted(nomes(F2['id']))==['B1','D1 sem fazenda'], 'Lançado sem fazenda + "Enviar e juntar": foi para a fazenda escolhida '+str(nomes(F2['id'])))
    # Exclusão e alteração em fazenda fechada + receber o que mudou enquanto estava em outra fazenda
    entrar(A, F1); A.wait_for_timeout(1000)
    S['off']=True
    A.evaluate("()=>{ const f=db.fields.find(x=>x.name==='A2'); remove('fields', f.id); }"); A.wait_for_timeout(200)
    A.evaluate("ACTIONS['nv-trocar']()"); confirmar(A)
    A.evaluate("()=>{ nvFazendas=[%s,%s]; ACTIONS['nv-usar']('%s'); }" % (json.dumps(F1),json.dumps(F2),F2['id'])); A.wait_for_timeout(500)
    S['off']=False
    # enquanto isso o tablet (na Fazenda Dois) ... e alguém muda A1 na Zamadei direto no servidor
    k=(F1['id'],'fields',[kk[2] for kk,v in S['rec'].items() if kk[0]==F1['id'] and v['data'].get('name')=='A1'][0]); S['seq']+=1; d=dict(S['rec'][k]['data']); d['name']='A1 editado'; d['_mod']=int(time.time()*1000)+5000; S['rec'][k]={'data':d,'deleted':False,'seq':S['seq']}
    sync(A); A.wait_for_timeout(1000)
    check(nomes(F1['id'])==['A1 editado','C1 (celular)'] , 'Exclusão feita na Zamadei sem internet chegou à Zamadei depois (A2 saiu) '+str(nomes(F1['id'])))
    A.evaluate("ACTIONS['nv-trocar']()"); confirmar(A)
    A.evaluate("()=>{ nvFazendas=[%s,%s]; ACTIONS['nv-usar']('%s'); }" % (json.dumps(F1),json.dumps(F2),F1['id'])); A.wait_for_timeout(2000)
    check(sorted(A.evaluate("db.fields.map(f=>f.name)"))==['A1 editado','C1 (celular)'], 'Ao voltar à Zamadei: recebeu o que mudou enquanto estava fora '+str(A.evaluate("db.fields.map(f=>f.name)")))
    print('pushes:', S['push']); print('erros JS:', eA+eB+eC+eD)
    print('RESULTADO:', 'TUDO OK' if ok else 'HÁ FALHAS')
    import sys; sys.exit(0 if ok else 1)
