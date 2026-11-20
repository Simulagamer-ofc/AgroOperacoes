'use strict';
/* MercaPlant — tela inicial personalizável (1.0).
   Padrão para todos: só o Clima e o Mapa da fazenda. Em “Personalizar a tela inicial” cada pessoa liga/desliga
   os outros cartões e muda a ordem. “Prepare a fazenda” vem ligado (só aparece enquanto falta cadastro). A escolha vale para o usuário (guardada no aparelho e na conta, então
   acompanha a pessoa em qualquer aparelho em que ela entrar). “Voltar ao padrão” deixa só clima e mapa. */
const INI_PADRAO = ['clima', 'mapa', 'prep'];
// [chave, nome, detalhe, novo?]
const INI_CARTOES = [
  ['clima', 'Clima', 'hoje e hora de pulverizar'],
  ['mapa', 'Mapa da fazenda', 'talhões no satélite'],
  ['kpis', 'Resumo do dia', '4 números'],
  ['ops', 'Operações de hoje', ''],
  ['aten', 'Atenção', 'alertas'],
  ['reg', 'Registrar rápido', ''],
  ['prep', 'Prepare a fazenda', 'guia de cadastro; some quando estiver tudo pronto'],
  ['silos', 'Silos', 'temperatura', true],
  ['maq', 'Máquinas', 'próximas revisões', true],
];
const INI_CHAVES = INI_CARTOES.map(c => c[0]);
const iniUsuario = () => (typeof nv !== 'undefined' && nv?.sessao?.usuario) || 'local';
const iniChaveLocal = () => `agro-inicio-cartoes:${iniUsuario()}`;
const iniLimpar = l => Array.isArray(l) ? [...new Set(l.filter(k => INI_CHAVES.includes(k)))] : null;

// Escolha do usuário: {lista, em}. Sem escolha = padrão (clima e mapa).
function iniLer() {
  try { const v = JSON.parse(safeStorage.get(iniChaveLocal()) || 'null'); const l = iniLimpar(v?.lista); if (l) return {lista: l, em: Number(v.em) || 0}; } catch { /* padrão */ }
  return {lista: [...INI_PADRAO], em: 0};
}
function iniGravarLocal(v) { safeStorage.set(iniChaveLocal(), JSON.stringify(v)); }
// Guarda também na conta (dados do usuário no servidor), para valer em outros aparelhos; sem internet fica só aqui
async function iniGravarConta(v) {
  if (typeof nvHttp !== 'function' || !nv?.sessao || navigator.onLine === false) return;
  try { await nvHttp('/auth/v1/user', {method: 'PUT', body: {data: {inicio_cartoes: v}}}); } catch { /* tenta de novo na próxima mudança */ }
}
// Ao abrir o início: se a conta tem uma escolha mais nova (feita em outro aparelho), usa ela
let iniContaLida = '';
async function iniLerConta() {
  if (typeof nvHttp !== 'function' || !nv?.sessao || navigator.onLine === false || iniContaLida === iniUsuario()) return;
  iniContaLida = iniUsuario();
  try {
    const u = await nvHttp('/auth/v1/user'), r = u?.user_metadata?.inicio_cartoes, l = iniLimpar(r?.lista);
    if (!l) return;
    const local = iniLer();
    if ((Number(r.em) || 0) > local.em && l.join() !== local.lista.join()) {
      iniGravarLocal({lista: l, em: Number(r.em) || 0});
      if (parseRoute().name === 'inicio') render();
    }
  } catch { /* sem conta ou sem internet: fica a do aparelho */ }
}
function iniSalvar(lista) {
  const v = {lista: iniLimpar(lista) || [...INI_PADRAO], em: Date.now()};
  iniGravarLocal(v); iniGravarConta(v);
}

