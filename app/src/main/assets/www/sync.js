'use strict';
/* Sincronização entre aparelhos sem servidor: um aparelho gera o arquivo, o outro recebe e mescla.
   Regra: registro novo entra; o mesmo registro nos dois aparelhos fica com a versão alterada por último (_mod);
   exclusões viajam como “removidos”. Saldos do estoque e horímetros são recalculados para não perder lançamentos. */

const SYNC_ANTES = 'agro-db-antes-sync';
function idAparelho() { if (!db.settings.aparelhoId) { db.settings.aparelhoId = uid(); save(); } return db.settings.aparelhoId; }

function gerarArquivoSync() {
  const nome = db.settings.nomeAparelho || 'aparelho';
  const payload = JSON.stringify({app: 'agro-operacoes', tipo: 'sincronizacao', aparelho: idAparelho(), nomeAparelho: nome, exportedAt: new Date().toISOString(), data: db});
  downloadFile(`nexus-sync-${semAcentoApp(nome).replace(/[^a-z0-9]+/g, '-')}-${today()}.json`, 'application/json', payload);
}

// Efeito de um movimento no saldo (ajuste = diferença registrada)
const deltaMov = m => m.kind === 'Entrada' ? Number(m.qty) || 0 : m.kind === 'Saída' ? -(Number(m.qty) || 0) : (Number(m.after) || 0) - (Number(m.before) || 0);

function mesclar(local, remoto) {
  const res = {novos: 0, atualizados: 0, removidos: 0};
  const remov = [...(local._removidos || []), ...(remoto._removidos || [])];
  const removidoEm = (c, id) => Math.max(0, ...remov.filter(r => r.c === c && r.id === id).map(r => r.at));
  const movsLocal = new Set((local.movements || []).map(m => m.id)), movsRemoto = new Set((remoto.movements || []).map(m => m.id));
  // Movimento excluído em algum aparelho depois da última alteração dele (a exclusão já devolveu o saldo naquele aparelho)
  const movExcluido = m => { const rem = removidoEm('movements', m.id); return rem > 0 && rem >= (m._mod || 0); };
  const somaMovs = (lista, itemId, filtro) => (lista || []).filter(m => m.itemId === itemId && filtro(m)).reduce((s, m) => s + deltaMov(m), 0);
  for (const c of COLLECTIONS) {
    const L = new Map((local[c] || []).map(r => [r.id, r])), R = remoto[c] || [];
    for (const r of R) {
      if (!r?.id) continue;
      const l = L.get(r.id), rem = removidoEm(c, r.id);
      if (!l) { if (rem >= (r._mod || 0) && rem) continue; L.set(r.id, r); res.novos++; continue; }
      if ((r._mod || 0) > (l._mod || 0)) {
        // Estoque: o saldo do vencedor não inclui os lançamentos que só o outro aparelho tem
        // e ainda conta os que o outro aparelho excluiu (sem saber da exclusão)
        if (c === 'stock') {
          const soNoLocal = somaMovs(local.movements, r.id, m => !movsRemoto.has(m.id) && !movExcluido(m));
          r.qty = Number(r.qty || 0) + soNoLocal - somaMovs(remoto.movements, r.id, movExcluido);
        }
        // Máquina: a versão mais recente vale inteira, inclusive o horímetro (permite corrigir uma leitura digitada errada)
        L.set(r.id, r); res.atualizados++;
      } else if (c === 'stock') {
        const ajuste = somaMovs(remoto.movements, r.id, m => !movsLocal.has(m.id) && !movExcluido(m)) - somaMovs(local.movements, r.id, movExcluido);
        if (ajuste) { l.qty = Number(l.qty || 0) + ajuste; res.atualizados++; }
      } else if (c === 'machines' && (r._mod || 0) === (l._mod || 0) && Number(r.hours) > Number(l.hours || 0)) { l.hours = Number(r.hours); res.atualizados++; }
    }
    // Exclusões feitas em qualquer aparelho, posteriores à última alteração do registro
    for (const [id, l] of L) { const rem = removidoEm(c, id); if (rem && rem >= (l._mod || 0) && (local[c] || []).some(x => x.id === id)) { L.delete(id); res.removidos++; } else if (rem && rem >= (l._mod || 0)) L.delete(id); }
    local[c] = [...L.values()];
  }
  local._removidos = [...new Map(remov.map(r => [r.c + '|' + r.id, r])).values()].slice(-5000);
  return res;
}

