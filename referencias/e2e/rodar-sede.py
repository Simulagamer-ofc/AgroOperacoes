# Local da fazenda (sede.js), com servidor simulado: computador localizado pela internet (Porto Alegre, ±25 km) é recusado;
# marcar no mapa de satélite e salvar (função fazenda_sede_salvar); colar link do Google Maps; celular com GPS (±12 m); usuário comum.
# Uso: (cd app/src/main/assets/www && python3 -m http.server 8772 &) ; python3 referencias/e2e/rodar-sede.py [porta] [pasta-das-imagens] [pasta-de-tiles]
import json, sys, time, urllib.parse, os
from playwright.sync_api import sync_playwright
TILES = sys.argv[3] if len(sys.argv) > 3 else ''
import json, sys, time, urllib.parse, os
from playwright.sync_api import sync_playwright
BASE='https://gfvtudfdhooavcchdpnm.supabase.co'
FAZ={'id':'11111111-1111-1111-1111-111111111111','name':'Fazenda Boa Vista','join_code':'AAA'}
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
  db.fields[0].contorno = {pontos: [[-28.2600,-52.4000],[-28.2595,-52.3912],[-28.2668,-52.3890],[-28.2690,-52.3975],[-28.2652,-52.4010]], areaHa: 84.5, perimetroM: 3720, data: today()};
  db.operations.forEach((o, i) => { if (!o.operator) o.operator = ['João Silva', 'Carlos Mendes', 'Ana Paula'][i % 3]; });
  save();
  const h = {time: [], temperature_2m: [], relative_humidity_2m: [], wind_speed_10m: [], wind_gusts_10m: [], precipitation_probability: [], precipitation: [], cloud_cover: [], trovoada: []}, d = {time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], wind_speed_10m_max: [], sunshine_duration: []};
  const base = new Date(); base.setDate(base.getDate() - 1); base.setHours(12, 0, 0, 0);
  for (let k = 0; k < 8; k++) { const dia = new Date(base); dia.setDate(base.getDate() + k); const iso = isoLocal(dia); d.time.push(iso); d.temperature_2m_max.push(27); d.temperature_2m_min.push(15); d.precipitation_sum.push(k === 4 ? 12 : 0); d.precipitation_probability_max.push(k === 4 ? 80 : 5); d.wind_speed_10m_max.push(12); d.sunshine_duration.push(30000);
    for (let x = 0; x < 24; x++) { h.time.push(iso + 'T' + String(x).padStart(2, '0') + ':00'); const tt = 15 + 11 * Math.max(0, Math.sin((x - 6) / 24 * 2 * Math.PI)); h.temperature_2m.push(tt); h.relative_humidity_2m.push(90 - (tt - 15) * 3.5); h.wind_speed_10m.push(x < 11 || x > 17 ? 6 : 14); h.wind_gusts_10m.push(x < 11 || x > 17 ? 11 : 24); h.precipitation_probability.push(5); h.precipitation.push(0); h.cloud_cover.push(10); h.trovoada.push(0); } }
  safeStorage.set(CLIMA_KEY, JSON.stringify({em: Date.now(), lat: -28.26, lon: -52.4, dados: {hourly: h, daily: d}}));
  render();
})()'''
porta = sys.argv[1] if len(sys.argv) > 1 else "8772"; saida = sys.argv[2] if len(sys.argv) > 2 else "."; os.makedirs(saida, exist_ok=True)
CONT = [[-28.28896, -52.40942], [-28.2901, -52.39526], [-28.30332, -52.39397], [-28.3037, -52.40899]]
S = {'sede': None, 'rpc': [], 'papel': 'admin'}
def api3(route):
    u = urllib.parse.urlparse(route.request.url); p = u.path; q = urllib.parse.parse_qs(u.query)
    if p == '/rest/v1/rpc/fazenda_sede_salvar':
        c = json.loads(route.request.post_data); S['rpc'].append(c)
        if S['papel'] != 'admin': return resp(route, {'message': 'Só o ADM ou o supervisor da fazenda pode marcar o local da sede.'}, 403)
        S['sede'] = {'sede_lat': round(c['p_lat'], 6), 'sede_lon': round(c['p_lon'], 6), 'sede_origem': c['p_origem'], 'sede_precisao_m': c['p_precisao'], 'sede_em': '2026-11-17T23:50:00Z'}
        return resp(route, S['sede'])
    if p == '/rest/v1/farms' and 'sede_lat' in q.get('select', [''])[0]:
        return resp(route, [S['sede'] or {'sede_lat': None, 'sede_lon': None, 'sede_origem': None, 'sede_precisao_m': None, 'sede_em': None}])
    if p == '/rest/v1/rpc/meu_acesso': return resp(route, [{'farm_id': FAZ['id'], 'fazenda': FAZ['name'], 'status': 'ativo', 'role': S['papel'], 'funcao': 'diretor', 'modulos': None}])
    if p == '/rest/v1/farm_members' and 'user_id' in q: return resp(route, [{'role': S['papel'], 'funcao': 'diretor', 'modulos': None}])
    return api(route)
def tile(route):
    u = urllib.parse.urlparse(route.request.url).path.split('/'); z, y, x = u[-3], u[-2], u[-1]; rot = 'Reference' in route.request.url
    f = os.path.join(TILES, 'rot' if rot else 'sat', z, y, x + ('.png' if rot else '.jpg'))
    if os.path.exists(f): return route.fulfill(status=200, content_type='image/png' if rot else 'image/jpeg', body=open(f, 'rb').read())
    return route.fulfill(status=404, body='')
ok = True
def check(c, m):
    global ok; print(('OK   ' if c else 'FALHA ') + m); ok = ok and c
def abrir(b, w, h, geo, papel='admin', dpr=1, tema='light'):
    S['papel'] = papel
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, geolocation=geo, permissions=['geolocation'])
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.route(BASE + '/**', api3); pg.route('**/server.arcgisonline.com/**', tile)
    for pat in ('**/tile.openstreetmap.org/**', '**/api.open-meteo.com/**'): pg.route(pat, lambda r: r.abort())
    nv = dict(NV, papel=papel)
    pg.add_init_script(f"if(!sessionStorage.getItem('ini')){{sessionStorage.setItem('ini','1');localStorage.clear();localStorage.setItem('agro-nuvem',{json.dumps(json.dumps(nv))});localStorage.setItem('agro-theme','{tema}');}}")
    pg.goto(f'http://localhost:{porta}/index.html#/inicio'); pg.wait_for_timeout(6000)
    pg.evaluate("document.querySelectorAll('.modal.open [data-close], .modal.open [data-no]').forEach(b=>b.click())")
    pg.evaluate(f"db.settings.farm='Fazenda Boa Vista';loadSamples();db.fields[0].contorno={{pontos:{json.dumps(CONT)},areaHa:84.5,perimetroM:3720,data:today()}};save();document.querySelectorAll('.toast').forEach(t=>t.remove())")
    return ctx, pg, errs
foto = lambda pg, n, full=False: (full and pg.add_style_tag(content='.mobile-nav,#fabBtn{display:none!important}'), pg.screenshot(path=os.path.join(saida, n + '.png'), full_page=full))
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) Computador: localização pela internet (Porto Alegre, ±25 km) é recusada
    ctx, pg, errs = abrir(b, 1366, 900, {'latitude': -30.03, 'longitude': -51.23, 'accuracy': 25000})
    pg.evaluate("db.fields[0].contorno=null;delete db.settings.local;save();go('clima')"); pg.wait_for_timeout(1200)
    check(pg.locator('[data-act="clima-local"]').count() >= 1 and pg.locator('#climaLocalControle [data-id="sede"]').count() >= 1, 'sem local: “Ativar localização” e “Marcar no mapa”')
    pg.locator('[data-act="clima-local"]').first.click(); pg.wait_for_timeout(1500)
    t = pg.locator('#climaLocalControle').inner_text()
    check('precisão de 25 km' in t and not S['rpc'], 'computador: posição de ±25 km recusada, nada salvo — ' + t.split('\n')[-1][:90])
    foto(pg, 'pc_1_recusada')
    # 2) Marcar no mapa e salvar
    pg.evaluate(f"db.fields[0].contorno={{pontos:{json.dumps(CONT)},areaHa:84.5,perimetroM:3720,data:today()}};save()")
    pg.locator('#climaLocalControle [data-id="sede"]').first.click(); pg.wait_for_timeout(3500)
    check(pg.locator('#sedeMapa.leaflet-container').count() == 1, 'tela Local da fazenda: mapa de satélite aberto')
    foto(pg, 'pc_2_sede_vazia')
    box = pg.locator('#sedeMapa').bounding_box(); pg.mouse.click(box['x'] + box['width'] * 0.62, box['y'] + box['height'] * 0.55); pg.wait_for_timeout(500)
    check(pg.locator('#sedeMapa .mt-faz').count() == 1 and not pg.locator('[data-act="sede-salvar"]').is_disabled(), 'tocar no mapa põe o pino e libera “Salvar”')
    foto(pg, 'pc_3_sede_marcada')
    pg.locator('[data-act="sede-salvar"]').click(); pg.wait_for_timeout(1500)
    check(len(S['rpc']) == 1 and S['rpc'][0]['p_origem'] == 'mapa' and 'clima' in pg.url, f"salvar chama o servidor (origem mapa) e volta ao MercaClima — {S['rpc'][-1] if S['rpc'] else ''}")
    check('sede marcada no mapa' in pg.locator('main').inner_text(), 'MercaClima mostra “sede marcada no mapa”')
    foto(pg, 'pc_4_clima_depois')
    # colar coordenadas
    pg.evaluate("go('sede')"); pg.wait_for_timeout(2500)
    pg.fill('#sedeCoord', 'https://www.google.com/maps/@-28.29199,-52.3974,17z'); pg.locator('[data-sede-coord] button').click(); pg.wait_for_timeout(600)
    check('-28,29199' in pg.locator('#sedeEscolha').inner_text().replace('.', ','), 'colar link do Google Maps posiciona o pino: ' + pg.locator('#sedeEscolha').inner_text())
    check(not errs, 'computador sem erros ' + str(errs[:2])); ctx.close()
    # 3) Celular com GPS bom (±12 m)
    S['sede'] = None; S['rpc'] = []
    ctx, pg, errs = abrir(b, 390, 844, {'latitude': -28.29199, 'longitude': -52.3974, 'accuracy': 12}, dpr=2, tema='dark')
    pg.evaluate("go('sede')"); pg.wait_for_timeout(3000)
    pg.locator('[data-act="sede-gps"]').click(); pg.wait_for_timeout(2500)
    check('GPS' in pg.locator('#sedeEscolha').inner_text() and '12 m' in pg.locator('#sedeEscolha').inner_text(), 'celular: GPS (±12 m) põe o pino: ' + pg.locator('#sedeEscolha').inner_text())
    foto(pg, 'm_1_sede_gps', True)
    pg.locator('[data-act="sede-salvar"]').click(); pg.wait_for_timeout(1500)
    check(len(S['rpc']) == 1 and S['rpc'][0]['p_origem'] == 'gps' and S['rpc'][0]['p_precisao'] == 12, 'celular salva com origem GPS e precisão 12 m')
    foto(pg, 'm_2_clima_depois')
    check(not errs, 'celular sem erros ' + str(errs[:2])); ctx.close()
    # 4) Usuário comum: vê o local, não muda
    ctx, pg, errs = abrir(b, 390, 844, {'latitude': -28.29, 'longitude': -52.39, 'accuracy': 10}, papel='member', dpr=2)
    pg.evaluate("nv.sede={farm:nv.fazenda.id,lat:-28.29199,lon:-52.3974,origem:'gps',precisao:12,em:'2026-11-17T23:50:00Z'};nvSalvar();go('sede')"); pg.wait_for_timeout(1500)
    t = pg.locator('main').inner_text()
    check('marcado pelo ADM ou pelo supervisor' in t and pg.locator('#sedeMapa').count() == 0, 'usuário comum: vê o local e o aviso, sem o mapa de marcar')
    foto(pg, 'm_3_comum')
    check(not errs, 'comum sem erros ' + str(errs[:2])); ctx.close()
print('TUDO OK' if ok else 'HOUVE FALHAS')

sys.exit(0 if ok else 1)
