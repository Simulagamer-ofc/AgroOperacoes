'use strict';
/* Notas da SEFAZ (0.88).
   O servidor baixa da SEFAZ as NF-e emitidas contra o CNPJ/CPF do certificado A1 da fazenda (Distribuição de DF-e),
   faz a Ciência da Operação nas que chegam só em resumo (libera o XML completo) e guarda tudo na tabela nfe_recebidas.
   Aqui o app lista as notas e abre a mesma conferência do XML para dar entrada no estoque.
   O certificado e a senha vão direto para o servidor (Vault) e nunca ficam no aparelho nem voltam para o app. */

const SF_UFS = [['12', 'AC'], ['27', 'AL'], ['16', 'AP'], ['13', 'AM'], ['29', 'BA'], ['23', 'CE'], ['53', 'DF'], ['32', 'ES'], ['52', 'GO'], ['21', 'MA'], ['51', 'MT'], ['50', 'MS'], ['31', 'MG'],
  ['15', 'PA'], ['25', 'PB'], ['41', 'PR'], ['26', 'PE'], ['22', 'PI'], ['33', 'RJ'], ['24', 'RN'], ['43', 'RS'], ['11', 'RO'], ['14', 'RR'], ['42', 'SC'], ['35', 'SP'], ['28', 'SE'], ['17', 'TO']];
const SF_FILTROS = [['pendentes', 'Para dar entrada'], ['importadas', 'Entrada feita'], ['ignoradas', 'Ignoradas'], ['canceladas', 'Canceladas']];
let sfEst = {lista: null, cfg: undefined, em: 0, erro: '', filtro: 'pendentes', carregando: false, buscando: false, autoEm: 0};

