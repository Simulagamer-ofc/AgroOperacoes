'use strict';
/* MercaPlant — alertas no celular.
   O app calcula os avisos com os dados da fazenda e a última previsão do tempo guardada:
   • chuva forte (véspera, 7h) • janela de pulverização de amanhã (18h) • revisão de máquina • estoque baixo/acabando • operações atrasadas
   No app Android, o próprio Android agenda as notificações: elas chegam mesmo com o app fechado.
   No navegador, aparecem como notificação do sistema quando o MercaPlant é aberto (se o navegador permitir). */
const ALERTA_TIPOS = [
  ['chuva', 'Chuva forte prevista', `${20} mm ou mais — aviso na véspera, às 7h`],
  ['pulverizar', 'Pulverização de amanhã', 'boas horas (ou falta delas) — aviso às 18h da véspera'],
  ['revisao', 'Revisão de máquina', 'chegando ou vencida'],
  ['estoque', 'Estoque', 'abaixo do mínimo ou acabando em até 7 dias'],
  ['atrasadas', 'Operações atrasadas', 'programadas para dias que já passaram']
];
const ALERTA_CFG = 'agro-alertas', ALERTA_ENV = 'agro-alertas-enviados', CHUVA_FORTE_MM = 20;
function alertaCfg() {
  let c = null; try { c = JSON.parse(safeStorage.get(ALERTA_CFG) || 'null'); } catch { c = null; }
  return {ativo: false, chuva: true, pulverizar: true, revisao: true, estoque: true, atrasadas: false, ...(c || {})};
}
const salvarAlertaCfg = c => safeStorage.set(ALERTA_CFG, JSON.stringify(c));
const horaDe = (dataIso, h) => new Date(`${dataIso}T${String(h).padStart(2, '0')}:00:00`).getTime();
// Aviso "agora" que cairia de madrugada vai para as 7h
function horaBoa(ms) {
  const dt = new Date(ms), h = dt.getHours();
  if (h >= 7 && h < 21) return ms;
  const dia = new Date(dt); if (h >= 21) dia.setDate(dia.getDate() + 1);
  return horaDe(isoLocal(dia), 7);
}