// ---------- Cartões novos ----------
function iniCartaoSilos() {
  const silos = typeof equipDoTipo === 'function' ? equipDoTipo('Silo/Armazém') : [];
  const linhas = silos.map(s => {
    const tm = typeof termometriaSilo === 'function' ? termometriaSilo(s.id) : null;
    const quente = tm?.subindo?.length;
    return `<button type="button" class="ini-linha" data-act="nav" data-id="graos/silos"><span class="ini-linha-nome">${esc(s.name)}</span>
      <span class="ini-linha-sub">${tm ? `${tm.max != null ? `máx. ${num(tm.max, 1)} °C` : ''}${tm.media != null ? ` • média ${num(tm.media, 1)} °C` : ''}` : 'sem leitura de temperatura'}</span>
      <span class="ini-selo ${quente ? 'nao' : tm ? 'ok' : ''}">${quente ? 'esquentando' : tm ? 'normal' : '—'}</span></button>`;
  }).join('');
  return `<section class="card i2-card ini-extra"><div class="i2-tit"><h3>${iconeLinha('graos/silos', 18)} Silos</h3><button type="button" class="link" data-act="nav" data-id="graos/silos">Ver silos</button></div>
    ${linhas || '<p class="sub">Nenhum silo cadastrado. Cadastre em Grãos → Silos.</p>'}</section>`;
}
function iniCartaoMaquinas() {
  const ms = db.machines.filter(m => !isInactive(m) && Number(m.nextService) > 0).map(m => ({m, falta: hoursToService(m)})).sort((a, b) => a.falta - b.falta).slice(0, 4);
  const linhas = ms.map(({m, falta}) => {
    const u = typeof unidMed === 'function' ? unidMed(m) : 'h', perto = falta <= (typeof avisoRevisao === 'function' ? avisoRevisao(m) : SERVICE_WARN_HOURS);
    return `<button type="button" class="ini-linha" data-act="nav" data-id="maquinas"><span class="ini-linha-nome">${esc(m.name)}</span>
      <span class="ini-linha-sub">${num(m.hours)} ${u} • revisão em ${num(m.nextService)} ${u}</span>
      <span class="ini-selo ${falta <= 0 ? 'nao' : perto ? 'atencao' : 'ok'}">${falta <= 0 ? 'vencida' : `faltam ${num(falta)} ${u}`}</span></button>`;
  }).join('');
  return `<section class="card i2-card ini-extra"><div class="i2-tit"><h3>${iconeLinha('maquinas', 18)} Próximas revisões</h3><button type="button" class="link" data-act="nav" data-id="maquinas">Ver máquinas</button></div>
    ${linhas || '<p class="sub">Nenhuma máquina com revisão programada.</p>'}</section>`;
}

// ---------- Montagem ----------
function iniCartao(k) {
  const podeOps = typeof iniPode === 'function' ? iniPode('operacoes') : true;
  switch (k) {
    case 'clima': return typeof cartaoClima === 'function' ? cartaoClima() : '';
    case 'mapa': return typeof i2Fazenda === 'function' ? i2Fazenda() : '';
    case 'kpis': return typeof i2Kpis === 'function' ? i2Kpis() : '';
    case 'ops': return podeOps ? i2Operacoes() : `<section class="card i2-card">${iniAtalhosFuncao()}</section>`;
    case 'aten': return typeof i2Atencao === 'function' ? i2Atencao() : '';
    case 'reg': return typeof i2Registrar === 'function' ? i2Registrar() : '';
    case 'silos': return typeof nvPodeRota === 'function' && !nvPodeRota('graos') ? '' : iniCartaoSilos();
    case 'maq': return iniCartaoMaquinas();
    case 'prep': { const p = typeof iniPreparar === 'function' ? iniPreparar() : ''; return p ? `<div class="ini-prep">${p}</div>` : ''; }
    default: return '';
  }
}
const iniDepoisBase = VIEWS.inicio.after; // o que o início já fazia depois de desenhar (mapa, clima, alertas)
VIEWS.inicio = () => {
  const lista = iniLer().lista;
  let corpo = '';
  for (let i = 0; i < lista.length; i++) {
    // Operações e Atenção seguidas ficam lado a lado no computador (como antes)
    if ((lista[i] === 'ops' && lista[i + 1] === 'aten') || (lista[i] === 'aten' && lista[i + 1] === 'ops')) {
      corpo += `<div class="i2-meio">${iniCartao(lista[i])}${iniCartao(lista[i + 1])}</div>`; i++;
    } else corpo += iniCartao(lista[i]);
  }
  return `<div class="i2 i3 ini-perso-tela ${lista.includes('clima') ? 'com-clima' : ''}">
    ${i2Cabecalho()}${corpo}
    <button type="button" class="ini-perso" data-act="ini-perso">${iconeLinha('mais', 18)} Personalizar a tela inicial</button></div>`;
};
VIEWS.inicio.after = (...a) => { iniDepoisBase?.(...a); iniLerConta(); };