const sfPode = () => typeof nvVinculado === 'function' && nvVinculado() && !!nv.sessao;
const sfAdm = () => typeof nvPapel === 'function' && nvPapel() === 'admin';
const sfDoc = d => { const s = String(d || ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : s; };
const sfHora = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const sfDia = iso => iso ? isoDate(new Date(iso)) : '';
const sfJaImportada = chave => db.expenses.some(g => g.nfeChave === chave);
const sfSituacao = n => n.situacao === 'cancelada' ? 'canceladas' : (n.importada_em || sfJaImportada(n.chave)) ? 'importadas' : n.ignorada ? 'ignoradas' : 'pendentes';
const sfProntas = () => (sfEst.lista || []).filter(n => sfSituacao(n) === 'pendentes' && n.situacao === 'completa');

async function sfChamar(acao, extra = {}) {
  return nvHttp('/functions/v1/sefaz', {method: 'POST', body: {acao, farm_id: nv.fazenda.id, ...extra}});
}
async function sfCarregar() {
  if (!sfPode() || sfEst.carregando) return;
  sfEst.carregando = true;
  try {
    const f = encodeURIComponent(nv.fazenda.id);
    const [cfg, lista] = await Promise.all([
      nvHttp(`/rest/v1/sefaz_config?farm_id=eq.${f}&select=doc,tipo_doc,nome,validade,uf,ambiente,prox_consulta,ult_consulta,ult_cstat,ult_motivo`),
      nvHttp(`/rest/v1/nfe_recebidas?farm_id=eq.${f}&select=chave,situacao,numero,emitente,cnpj_emit,valor,emissao,ciencia_em,ciencia_cstat,ciencia_motivo,importada_em,importada_por,ignorada&order=emissao.desc.nullslast&limit=500`)]);
    sfEst.cfg = Array.isArray(cfg) ? cfg[0] || null : null;
    sfEst.lista = Array.isArray(lista) ? lista : [];
    sfEst.erro = ''; sfEst.em = Date.now();
    // Nota que já entrou pelo XML (ou em outro aparelho) fica como "entrada feita" também no servidor
    for (const n of sfEst.lista) if (!n.importada_em && sfJaImportada(n.chave)) { n.importada_em = new Date().toISOString(); sfMarcar(n.chave, 'importada', true); }
  } catch (e) { sfEst.erro = e?.message || 'Não foi possível carregar as notas'; }
  finally { sfEst.carregando = false; }
}
function sfMarcar(chave, acao, silencioso) {
  if (!sfPode()) return;
  nvHttp('/rest/v1/rpc/nfe_recebida_marcar', {method: 'POST', body: {p_farm: nv.fazenda.id, p_chave: chave, p_acao: acao}})
    .catch(e => { if (!silencioso) showToast(e?.message || 'Não foi possível atualizar a nota', true); });
  const n = (sfEst.lista || []).find(x => x.chave === chave);
  if (n) { if (acao === 'importada') { n.importada_em = n.importada_em || new Date().toISOString(); n.ignorada = false; } if (acao === 'ignorar') n.ignorada = true; if (acao === 'desfazer') n.ignorada = false; }
}

async function sfBuscar(auto) {
  if (sfEst.buscando || !sfPode()) return;
  sfEst.buscando = true; if (!auto) render();
  try {
    const r = await sfChamar('buscar');
    if (r.config) sfEst.cfg = r.config;
    const partes = [];
    if (r.novas) partes.push(`${r.novas} ${r.novas === 1 ? 'nota nova' : 'notas novas'}`);
    if (r.completas) partes.push(`${r.completas} ${r.completas === 1 ? 'pronta' : 'prontas'} para conferir`);
    if (r.canceladas) partes.push(`${r.canceladas} cancelada${r.canceladas === 1 ? '' : 's'} pelo fornecedor`);
    if (r.motivo) showToast(r.motivo, true);
    else if (partes.length) showToast(partes.join(' • '));
    else if (!auto) showToast(r.aguardar ? `Nada novo na SEFAZ. Próxima consulta liberada às ${sfHora(r.aguardar)}.` : 'Nada novo na SEFAZ.');
    if (r.cienciaFalhas?.length && !auto) showToast('Ciência não registrada em algumas notas: ' + r.cienciaFalhas.slice(0, 2).join('; '), true);
  } catch (e) { if (!auto || e?.status !== 400) showToast(e?.message || 'Não foi possível consultar a SEFAZ', true); }
  finally { sfEst.buscando = false; await sfCarregar(); render(); }
}

// ---------- Tela ----------
VIEWS.notassefaz = () => {
  const voltar = btn('← Estoque', 'nav', 'estoque', 'secondary');
  if (!sfPode()) return head('Notas da SEFAZ', 'Notas fiscais de compra emitidas contra o CNPJ da fazenda', voltar) +
    `<section class="card">${empty('Precisa da conta da fazenda', 'As notas são baixadas da SEFAZ pelo servidor. Entre na conta da fazenda (menu → Nuvem) para usar.')}</section>`;
  if (sfEst.lista === null || Date.now() - sfEst.em > 120000) {
    if (!sfEst.carregando) sfCarregar().then(() => { if (location.hash.startsWith('#/notassefaz')) { render(); sfAutoBuscar(); } });
    if (sfEst.lista === null) return head('Notas da SEFAZ', 'Carregando…', voltar) + `<section class="card"><p class="sub" role="status">Carregando as notas…</p></section>`;
  }
  const c = sfEst.cfg, adm = sfAdm();
  if (!c) return head('Notas da SEFAZ', 'Notas fiscais de compra emitidas contra o CNPJ da fazenda', voltar) +
    `<section class="card sf-intro"><h3>Como funciona</h3><ol><li>O ADM cadastra uma vez o <strong>certificado digital A1</strong> da empresa ou do produtor (arquivo .pfx e senha).</li>
      <li>O sistema busca na SEFAZ as notas emitidas contra o CNPJ/CPF e confirma o recebimento (ciência), que libera o XML completo.</li>
      <li>Aqui aparecem as notas: toque em <strong>Conferir e dar entrada</strong> e confira os itens, como no XML.</li></ol>
      ${adm ? `<div class="actions">${btn('⚙ Cadastrar certificado', 'sf-cert', '', 'primary')}</div>` : '<p class="sub">Peça ao ADM da fazenda para cadastrar o certificado A1.</p>'}</section>`;
  const espera = c.prox_consulta && new Date(c.prox_consulta) > new Date();
  const venceEm = c.validade ? Math.round((new Date(c.validade) - new Date()) / 864e5) : null;
  const lista = sfEst.lista || [], porFiltro = {};
  for (const [k] of SF_FILTROS) porFiltro[k] = lista.filter(n => sfSituacao(n) === k);
  const mostrar = porFiltro[sfEst.filtro] || [];
  const botaoBuscar = sfEst.buscando ? '<button class="primary" disabled>Buscando na SEFAZ…</button>'
    : espera ? `<button class="secondary" data-act="sf-buscar" title="A SEFAZ só permite consultar de novo 1 hora depois de uma consulta sem novidades">🔄 Próxima busca às ${sfHora(c.prox_consulta)}</button>` : btn('🔄 Buscar notas', 'sf-buscar', '', 'primary');
  const cartao = n => {
    const sit = sfSituacao(n), cienciaRuim = n.ciencia_cstat && !['135', '136', '573'].includes(n.ciencia_cstat);
    const chipTxt = sit === 'canceladas' ? ['Cancelada pelo fornecedor', 'red'] : sit === 'importadas' ? [`Entrada feita${n.importada_em ? ' em ' + fmtDate(sfDia(n.importada_em)) : ''}`, 'green']
      : n.situacao === 'completa' ? ['Pronta para conferir', 'blue'] : cienciaRuim ? ['Ciência recusada', 'red'] : n.ciencia_em ? ['Aguardando o XML', 'orange'] : ['Só o resumo', 'gray'];
    const nota = n.situacao === 'resumo' && sit === 'pendentes' ? `<small class="sf-nota">${cienciaRuim ? `SEFAZ: ${esc(n.ciencia_cstat)} — ${esc(n.ciencia_motivo || '')}` : n.ciencia_em ? 'Recebimento confirmado (ciência). O XML completo chega na próxima busca.' : 'A ciência será enviada na próxima busca para liberar o XML completo.'}</small>` : '';
    const acoes = sit === 'pendentes' ? (n.situacao === 'completa' ? `<button class="small primary" data-act="sf-conferir" data-id="${esc(n.chave)}">Conferir e dar entrada</button>` : '') + `<button class="small secondary" data-act="sf-ignorar" data-id="${esc(n.chave)}" title="Não é compra para o estoque (ex.: energia, serviço)">Ignorar</button>`
      : sit === 'ignoradas' ? `<button class="small secondary" data-act="sf-desfazer" data-id="${esc(n.chave)}">Voltar para dar entrada</button>` : '';
    return `<div class="sf-item"><div class="sf-txt"><strong>${esc(n.emitente || sfDoc(n.cnpj_emit) || 'Fornecedor')}</strong>
      <small>NF-e ${esc(n.numero || '—')} • ${n.emissao ? fmtDate(sfDia(n.emissao)) : 'sem data'} • CNPJ ${esc(sfDoc(n.cnpj_emit))}</small>${nota}</div>
      <div class="sf-dir"><strong class="sf-valor">${n.valor != null ? brl(Number(n.valor)) : ''}</strong>${chip(chipTxt[0], chipTxt[1])}<div class="sf-bts">${acoes}</div></div></div>`;
  };
  return head('Notas da SEFAZ', `${c.tipo_doc} ${sfDoc(c.doc)}${c.nome ? ' • ' + esc(c.nome) : ''}`, voltar + (adm ? btn('⚙ Certificado', 'sf-cert', '', 'secondary') : '') + botaoBuscar) +
    (venceEm !== null && venceEm <= 30 ? `<div class="es-validade-aviso">⚠ O certificado A1 ${venceEm < 0 ? 'venceu' : `vence em ${venceEm} ${venceEm === 1 ? 'dia' : 'dias'}`} (${fmtDate(sfDia(c.validade))}). ${adm ? 'Envie o certificado renovado em “⚙ Certificado”.' : 'Avise o ADM da fazenda.'}</div>` : '') +
    (sfEst.erro ? `<div class="es-validade-aviso">⚠ ${esc(sfEst.erro)}</div>` : '') +
    `<p class="sub sf-ult">${c.ult_consulta ? `Última consulta à SEFAZ: ${fmtDate(sfDia(c.ult_consulta))} às ${sfHora(c.ult_consulta)}${c.ult_cstat && !['137', '138'].includes(c.ult_cstat) ? ` — ${esc(c.ult_cstat)} ${esc(c.ult_motivo || '')}` : ''}.` : 'Ainda não houve consulta à SEFAZ.'} ${espera ? `A SEFAZ libera a próxima consulta às ${sfHora(c.prox_consulta)}.` : ''}</p>` +
    `<div class="filters cpr-filtros sf-filtros">${SF_FILTROS.map(([k, l]) => `<button class="${sfEst.filtro === k ? 'active' : ''}" aria-pressed="${sfEst.filtro === k}" data-act="sf-filtro" data-id="${k}">${l} (${porFiltro[k].length})</button>`).join('')}</div>` +
    `<section class="card sf-lista">${mostrar.length ? mostrar.map(cartao).join('') : empty(sfEst.filtro === 'pendentes' ? 'Nenhuma nota para dar entrada' : 'Nada aqui', sfEst.filtro === 'pendentes' ? 'Quando um fornecedor emitir nota para a fazenda, ela aparece aqui depois da busca.' : '')}</section>`;
};
TITLES.notassefaz = 'Notas da SEFAZ';

// Ao abrir a tela, busca sozinho se a SEFAZ já permite (no máximo a cada 5 minutos neste aparelho)
function sfAutoBuscar() {
  const c = sfEst.cfg;
  if (!c || sfEst.buscando || Date.now() - sfEst.autoEm < 300000) return;
  if (c.prox_consulta && new Date(c.prox_consulta) > new Date()) return;
  if (c.validade && new Date(c.validade) < new Date()) return;
  sfEst.autoEm = Date.now(); sfBuscar(true);
}

// ---------- Certificado (ADM) ----------
function sfFormCertificado() {
  if (!sfAdm()) return showToast('Só o ADM da fazenda cadastra o certificado', true);
  const c = sfEst.cfg;
  dialog.innerHTML = `<h3>Certificado digital A1</h3>
    <p class="sub">${c ? `Cadastrado: ${esc(c.tipo_doc)} ${esc(sfDoc(c.doc))}${c.nome ? ' — ' + esc(c.nome) : ''}, válido até ${fmtDate(sfDia(c.validade))}. Envie outro arquivo para trocar (renovação).` : 'Use o arquivo do certificado A1 (.pfx ou .p12) da empresa ou do produtor, o mesmo que o contador ou o emissor de notas usa.'}</p>
    <div class="sf-seguro">🔒 O arquivo e a senha vão direto para o servidor, guardados criptografados. Ninguém da equipe vê, e o certificado só é usado para baixar as notas e confirmar o recebimento (ciência) na SEFAZ.</div>
    <form id="sfCertForm"><div class="form">
      <div class="field full"><label for="sfPfx">Arquivo do certificado (.pfx)</label><input type="file" id="sfPfx" accept=".pfx,.p12,application/x-pkcs12" required></div>
      <div class="field"><label for="sfSenha">Senha do certificado</label><input type="password" id="sfSenha" autocomplete="off" required></div>
      <div class="field"><label for="sfUf">Estado da fazenda</label><select id="sfUf">${SF_UFS.map(([cod, uf]) => `<option value="${cod}"${cod === (c?.uf || '43') ? ' selected' : ''}>${uf}</option>`).join('')}</select></div>
      <p class="sub full sf-msg" id="sfCertMsg" role="status" aria-live="polite"></p></div>
      <div class="actions">${c ? '<button type="button" class="danger" id="sfRemover">Remover certificado</button>' : ''}<button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Enviar</button></div>
    </form>`;
  modal.classList.add('open');
  $('[data-close]', dialog).onclick = closeModal;
  $('#sfRemover', dialog)?.addEventListener('click', () => confirmDialog('Remover o certificado? As notas já baixadas continuam aqui, mas o sistema para de buscar novas.', async () => {
    try { await sfChamar('remover'); sfEst.cfg = null; showToast('Certificado removido'); } catch (e) { showToast(e?.message || 'Não foi possível remover', true); }
    render();
  }, 'Remover'));
  $('#sfCertForm', dialog).onsubmit = async ev => {
    ev.preventDefault();
    const arq = $('#sfPfx', dialog).files?.[0], senha = $('#sfSenha', dialog).value, msg = $('#sfCertMsg', dialog), enviar = $('button[type="submit"]', dialog);
    if (!arq) { msg.textContent = 'Escolha o arquivo .pfx do certificado.'; return; }
    if (arq.size > 100000) { msg.textContent = 'Arquivo grande demais para um certificado A1. Confira se é o .pfx.'; return; }
    if (!senha) { msg.textContent = 'Digite a senha do certificado.'; return; }
    enviar.disabled = true; msg.textContent = 'Conferindo o certificado…';
    try {
      const pfx = await new Promise((ok, falha) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => falha(new Error('Não foi possível ler o arquivo')); fr.readAsDataURL(arq); });
      const r = await sfChamar('certificado', {pfx, senha, uf: $('#sfUf', dialog).value});
      sfEst.cfg = r.config; closeModal();
      showToast(`Certificado de ${r.config.nome || sfDoc(r.config.doc)} cadastrado, válido até ${fmtDate(sfDia(r.config.validade))}. Buscando as notas…`);
      render(); sfBuscar();
    } catch (e) { msg.textContent = e?.message || 'Não foi possível enviar o certificado'; enviar.disabled = false; }
  };
}

