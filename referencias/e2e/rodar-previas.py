# Início e Operações no padrão das prévias (previas.js), com os dados de exemplo e servidor simulado: operação prioritária,
# abrir a operação, busca, menu ⋮, Editar, seleção com detalhe (computador), Iniciar e filtros, no celular e no computador.
# Uso: (cd app/src/main/assets/www && python3 -m http.server 8772 &) ; python3 referencias/e2e/rodar-previas.py [porta]
import json, sys, time, urllib.parse, os
from playwright.sync_api import sync_playwright
BASE='https://gfvtudfdhooavcchdpnm.supabase.co'
FAZ={'id':'11111111-1111-1111-1111-111111111111','name':'Fazenda Boa Vista','join_code':'AAA'}
porta = sys.argv[1] if len(sys.argv) > 1 else '8772'
def resp(r,b,s=200): r.fulfill(status=s,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body=json.dumps(b))
def api(r):
    u=urllib.parse.urlparse(r.request.url); p=u.path; q=urllib.parse.parse_qs(u.query)
    if r.request.method=='OPTIONS': return resp(r,{})
    if p=='/rest/v1/rpc/meu_acesso': return resp(r,[{'farm_id':FAZ['id'],'fazenda':FAZ['name'],'status':'ativo','role':'admin','funcao':'diretor','modulos':None}])
    if p=='/rest/v1/farm_members' and 'user_id' in q: return resp(r,[{'role':'admin','funcao':'diretor','modulos':None}])
    if p=='/rest/v1/farms': return resp(r,[FAZ])
    if p.startswith('/rest/v1/rpc/'): return resp(r,[] if 'push' in p else None)
    return resp(r,[])
NV={'sessao':{'access_token':'t','refresh_token':'r','expira':int(time.time())+36000,'email':'edson@fazenda.com','usuario':'u1'},'sysadm':False,'fazenda':FAZ,'papel':'admin','cursor':0,'rejeitados':{}}
CLIMA_JS = '''(() => {
  db.settings.local = {lat: -28.26, lon: -52.4, origem: 'teste'};
  db.operations.forEach((o, i) => { if (!o.operator) o.operator = ['João Silva', 'Carlos Mendes', 'Ana Paula'][i % 3]; });
  save();
  const h = {time: [], temperature_2m: [], relative_humidity_2m: [], wind_speed_10m: [], wind_gusts_10m: [], precipitation_probability: [], precipitation: [], cloud_cover: [], trovoada: []}, d = {time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], wind_speed_10m_max: [], sunshine_duration: []};
  const base = new Date(); base.setDate(base.getDate() - 1); base.setHours(12, 0, 0, 0);
  for (let k = 0; k < 8; k++) { const dia = new Date(base); dia.setDate(base.getDate() + k); const iso = isoLocal(dia); d.time.push(iso); d.temperature_2m_max.push(27); d.temperature_2m_min.push(15); d.precipitation_sum.push(k === 4 ? 12 : 0); d.precipitation_probability_max.push(k === 4 ? 80 : 5); d.wind_speed_10m_max.push(12); d.sunshine_duration.push(30000);
    for (let x = 0; x < 24; x++) { h.time.push(iso + 'T' + String(x).padStart(2, '0') + ':00'); const tt = 15 + 11 * Math.max(0, Math.sin((x - 6) / 24 * 2 * Math.PI)); h.temperature_2m.push(tt); h.relative_humidity_2m.push(90 - (tt - 15) * 3.5); h.wind_speed_10m.push(x < 11 || x > 17 ? 6 : 14); h.wind_gusts_10m.push(x < 11 || x > 17 ? 11 : 24); h.precipitation_probability.push(5); h.precipitation.push(0); h.cloud_cover.push(10); h.trovoada.push(0); } }
  safeStorage.set(CLIMA_KEY, JSON.stringify({em: Date.now(), lat: -28.26, lon: -52.4, dados: {hourly: h, daily: d}}));
  render();
})()'''
ok=True
def check(c,m):
    global ok; print(('OK   ' if c else 'FALHA ')+m); ok = ok and c
with sync_playwright() as p:
    b=p.chromium.launch()
    for w in (400,1366):
        ctx=b.new_context(viewport={'width':w,'height':900}); pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)[:200]))
        pg.route(BASE+'/**',api)
        for pat in ('**/api.open-meteo.com/**','**/tile.openstreetmap.org/**','**/redemet**'): pg.route(pat,lambda r:r.abort())
        pg.add_init_script(f"if(!sessionStorage.getItem('ini')){{sessionStorage.setItem('ini','1');localStorage.clear();localStorage.setItem('agro-nuvem',{json.dumps(json.dumps(NV))});localStorage.setItem('agro-theme','light');}}")
        pg.goto(f'http://localhost:{porta}/index.html#/inicio'); pg.wait_for_timeout(6500)
        ev=pg.evaluate; ev("document.querySelectorAll('.modal.open [data-close], .modal.open [data-no]').forEach(b=>b.click())")
        ev("loadSamples()"); ev(CLIMA_JS); pg.wait_for_timeout(500)
        px=f'[{w}] '
        check(pg.locator('.pv-prior .pv-acao').count()==1, px+'Início: botão da operação prioritária')
        pg.locator('.pv-prior [data-act="pv-op-abrir"]').click(); pg.wait_for_timeout(500)
        check('operacoes' in pg.url and pg.locator('.pv-op').count()>=1, px+'tocar na prioritária abre Operações')
        if w>=900: check(pg.locator('.pv-op.sel').count()==1 and pg.locator('.pv-det').is_visible(), px+'operação aberta fica selecionada com detalhe')
        n=pg.locator('.pv-op').count()
        pg.fill('#pvBusca','tratamento'); pg.wait_for_timeout(200)
        vis=pg.evaluate("[...document.querySelectorAll('.pv-op')].filter(e=>!e.hidden).length")
        check(vis==1, px+f'busca filtra ({n} → {vis})')
        pg.fill('#pvBusca',''); pg.wait_for_timeout(100)
        if w<900:
            pg.locator('.pv-op .pv-op-mais summary').first.click(); pg.wait_for_timeout(200)
            check(pg.locator('.pv-op .pv-op-mais[open] [data-act="op-edit"]').is_visible(), px+'menu ⋮ abre com Editar')
            pg.locator('.pv-op .pv-op-mais[open] [data-act="op-edit"]').click(); pg.wait_for_timeout(400)
            check(pg.locator('#modal.open').count()==1, px+'Editar abre o formulário')
            ev("closeModal()")
        else:
            pg.locator('.pv-op').nth(1).locator('.pv-op-info').click(); pg.wait_for_timeout(300)
            check(pg.locator('.pv-op').nth(1).get_attribute('class').find('sel')>=0, px+'clicar na linha seleciona')
        prog=pg.locator('[data-act="op-start"]:visible').first
        if prog.count():
            prog.click(); pg.wait_for_timeout(500)
            check(pg.locator('#modal.open').count()==1 or pg.evaluate("db.operations.filter(o=>o.status==='Em andamento').length")>=2, px+'Iniciar funciona (abre o início ou inicia)')
            ev("closeModal?.()")
        for f in ['abertas','concluidas','proximas','todas']:
            ev(f"ACTIONS['op-filter']('{f}')"); pg.wait_for_timeout(150)
        check(not errs, px+'sem erros na página '+str(errs[:2]))
        ctx.close()
print('TUDO OK' if ok else 'HOUVE FALHAS')

sys.exit(0 if ok else 1)