// ---------- Personalizar ----------
function iniPersonalizar() {
  const sel = iniLer().lista;
  // Ordem na tela: primeiro os ligados (na ordem escolhida), depois os desligados
  let ordem = [...sel, ...INI_CHAVES.filter(k => !sel.includes(k))];
  const ligados = new Set(sel);
  const desenhar = () => {
    $('#iniPersoLista', dialog).innerHTML = ordem.map((k, i) => {
      const [, nome, det, novo] = INI_CARTOES.find(c => c[0] === k);
      return `<div class="ini-perso-it"><span class="ini-perso-setas"><button type="button" data-mover="${i}:-1" aria-label="Subir ${esc(nome)}" ${i ? '' : 'disabled'}>▲</button><button type="button" data-mover="${i}:1" aria-label="Descer ${esc(nome)}" ${i < ordem.length - 1 ? '' : 'disabled'}>▼</button></span>
        <span class="ini-perso-nome">${esc(nome)}${det ? ` <small>(${esc(det)})</small>` : ''}${novo ? ' <em>novo</em>' : ''}</span>
        <label class="ini-sw"><input type="checkbox" data-k="${k}" ${ligados.has(k) ? 'checked' : ''} aria-label="Mostrar ${esc(nome)}"><i></i></label></div>`;
    }).join('');
    dialog.querySelectorAll('[data-mover]').forEach(b => b.onclick = () => {
      const [i, d] = b.dataset.mover.split(':').map(Number), j = i + d;
      if (j < 0 || j >= ordem.length) return;
      [ordem[i], ordem[j]] = [ordem[j], ordem[i]]; desenhar();
      dialog.querySelector(`[data-mover="${j}:${d}"]`)?.focus();
    });
    dialog.querySelectorAll('input[data-k]').forEach(c => c.onchange = () => { c.checked ? ligados.add(c.dataset.k) : ligados.delete(c.dataset.k); });
  };
  dialog.innerHTML = `<h3>Sua tela inicial</h3><p class="sub">Ligue o que quer ver e use as setas para mudar a ordem. Vale só para você, em qualquer aparelho em que entrar.</p>
    <div class="ini-perso-lista" id="iniPersoLista"></div>
    <div class="actions"><button type="button" class="secondary" id="iniPadrao">Voltar ao padrão</button><button type="button" class="primary" id="iniPronto">Pronto</button></div>`;
  modal.classList.add('open');
  desenhar();
  $('#iniPadrao', dialog).onclick = () => { iniSalvar(INI_PADRAO); closeModal(); showToast('Tela inicial no padrão: clima e mapa'); render(); };
  $('#iniPronto', dialog).onclick = () => {
    const lista = ordem.filter(k => ligados.has(k));
    iniSalvar(lista); closeModal(); showToast(lista.length ? 'Tela inicial salva' : 'Tela inicial salva (vazia: use Personalizar para voltar a ligar os cartões)'); render();
  };
}
ACTIONS['ini-perso'] = iniPersonalizar;