function receberArquivoSync(texto) {
  let p; try { p = JSON.parse(texto); } catch { showToast('Arquivo inválido'); return; }
  if (p?.app !== 'agro-operacoes' || !p.data) { showToast('Este arquivo não é do Nexus Agro'); return; }
  if (p.aparelho && p.aparelho === db.settings.aparelhoId) { showToast('Este arquivo foi gerado neste mesmo aparelho'); return; }
  const juntar = comCopia => {
    const r = mesclar(db, normalizarDb(p.data));
    impressoes = null; // a mesclagem não é uma alteração local
    db.settings.ultimaSync = {em: new Date().toISOString(), de: p.nomeAparelho || '', ...r};
    save(); showToast(`Sincronizado: ${r.novos} novos, ${r.atualizados} atualizados, ${r.removidos} removidos${comCopia ? '' : ' • sem cópia para desfazer'}`);
  };
  confirmDialog(`Juntar os dados de “${p.nomeAparelho || 'outro aparelho'}” (gerado em ${p.exportedAt ? new Date(p.exportedAt).toLocaleString('pt-BR') : 'data desconhecida'}) com os deste aparelho? Uma cópia do estado atual fica guardada para desfazer.`, () => {
    const atual = JSON.stringify(db);
    // Sem espaço: apaga a cópia antiga (seria de outro estado) e tenta de novo
    if (safeStorage.set(SYNC_ANTES, atual) || (safeStorage.del(SYNC_ANTES), safeStorage.set(SYNC_ANTES, atual))) return juntar(true);
    // Abre depois que o confirmDialog atual fechar
    setTimeout(() => confirmDialog('Não há espaço no aparelho para guardar a cópia do estado atual: esta sincronização NÃO poderá ser desfeita. Se quiser, exporte um backup antes. Juntar mesmo assim?', () => juntar(false), 'Juntar sem cópia'), 0);
  }, 'Juntar');
}

function cartaoSincronizacao() {
  const u = db.settings.ultimaSync, temAntes = !!safeStorage.get(SYNC_ANTES);
  return `<article class="card panel"><h3>Sincronizar com outro aparelho</h3>
    <p>Para a equipe usar em mais de um celular ou computador, sem internet e sem conta: gere o arquivo neste aparelho, envie (WhatsApp, e-mail, cabo) e receba no outro. Faça nos dois sentidos para os dois ficarem iguais.</p>
    <div class="form" style="margin-bottom:10px"><div class="field full"><label for="s_aparelho">Nome deste aparelho</label><input id="s_aparelho" value="${esc(db.settings.nomeAparelho || '')}" placeholder="Ex.: Celular do João"></div></div>
    <div class="btn-row">${btn('⇪ Gerar arquivo de sincronização', 'sync-gerar')}${btn('⇩ Receber arquivo', 'sync-receber', '', 'secondary')}${temAntes ? btn('Desfazer última sincronização', 'sync-desfazer', '', 'secondary') : ''}</div>
    <input type="file" id="syncInput" accept="application/json,.json" hidden>
    ${u ? `<p class="nota">Última sincronização: ${new Date(u.em).toLocaleString('pt-BR')}${u.de ? ' com ' + esc(u.de) : ''} — ${u.novos} novos, ${u.atualizados} atualizados, ${u.removidos} removidos.</p>` : ''}
    <p class="nota">Quando o mesmo registro foi alterado nos dois aparelhos, vale a alteração mais recente. Lançamentos de estoque dos dois lados são somados ao saldo.</p></article>`;
}

const cadastrosAfterSemSync = VIEWS.cadastros.after;
VIEWS.cadastros.after = () => {
  cadastrosAfterSemSync?.();
  const n = $('#s_aparelho'); if (n) n.onchange = () => { db.settings.nomeAparelho = n.value.trim(); save(); };
  const i = $('#syncInput'); if (i) i.onchange = e => { const f = e.target.files[0]; if (f) f.text().then(receberArquivoSync).catch(() => showToast('Não foi possível ler o arquivo')); e.target.value = ''; };
};
Object.assign(ACTIONS, {
  'sync-gerar': () => { const n = $('#s_aparelho'); if (n) db.settings.nomeAparelho = n.value.trim(); gerarArquivoSync(); },
  'sync-receber': () => $('#syncInput').click(),
  'sync-desfazer': () => confirmDialog('Voltar ao estado de antes da última sincronização?', () => {
    try { const ant = JSON.parse(safeStorage.get(SYNC_ANTES)); if (ant) { db = normalizarDb(ant); impressoes = null; save(); safeStorage.set(SYNC_ANTES, ''); showToast('Sincronização desfeita'); } } catch { showToast('Não foi possível desfazer'); }
  }, 'Desfazer')
});
