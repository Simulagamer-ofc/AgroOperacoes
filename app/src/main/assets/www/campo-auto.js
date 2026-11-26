'use strict';
/* MercaPlant — o campo registrado sozinho (e tudo editável).
   1. Chuva automática: choveu no ponto da fazenda, o app grava sozinho em Chuvas (pluviômetro da Sede), marcada
      "⚡ automática". Hoje: soma das horas que já passaram (atualiza ao longo do dia). Dias anteriores (até 7): o total
      do dia pelos dados do tempo (histórico analisado). Só grava a partir de 1 mm.
      • Não soma duas vezes: lançou uma leitura de pluviômetro (da Sede ou de um talhão) no dia, ou na manhã seguinte
        (até 12 h), a automática daquele dia sai.
      • Editar a automática transforma em leitura da pessoa (o app não mexe mais nela). Excluir: não volta.
      • Um registro por dia, com o mesmo código em todos os aparelhos (a sincronização não duplica).
      • Ajustes ficam em Chuvas: ligar/desligar.
   2. Condições do tempo nas operações de campo: ao iniciar e ao concluir qualquer operação no talhão (plantio, colheita,
      adubação, preparo, pulverização…), grava temperatura, umidade, vento, rajada e Delta T daquela hora. Na operação,
      "Tempo no campo" mostra e deixa editar (fica marcado como editado).
   chuvaAutoDias e chaPlano são puras (sem tela), testadas em referencias/tests/campo-auto.test.js. */

const CHA_MIN_MM = 1, CHA_DIAS = 7;
const chaId = d => `chuva-auto-${d}`;
const chaAddDia = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const chaR1 = v => Math.round(v * 10) / 10;

/** Chuva de cada dia: dias anteriores pelo histórico diário (precipitation_sum); hoje pelas horas da previsão até a hora atual.
 *  hist: {dias: {'AAAA-MM-DD': {chuva}}}; hourly: {time: ['AAAA-MM-DDTHH:00'], precipitation: []}; agora: 'AAAA-MM-DDTHH:MM'. */
function chuvaAutoDias({hist, hourly, agora, dias = CHA_DIAS}) {
  const hoje = agora.slice(0, 10), horaAtual = `${hoje}T${agora.slice(11, 13)}:00`, out = [];
  for (let k = dias - 1; k >= 0; k--) {
    const d = chaAddDia(hoje, -k);
    if (d === hoje) {
      // A chuva de cada hora (Open-Meteo) é a do período que termina nela: conta até a hora atual
      let mm = 0, ult = '', n = 0;
      (hourly?.time || []).forEach((t, i) => { if (t.startsWith(d) && t <= horaAtual) { n++; const v = Number(hourly.precipitation?.[i]) || 0; mm += v; if (v > 0) ult = t.slice(11, 16); } });
      if (n) out.push({date: d, mm: chaR1(mm), ate: agora.slice(11, 13) + ':00', ultimaChuva: ult});
      continue;
    }
    const h = hist?.dias?.[d];
    let mm = h?.chuva;
    // Ontem sem histórico ainda: as 24 horas da previsão (ela traz o dia anterior)
    if (mm == null) { const hs = (hourly?.time || []).map((t, i) => t.startsWith(d) ? Number(hourly.precipitation?.[i]) || 0 : null).filter(v => v != null); if (hs.length === 24) mm = hs.reduce((s, v) => s + v, 0); }
    if (mm != null) out.push({date: d, mm: chaR1(Number(mm) || 0), ate: ''});
  }
  return out;
}
/** O que fazer com os registros de chuva: criar/atualizar a automática do dia ou tirar (pluviômetro lançado, chuva revista para menos). */
function chaPlano(dias, chuvas, ignorar = []) {
  const criar = [], tirar = [];
  const leitura = d => chuvas.some(c => c.fonte !== 'automática' && (c.date === d || (c.date === chaAddDia(d, 1) && (c.hora || '07:00') <= '12:00')));
  dias.forEach(x => {
    const atual = chuvas.find(c => c.id === chaId(x.date));
    if (atual && atual.fonte !== 'automática') return; // editada pela pessoa: não mexe
    if (ignorar.includes(x.date) || leitura(x.date) || x.mm < CHA_MIN_MM) { if (atual) tirar.push(atual.id); return; }
    if (atual && Math.abs(Number(atual.mm) - x.mm) < 0.05 && (atual.ate || '') === (x.ate || '')) return;
    criar.push({id: chaId(x.date), date: x.date, hora: x.ate || '', ate: x.ate || '', mm: x.mm, fieldId: '', fonte: 'automática', auto: true,
      notes: `Registrada sozinha pelo MercaPlant (dados do tempo do ponto da fazenda${x.ate ? `, até ${x.ate}` : ', dia todo'}). Edite se o pluviômetro marcou diferente.`, novo: !atual});
  });
  return {criar, tirar};
}