function calcularAlertas(cfg = alertaCfg(), agora = Date.now()) {
  const lista = [], t = today(), amanha = addDias(t, 1), c = typeof lerClima === 'function' ? lerClima() : null, d = c?.dados?.daily;
  const add = (a, quando) => lista.push({...a, quando: Math.max(agora, quando)});
  if (d && cfg.chuva) d.time.forEach((dia, i) => {
    const mm = d.precipitation_sum[i];
    if (dia < t || dia > addDias(t, 4) || !(mm >= CHUVA_FORTE_MM)) return;
    const quando = dia === t ? horaBoa(agora) : horaDe(addDias(dia, -1), 7);
    const quandoTxt = dia === t ? 'hoje' : `amanhã (${fmtDate(dia).slice(0, 5)})`;
    const fx = typeof horariosChuva === 'function' ? horariosChuva(c.dados, dia, new Date(agora)) : [], horaTxt = fx.length ? (fx[0].agora ? ', já chovendo' : `, a partir das ${String(fx[0].ini).padStart(2, '0')}h`) : '';
    add({id: `chuva-${dia}`, tipo: 'chuva', rota: 'inicio', titulo: `🌧 Chuva de ${num(mm, 0)} mm ${quandoTxt}${horaTxt}`,
      texto: `${fx.length ? 'Horários: ' + txtHorariosChuva(fx) + '. ' : ''}Chance de ${Math.round(d.precipitation_probability_max[i] ?? 0)}%. Programe aplicações, plantio e colheita.${d.confianca?.[i] && !d.confianca[i].firme ? ' Previsão incerta: confira de novo.' : ''}`}, quando);
  });
  if (d && cfg.pulverizar && typeof janelasDoDia === 'function') [amanha, addDias(t, 2), addDias(t, 3)].forEach(dia => {
    if (!d.time.includes(dia)) return;
    const vespera18 = horaDe(addDias(dia, -1), 18);
    if (vespera18 < agora && horaDe(dia, 6) < agora) return;
    const j = janelasDoDia(c.dados, dia), temAplicacao = db.operations.some(o => o.type === 'Aplicação' && o.status === 'Programada' && o.date === dia);
    if (!j.janelas.length && !temAplicacao) return;
    const horas = j.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ');
    add({id: `pulverizar-${dia}`, tipo: 'pulverizar', rota: 'inicio',
      titulo: j.janelas.length ? `💨 Amanhã: boas horas para pulverizar ${horas}` : '⚠ Amanhã sem boa janela para pulverizar',
      texto: j.janelas.length ? `Vento, Delta T, temperatura e umidade dentro do critério.${temAplicacao ? ' Há aplicação programada.' : ''}` : `Principalmente ${j.principal || 'condições fora do critério'}. Há aplicação programada para amanhã: reveja o horário.`}, vespera18);
  });
  if (cfg.revisao) db.machines.filter(m => !isInactive(m) && Number(m.nextService) > 0).forEach(m => {
    const falta = hoursToService(m), pr = typeof previsaoRevisao === 'function' ? previsaoRevisao(m) : null;
    if (!(falta <= SERVICE_WARN_HOURS || pr?.dias <= 7)) return;
    add({id: `revisao-${m.id}-${m.nextService}`, tipo: 'revisao', rota: 'maquinas',
      titulo: falta <= 0 ? `⚙ Revisão vencida: ${m.name}` : `⚙ Revisão em ${num(falta)} h: ${m.name}`,
      texto: `Horímetro em ${num(m.hours)} h; revisão programada para ${num(m.nextService)} h.${pr?.data && falta > 0 ? ` Pelo ritmo de uso, por volta de ${fmtDate(pr.data)}.` : ''}`}, horaBoa(agora));
  });
  if (cfg.estoque) db.stock.forEach(s => {
    const p = typeof previsaoEstoque === 'function' ? previsaoEstoque(s) : null;
    if (stockLow(s)) add({id: `estoque-${s.id}-baixo-${Number(s.qty)}`, tipo: 'estoque', rota: 'estoque', titulo: `📦 Estoque baixo: ${s.name}`,
      texto: `Saldo ${num(s.qty)} ${s.unit} (mínimo ${num(s.min)} ${s.unit}).`}, horaBoa(agora));
    else if (p && p.dias <= 7) add({id: `estoque-${s.id}-acaba-${Number(s.qty)}`, tipo: 'estoque', rota: 'estoque', titulo: `📦 ${s.name} acaba em ~${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`,
      texto: `Pelo consumo das últimas semanas (${num(p.porDia, 1)} ${s.unit}/dia). Compre até ${fmtDate(p.compraAte)}.`}, horaBoa(agora));
  });
  if (cfg.atrasadas) db.operations.filter(o => o.status === 'Programada' && o.date && o.date < t).forEach(o => add({id: `atrasada-${o.id}-${o.date}`, tipo: 'atrasadas', rota: 'operacoes',
    titulo: `◷ Operação atrasada: ${o.type}`, texto: `${opPlace(o)} — programada para ${fmtDate(o.date)}.`}, horaBoa(agora)));
  return lista;
}

function lerEnviados() { try { return JSON.parse(safeStorage.get(ALERTA_ENV) || '{}') || {}; } catch { return {}; } }
const podeNotificarWeb = () => typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator;
// Entrega: no APK agenda tudo no Android (substitui o agendamento anterior); no navegador mostra o que já venceu
function entregarAlertas() {
  const cfg = alertaCfg(), ponte = window.AndroidBridge;
  if (!cfg.ativo) { if (ponte?.agendarAlertas) ponte.agendarAlertas('[]'); return []; }
  const agora = Date.now(), env = lerEnviados();
  Object.keys(env).forEach(k => { if (agora - env[k] > 40 * 864e5) delete env[k]; });
  // Já entregue (horário passou) não repete; agendado para o futuro é reagendado com o texto atualizado
  const lista = calcularAlertas(cfg, agora).filter(a => !(env[a.id] && env[a.id] <= agora));
  if (ponte?.agendarAlertas) {
    ponte.agendarAlertas(JSON.stringify(lista.map(({id, quando, titulo, texto, rota}) => ({id, quando, titulo, texto, rota}))));
    lista.forEach(a => { env[a.id] = a.quando; });
  } else if (podeNotificarWeb()) {
    const agoraLista = lista.filter(a => a.quando <= agora);
    navigator.serviceWorker.ready.then(reg => agoraLista.forEach(a => reg.showNotification(a.titulo, {body: a.texto, tag: a.id, icon: 'icon-192.png', badge: 'icon-192.png', data: {rota: a.rota}}))).catch(() => {});
    agoraLista.forEach(a => { env[a.id] = agora; });
  }
  safeStorage.set(ALERTA_ENV, JSON.stringify(env));
  return lista;
}

