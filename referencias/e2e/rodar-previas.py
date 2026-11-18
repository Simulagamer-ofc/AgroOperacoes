# Início e Operações no padrão das prévias (previas.js), com os dados de exemplo e servidor simulado: operação prioritária,
# abrir a operação, busca, menu ⋮, Editar, seleção com detalhe (computador), Iniciar e filtros, no celular e no computador.
# Etapa 3: Máquinas (⋯ Mais do cabeçalho, cartão, Mais informações), ordens com ⋮, Talhões (Ver talhão, ⋮) e abas do talhão.
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
  db.fields.find(f => f.name === 'Talhão 07').contorno = {pontos: [[-28.2600,-52.4000],[-28.2595,-52.3912],[-28.2668,-52.3890],[-28.2690,-52.3975],[-28.2652,-52.4010]], areaHa: 84.5, perimetroM: 3720, data: today()};
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
        check(pg.locator('.i2-pri .pv-acao').count()==1 and pg.locator('.i2-cab').count()==1 and pg.locator('.i2-kpi').count()==4 and pg.locator('.i2-aten').count()==1 and pg.locator('.i2-tile').count()>=4 and pg.locator('.ini-gastos').count()==0, px+'Início: cabeçalho, 4 números, prioritária com botão, Atenção e Registrar rápido (sem gastos)')
        pg.locator('.i2-pri-op').click(); pg.wait_for_timeout(500)
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
        # ---- Etapa 3: Máquinas ----
        ev("go('maquinas')"); pg.wait_for_timeout(500)
        check(pg.locator('.pv-maq').count()==3, px+'Máquinas: 3 cartões no novo padrão')
        pg.locator('.pv-head-mais summary').click(); pg.wait_for_timeout(150)
        check(pg.locator('.pv-head-mais[open] [data-act="hour-new"]').is_visible(), px+'“⋯ Mais” do cabeçalho mostra Registrar horímetro')
        pg.locator('.pv-head-mais[open] [data-act="hour-new"]').click(); pg.wait_for_timeout(400)
        check(pg.locator('#modal.open').count()==1, px+'Registrar horímetro abre o formulário'); ev("closeModal()")
        pg.locator('.pv-maq .pv-maq-det summary').first.click(); pg.wait_for_timeout(150)
        check(pg.locator('.pv-maq .pv-maq-det[open] .meta').first.is_visible(), px+'“Mais informações” abre os detalhes da máquina')
        pg.locator('.pv-maq [data-act="hour-new"]').first.click(); pg.wait_for_timeout(400)
        check(pg.locator('#modal.open').count()==1, px+'Horímetro do cartão abre o formulário'); ev("closeModal()")
        pg.locator('.row .pv-linha-mais summary').first.click(); pg.wait_for_timeout(150)
        check(pg.locator('.row .pv-linha-mais[open] [data-act="mt-edit"]').is_visible(), px+'ordem de manutenção: ⋮ com Editar')
        pg.locator('body').click(position={'x':5,'y':5})
        # ---- Talhões ----
        ev("go('talhoes')"); pg.wait_for_timeout(500)
        check(pg.locator('.pv-talhao').count()==3, px+'Talhões: 3 cartões')
        pg.locator('.pv-talhao .pv-linha-mais summary').first.click(); pg.wait_for_timeout(150)
        check(pg.locator('.pv-talhao .pv-linha-mais[open] [data-act="fd-edit"]').is_visible(), px+'talhão: ⋮ com Editar')
        pg.locator('.pv-talhao .pv-linha-mais[open] [data-act="fd-edit"]').click(); pg.wait_for_timeout(400)
        check(pg.locator('#modal.open').count()==1, px+'Editar talhão abre o formulário'); ev("closeModal()")
        pg.locator('.pv-talhao [data-act="nav"].pv-acao').first.click(); pg.wait_for_timeout(600)
        check('talhao/' in pg.url and pg.locator('.pv-talhao-desenho').count()==1, px+'Ver talhão abre o detalhe com o desenho do contorno')
        check(pg.locator('.pv-aba-painel[data-aba="resumo"]:not([hidden]) .pv-ult').count()==1, px+'aba Resumo com últimas atividades')
        pg.locator('[data-act="pv-aba-talhao"][data-id="operacoes"]').click(); pg.wait_for_timeout(150)
        check(pg.locator('.pv-aba-painel[data-aba="operacoes"]:not([hidden]) .row').count()>=1 and pg.locator('.pv-aba-painel[data-aba="resumo"]').get_attribute('hidden') is not None, px+'aba Operações troca o conteúdo')
        pg.locator('[data-act="pv-aba-talhao"][data-id="avaliacoes"]').click(); pg.wait_for_timeout(150)
        check(pg.locator('.pv-aba-painel[data-aba="avaliacoes"]:not([hidden]) [data-act="lav-estande"]').count()==1, px+'aba Avaliações com + Estande')
        pg.locator('.pv-aba-painel:not([hidden]) [data-act="lav-estande"]').click(); pg.wait_for_timeout(400)
        check(pg.locator('#modal.open').count()==1, px+'+ Estande abre o formulário'); ev("closeModal()")
        pg.locator('[data-act="pv-aba-talhao"][data-id="resumo"]').click(); pg.wait_for_timeout(150)
        pg.locator('.pv-ult [data-act="op-field"]').click(); pg.wait_for_timeout(400)
        check(pg.locator('#modal.open').count()==1, px+'Registrar atividade abre a nova operação'); ev("closeModal()")
        check(not errs, px+'sem erros na página '+str(errs[:2]))
        ctx.close()
print('TUDO OK' if ok else 'HOUVE FALHAS')

sys.exit(0 if ok else 1)