const chaLigada = () => db.settings?.chuvaAuto !== false;
function chaIgnorar(d) { const l = new Set(db.settings.chuvaAutoIgnorar || []); l.add(d); db.settings.chuvaAutoIgnorar = [...l].filter(x => x >= chaAddDia(today(), -40)).sort(); save(); }
let chaUltima = 0;
function chuvaAutomatica() {
  if (!chaLigada() || typeof lerClima !== 'function' || !db?.chuvas) return;
  const c = lerClima(); if (!c?.dados?.hourly?.time) return;
  // Previsão de outro lugar (mudou o ponto da fazenda): espera a nova
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null; if (loc && (Math.abs(c.lat - loc.lat) > 0.02 || Math.abs(c.lon - loc.lon) > 0.02)) return;
  const agora = `${today()}T${nowTime()}`;
  const dias = chuvaAutoDias({hist: typeof tecLerHist === 'function' ? tecLerHist() : null, hourly: c.dados.hourly, agora});
  const {criar, tirar} = chaPlano(dias, db.chuvas, db.settings.chuvaAutoIgnorar || []);
  if (!criar.length && !tirar.length) return;
  tirar.forEach(id => { db.chuvas = db.chuvas.filter(x => x.id !== id); });
  criar.forEach(({novo, ...r}) => { const i = db.chuvas.findIndex(x => x.id === r.id); if (i >= 0) db.chuvas[i] = {...db.chuvas[i], ...r}; else db.chuvas.push(r); });
  save();
  const hojeNovo = criar.filter(r => r.novo && r.date >= chaAddDia(today(), -1)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (hojeNovo && Date.now() - chaUltima > 60000) { chaUltima = Date.now(); showToast(`🌧 Chuva registrada sozinha: ${um1(hojeNovo.mm)} mm ${hojeNovo.date === today() ? 'hoje' : 'ontem'}. Confira em Chuvas.`); }
  if (parseRoute().name === 'chuva' && !document.querySelector('.modal.open')) render();
}
// Roda ao abrir, quando a previsão ou o histórico do tempo atualizam e a cada 20 min
if (typeof buscarClima === 'function') {
  const _buscar = buscarClima;
  // eslint-disable-next-line no-global-assign
  buscarClima = async (...a) => { await _buscar(...a); try { chuvaAutomatica(); } catch (e) { console.warn(e); } };
}
setTimeout(() => { try { chuvaAutomatica(); if (typeof tecHistorico === 'function') tecHistorico().then(() => chuvaAutomatica()).catch(() => {}); } catch (e) { console.warn(e); } }, 4000);
setInterval(() => { try { if (typeof buscarClima === 'function') buscarClima(); chuvaAutomatica(); } catch (e) { console.warn(e); } }, 20 * 60000);

// Chuvas: aviso de que está ligada e o botão para ligar/desligar
if (VIEWS.chuva) {
  const _chuva = VIEWS.chuva;
  VIEWS.chuva = (...a) => {
    const html = _chuva(...a);
    const cx = `<section class="card panel cha-aviso ${chaLigada() ? 'on' : 'off'}"><span class="cha-ic" aria-hidden="true">${chaLigada() ? '⚡' : '⏸'}</span><div><b>Chuva automática ${chaLigada() ? 'ligada' : 'desligada'}</b><small>${chaLigada()
      ? 'Choveu no ponto da fazenda, o app registra sozinho na Sede (a partir de 1 mm), marcado “automática”. Lançou a leitura do pluviômetro no dia, ela vale no lugar. Toque em Editar para corrigir.'
      : 'Ligue para o app registrar sozinho a chuva do ponto da fazenda.'}</small></div><button type="button" class="secondary" data-act="cha-ligar">${chaLigada() ? 'Desligar' : 'Ligar'}</button></section>`;
    const pos = html.indexOf('<section', html.indexOf('class="view-head"'));
    return pos < 0 ? html + cx : html.slice(0, pos) + cx + html.slice(pos);
  };
  VIEWS.chuva.after = _chuva.after;
}
ACTIONS['cha-ligar'] = () => { db.settings.chuvaAuto = !chaLigada(); save(); if (chaLigada()) chuvaAutomatica(); showToast(chaLigada() ? 'Chuva automática ligada' : 'Chuva automática desligada'); render(); };

// ======================= 2. Tempo no campo nas operações =======================
const ctOpDeCampo = o => !!o?.fieldId && (typeof camposDaOp !== 'function' || camposDaOp(o.type).talhao === 'sim');
if (typeof prodAoIniciar === 'function' && typeof prodAoConcluir === 'function' && typeof prodClimaAgora === 'function') {
  const ini = prodAoIniciar, fim = prodAoConcluir;
  // eslint-disable-next-line no-global-assign
  prodAoIniciar = o => { ini(o); if (!o.climaIni && ctOpDeCampo(o)) { const c = prodClimaAgora(); if (c) o.climaIni = c; } };
  // eslint-disable-next-line no-global-assign
  prodAoConcluir = o => { fim(o); if (!o.climaFim && ctOpDeCampo(o)) { const c = prodClimaAgora(); if (c) o.climaFim = c; } };
}
const ctTxt = c => !c ? '' : `${num(c.t, 0)} °C • ${num(c.ur)}% • vento ${num(c.v, 0)}${c.raj != null ? `/${num(c.raj)}` : ''} km/h${c.editado ? ' (editado)' : ''}`;
// Linha da operação: o tempo gravado e "Tempo no campo" no menu ⋮
{
  const _linha = operationRow;
  // eslint-disable-next-line no-global-assign
  operationRow = function (o, actions = true) {
    const html = _linha(o, actions); if (!ctOpDeCampo(o)) return html;
    const c = o.climaIni || o.climaFim;
    let out = c ? html.replace(/<\/small><\/div>/, ` • 🌤 ${esc(ctTxt(c))}</small></div>`) : html;
    if (actions && (c || o.status !== 'Programada')) {
      const b = mini('🌤 Tempo no campo', 'op-tempo-edit', o.id);
      out = out.includes('class="menu-lista"') ? out.replace('<div class="menu-lista">', `<div class="menu-lista">${b}`) : out.replace(/<\/div><\/div>$/, `${b}</div></div>`);
    }
    return out;
  };
}
/** Valores editados → o registro do tempo (Delta T e janela de pulverização refeitos). */
function ctMontar(antes, v, quando) {
  const t = Number(v.t), ur = Number(v.ur), vento = Number(v.v), raj = v.raj === '' || v.raj == null ? null : Number(v.raj);
  const h = {temperature_2m: [t], relative_humidity_2m: [ur], wind_speed_10m: [vento], wind_gusts_10m: [raj ?? vento], precipitation: [0, 0], precipitation_probability: [0]};
  const a = typeof avaliarHora === 'function' ? avaliarHora(h, 0) : {ok: true, motivos: [], dt: null};
  return {...(antes || {}), em: antes?.em || quando, t: chaR1(t), ur: Math.round(ur), v: chaR1(vento), raj: raj == null ? null : Math.round(raj), dt: a.dt != null ? chaR1(a.dt) : null, ok: a.ok, motivos: a.motivos, fonte: 'editado', editado: true};
}
ACTIONS['op-tempo-edit'] = id => {
  const o = find('operations', id); if (!o) return;
  const agora = o.date === today() && typeof prodClimaAgora === 'function' ? prodClimaAgora() : null;
  const ini = o.climaIni || (!o.climaFim ? agora : null), fim = o.climaFim || (o.status === 'Concluída' && !o.climaIni ? agora : null);
  const val = (c, p) => c ? {[p + 't']: c.t, [p + 'ur']: c.ur, [p + 'v']: c.v, [p + 'raj']: c.raj ?? ''} : {};
  const campos = (p, rot) => [{k: p + 't', label: `${rot}: temperatura (°C)`, type: 'number'}, {k: p + 'ur', label: `${rot}: umidade do ar (%)`, type: 'number', min: 0},
    {k: p + 'v', label: `${rot}: vento (km/h)`, type: 'number', min: 0}, {k: p + 'raj', label: `${rot}: rajada (km/h)`, type: 'number', min: 0}];
  const temFim = o.status === 'Concluída' || !!o.climaFim;
  openForm({title: `Tempo no campo — ${o.type}`, sub: `${opPlace(o)} • ${fmtDate(o.date)}. ${o.climaIni || o.climaFim ? 'Gravado sozinho pelo tempo do ponto da fazenda na hora da operação.' : 'Preenchido com o tempo de agora.'} Corrija se no campo estava diferente.`,
    values: {...val(ini, 'i_'), ...val(fim, 'f_')},
    fields: [...campos('i_', 'Início'), ...(temFim ? campos('f_', 'Fim') : [])],
    submit: 'Salvar',
    onSubmit: v => {
      const lido = p => ({t: v[p + 't'], ur: v[p + 'ur'], v: v[p + 'v'], raj: v[p + 'raj']}), vazio = x => x.t === '' && x.ur === '' && x.v === '';
      const falta = x => x.t === '' || x.ur === '' || x.v === '';
      const i = lido('i_'), f = lido('f_');
      if (!vazio(i) && falta(i)) return 'Início: informe temperatura, umidade e vento';
      if (temFim && !vazio(f) && falta(f)) return 'Fim: informe temperatura, umidade e vento';
      if ([i.ur, f.ur].some(x => x !== '' && x != null && Number(x) > 100)) return 'Umidade acima de 100%: confira';
      const quando = new Date(`${o.date}T${o.time || '12:00'}:00`).toISOString(), item = {...o};
      const mudou = (c, x) => !c || Number(c.t) !== Number(x.t) || Number(c.ur) !== Number(x.ur) || Number(c.v) !== Number(x.v) || String(c.raj ?? '') !== String(x.raj ?? '');
      if (!vazio(i)) { if (mudou(o.climaIni, i)) item.climaIni = ctMontar(o.climaIni || ini, i, quando); } else delete item.climaIni;
      if (temFim) { if (!vazio(f)) { if (mudou(o.climaFim, f)) item.climaFim = ctMontar(o.climaFim || fim, f, quando); } else delete item.climaFim; }
      upsert('operations', item); showToast('Tempo no campo salvo');
    }});
};