Object.assign(ACTIONS, {
  'sf-abrir': () => go('notassefaz'),
  'sf-buscar': () => {
    const c = sfEst.cfg;
    if (c?.prox_consulta && new Date(c.prox_consulta) > new Date()) return showToast(`A SEFAZ só permite consultar de novo às ${sfHora(c.prox_consulta)} (1 hora depois de uma consulta sem novidades). Consultar antes bloqueia o CNPJ por 1 hora.`);
    sfBuscar();
  },
  'sf-cert': sfFormCertificado,
  'sf-filtro': k => { sfEst.filtro = k; render(); },
  'sf-ignorar': chave => { sfMarcar(chave, 'ignorar'); showToast('Nota ignorada (não entra no estoque)'); render(); },
  'sf-desfazer': chave => { sfMarcar(chave, 'desfazer'); render(); },
  'sf-conferir': async chave => {
    if (sfJaImportada(chave)) { sfMarcar(chave, 'importada', true); render(); return showToast('Esta nota já teve entrada no estoque'); }
    try {
      const r = await nvHttp(`/rest/v1/nfe_recebidas?farm_id=eq.${encodeURIComponent(nv.fazenda.id)}&chave=eq.${encodeURIComponent(chave)}&select=xml`);
      const xml = r?.[0]?.xml;
      if (!xml) return showToast('O XML desta nota ainda não chegou da SEFAZ', true);
      const n = lerXmlNfe(xml);
      nfeLida = {...n, chave: n.chave || chave, origem: 'sefaz'};
      go('nfe');
    } catch (e) { showToast(e?.message || 'Não foi possível abrir a nota', true); }
  }
});