// ---------- Ligar/desligar (Cadastros e atalho no "Hoje") ----------
function suporteAlertas() {
  if (window.AndroidBridge?.agendarAlertas) return 'apk';
  if (typeof Notification !== 'undefined' && 'serviceWorker' in navigator) return 'web';
  return '';
}
function cartaoAlertas() {
  const cfg = alertaCfg(), sup = suporteAlertas();
  const nota = sup === 'apk' ? 'No app Android os alertas chegam mesmo com o MercaPlant fechado.'
    : sup === 'web' ? 'No navegador, os alertas aparecem quando você abre o MercaPlant. Para receber com o app fechado, use o app Android.'
    : 'Este navegador não mostra notificações. No iPhone, adicione o MercaPlant à Tela de Início; no Android, use o app.';
  return `<article class="card panel" id="cartaoAlertas"><h3>Alertas no celular</h3><p>Avisos automáticos com base nos seus registros e na previsão do tempo.</p>
    <div class="btn-row">${cfg.ativo ? `${btn('Desligar alertas', 'alertas-desligar', '', 'secondary')}${btn('Enviar um teste', 'alertas-teste', '', 'secondary')}` : sup ? btn('🔔 Ligar alertas', 'alertas-ligar') : ''}</div>
    ${cfg.ativo ? `<div class="alertas-tipos">${ALERTA_TIPOS.map(([k, nome, dica]) => `<label class="alerta-tipo"><input type="checkbox" data-alerta-tipo="${k}" ${cfg[k] ? 'checked' : ''}><span><strong>${esc(nome)}</strong><small>${esc(dica)}</small></span></label>`).join('')}</div>` : ''}
    <small class="nota">${esc(nota)}</small></article>`;
}
const redesenharAlertas = () => { const el = document.getElementById('cartaoAlertas'); if (el) el.outerHTML = cartaoAlertas(); };
function ligarAlertas() {
  const ok = permitido => {
    if (!permitido) { showToast('Notificações bloqueadas. Libere nas configurações do celular (Apps → MercaPlant → Notificações) ou do navegador.', true); return; }
    const cfg = alertaCfg(); cfg.ativo = true; salvarAlertaCfg(cfg);
    const n = entregarAlertas().length; redesenharAlertas(); if (typeof nvAtualizarOuRender === 'function' && parseRoute().name === 'inicio') nvAtualizarOuRender();
    showToast(n ? `Alertas ligados: ${n} ${n === 1 ? 'aviso agendado' : 'avisos agendados'}.` : 'Alertas ligados. Você será avisado quando houver algo.');
  };
  const ponte = window.AndroidBridge;
  if (ponte?.agendarAlertas) {
    if (ponte.notificacoesPermitidas?.()) return ok(true);
    window.onNotificacoesPermitidas = ok; ponte.pedirNotificacoes(); return;
  }
  if (typeof Notification === 'undefined') return showToast('Este navegador não mostra notificações.', true);
  if (Notification.permission === 'granted') return ok(true);
  Promise.resolve(Notification.requestPermission()).then(p => ok(p === 'granted')).catch(() => ok(false));
}
Object.assign(ACTIONS, {
  'alertas-ligar': ligarAlertas,
  'alertas-desligar': () => { const cfg = alertaCfg(); cfg.ativo = false; salvarAlertaCfg(cfg); entregarAlertas(); redesenharAlertas(); showToast('Alertas desligados neste aparelho.'); },
  'alertas-teste': () => {
    const a = {id: `teste-${Date.now()}`, quando: Date.now(), titulo: '🔔 Alertas do MercaPlant ligados', texto: 'É assim que os avisos de chuva, pulverização, revisão e estoque vão chegar.', rota: 'cadastros'};
    if (window.AndroidBridge?.agendarAlertas) { window.AndroidBridge.testarAlerta?.(JSON.stringify(a)); }
    else if (podeNotificarWeb()) navigator.serviceWorker.ready.then(reg => reg.showNotification(a.titulo, {body: a.texto, tag: a.id, icon: 'icon-192.png', data: {rota: a.rota}}));
    showToast('Teste enviado: veja a notificação do celular.');
  }
});
document.addEventListener('change', e => {
  const k = e.target?.dataset?.alertaTipo; if (!k) return;
  const cfg = alertaCfg(); cfg[k] = e.target.checked; salvarAlertaCfg(cfg); entregarAlertas();
});

// Recalcula ao abrir, ao voltar para o app, a cada 15 min e depois de cada previsão nova
if (typeof buscarClima === 'function') {
  const buscarClimaOriginal = buscarClima;
  buscarClima = async (...args) => { await buscarClimaOriginal(...args); try { entregarAlertas(); } catch { /* não atrapalha a previsão */ } };
}
addEventListener('load', () => setTimeout(() => { try { entregarAlertas(); } catch (e) { console.error(e); } }, 4000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { entregarAlertas(); } catch { /* segue */ } });
setInterval(() => { if (document.visibilityState === 'visible') try { entregarAlertas(); } catch { /* segue */ } }, 15 * 60000);