// Alertas: notas prontas para dar entrada e certificado vencendo
const sfAlertasBase = alerts;
alerts = function () {
  const l = sfAlertasBase();
  if (sfPode() && sfEst.lista) {
    const n = sfProntas().length;
    if (n) l.push({color: 'blue', icon: '🧾', title: `${n} ${n === 1 ? 'nota da SEFAZ' : 'notas da SEFAZ'} para dar entrada`, text: 'Notas de compra emitidas para a fazenda, prontas para conferir e lançar no estoque.', route: 'notassefaz'});
    const c = sfEst.cfg, dias = c?.validade ? Math.round((new Date(c.validade) - new Date()) / 864e5) : null;
    if (dias !== null && dias <= 30) l.push({color: dias < 0 ? 'red' : 'orange', icon: '🔒', title: `Certificado A1 ${dias < 0 ? 'vencido' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}`, text: 'Sem certificado válido o sistema não busca as notas na SEFAZ.', route: 'notassefaz'});
  }
  return l;
};
// Carrega a lista em segundo plano (para o botão do Estoque e os alertas), no máximo a cada 10 minutos
function sfAtualizarFundo() {
  if (!sfPode() || sfEst.carregando || (sfEst.lista !== null && Date.now() - sfEst.em < 600000)) return;
  const antes = sfProntas().length;
  sfCarregar().then(() => { if (sfProntas().length !== antes && /^#\/(estoque|inicio|$)/.test(location.hash || '#/')) render(); });
}
const sfBotaoEstoque = () => {
  if (!sfPode()) return '';
  sfAtualizarFundo();
  const n = sfProntas().length;
  return btn(`🧾 Notas da SEFAZ${n ? ` (${n})` : ''}`, 'sf-abrir', '', n ? 'primary' : 'secondary');
};
