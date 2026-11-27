'use strict';
/* MercaPlant — IA: ler o boletim de análise de sementes por foto ou PDF.
   No formulário da análise (Sementes → lote → Registrar análise), "📷 O Edy lê o boletim (foto)": tira a foto ou
   escolhe o PDF; o servidor (função ia, com o Gemini do Google) lê o boletim e o app preenche data, nº, laboratório,
   amostra, germinação, vigor, pureza, outras sementes, PMS, umidade e as espécies encontradas com a quantidade e o grupo.
   Tudo fica marcado como "lido pelo Edy" para a pessoa conferir com o papel antes de salvar — a IA nunca salva sozinha.
   Precisa estar conectado à nuvem (a chave da IA fica só no servidor). A foto não é guardada. */
const IA_MAX_LADO = 2000, IA_MAX_PDF = 5 * 1024 * 1024;

/** Arquivo → {tipo, dados(base64)}. Foto: reduzida para no máximo 2000 px no maior lado (JPEG); PDF: como está, até 5 MB. */
function iaArquivo(arq) {
  return new Promise((ok, falha) => {
    if (!arq) return falha(new Error('Nenhum arquivo escolhido'));
    if (arq.type === 'application/pdf') {
      if (arq.size > IA_MAX_PDF) return falha(new Error('PDF grande demais (até 5 MB). Tire uma foto da página do resultado.'));
      const fr = new FileReader(); fr.onload = () => ok({tipo: 'application/pdf', dados: String(fr.result).split(',')[1] || ''}); fr.onerror = () => falha(new Error('Não foi possível ler o PDF')); fr.readAsDataURL(arq); return;
    }
    if (!/^image\//.test(arq.type)) return falha(new Error('Escolha uma foto ou o PDF do boletim'));
    const url = URL.createObjectURL(arq), img = new Image();
    img.onload = () => {
      const k = Math.min(1, IA_MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok({tipo: 'image/jpeg', dados: c.toDataURL('image/jpeg', 0.88).split(',')[1] || ''});
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não foi possível abrir a foto')); };
    img.src = url;
  });
}

/** Põe o que a IA leu no formulário aberto (só campos vazios ou que a pessoa ainda não mexeu). Devolve quantos campos. */
function iaPreencherBoletim(form, d, p) {
  let n = 0;
  const por = (k, v) => {
    const el = form.querySelector(`#lab_${k}`); if (!el || v == null || v === '') return;
    el.value = typeof v === 'number' ? String(v).replace('.', ',') : v;
    if (el.type === 'date') el.value = v;
    el.classList.add('ia-lido'); n++;
  };
  ['data', 'boletim', 'laboratorio', 'germinacao', 'vigor', 'pureza', 'outrasPct', 'pms', 'umidade'].forEach(k => por(k, d[k]));
  if (form.querySelector('#lab_amostraCS')) { por('amostraCS', d.amostraCS ?? d.amostraG); por('amostraG', d.amostraG); } else por('amostraG', d.amostraG);
  if (['germinacao', 'vigor', 'pureza', 'outrasPct', 'pms', 'umidade'].some(k => d[k] != null)) { const det = form.querySelector('.lab-outros'); if (det) det.open = true; }
  (d.encontradas || []).forEach(e => {
    let linha = [...form.querySelectorAll('.lab-linha')].find(r => !r.querySelector('[data-o=nome]').value.trim() && !r.querySelector('[data-o=n]').value.trim());
    if (!linha) { form.querySelector('.lab-mais')?.click(); linha = [...form.querySelectorAll('.lab-linha')].at(-1); }
    if (!linha) return;
    const nome = linha.querySelector('[data-o=nome]'), grupo = linha.querySelector('[data-o=grupo]'), qt = linha.querySelector('[data-o=n]');
    nome.value = e.nome; nome.dispatchEvent(new Event('input', {bubbles: true})); // o app sugere o grupo pela espécie
    if (e.grupo && [...grupo.options].some(o => o.value === e.grupo)) grupo.value = e.grupo;
    qt.value = String(e.n);
    n++;
  });
  // "+ Outra espécie" redesenha as linhas: marca as lidas no fim
  const lidas = new Set((d.encontradas || []).map(e => e.nome));
  form.querySelectorAll('.lab-linha').forEach(r => { if (lidas.has(r.querySelector('[data-o=nome]').value)) r.querySelectorAll('input, select').forEach(x => x.classList.add('ia-lido')); });
  form.dispatchEvent(new Event('change', {bubbles: true}));
  return n;
}

async function iaLerBoletim(lotId, arq, caixa) {
  const l = find('lots', lotId), form = document.querySelector('#dialog .lab-form'); if (!l || !form) return;
  const p = labPadrao(l.species), info = caixa.querySelector('.ia-bol-info'), botao = caixa.querySelector('.ia-bol-btn');
  const msg = (html, cls = '') => { info.className = 'ia-bol-info ' + cls; info.innerHTML = html; };
  botao.disabled = true; msg('<span class="ia-roda" aria-hidden="true"></span> Lendo o boletim… (até 30 segundos)', 'lendo');
  try {
    const arquivo = await iaArquivo(arq);
    const r = await nvHttp('/functions/v1/ia', {method: 'POST', body: {farm_id: nv.fazenda.id, acao: 'boletim', especie: l.species || '', cientifico: p?.cientifico || '',
      grupos: (p ? p.grupos : labGrupoBase()).map(g => ({id: g.id, rot: g.rot})), arquivo}});
    if (!document.body.contains(form)) return;
    const d = r.dados || {}, n = iaPreencherBoletim(form, d, p);
    const avisos = [...(d.avisos || [])];
    if (d.especieNoBoletim && p && labPadrao(d.especieNoBoletim) && labPadrao(d.especieNoBoletim).especie !== p.especie) avisos.unshift(`O boletim é de ${d.especieNoBoletim}, e o lote é de ${l.species}.`);
    if (d.loteNoBoletim && l.code && !String(d.loteNoBoletim).toLowerCase().replace(/\s/g, '').includes(String(l.code).toLowerCase().replace(/\s/g, ''))) avisos.push(`O boletim é do lote ${d.loteNoBoletim}: confira se é deste lote (${l.code}).`);
    msg(n ? `<b>✨ ${n} ${n === 1 ? 'campo lido' : 'campos lidos'} pelo Edy</b> — confira cada número com o boletim antes de salvar (os campos lidos estão marcados).${avisos.length ? `<ul>${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`
      : `O Edy não achou os resultados nesta ${arquivo.tipo === 'application/pdf' ? 'página' : 'foto'}. Tente uma foto mais nítida, de frente e com boa luz, só da parte do resultado.${avisos.length ? `<ul>${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`, n ? 'ok' : 'aviso');
    const obs = form.querySelector('#lab_obs'); if (n && obs && !obs.value.trim()) obs.value = 'Valores lidos do boletim pelo Edy (IA) e conferidos.';
  } catch (e) {
    msg(esc(e?.message || 'Não foi possível ler o boletim.'), 'erro');
  } finally { botao.disabled = false; }
}

// Botão no formulário da análise
if (typeof labForm === 'function') {
  const _labForm = labForm;
  // eslint-disable-next-line no-global-assign
  labForm = function (lotId, a0) {
    _labForm(lotId, a0);
    const form = document.querySelector('#dialog .lab-form'); if (!form || form.querySelector('.ia-bol')) return;
    const ligado = typeof nvVinculado === 'function' && nvVinculado();
    const caixa = document.createElement('div'); caixa.className = 'field full ia-bol';
    caixa.innerHTML = ligado
      ? `<button type="button" class="secondary ia-bol-btn">📷 O Edy lê o boletim (foto ou PDF)</button><input type="file" class="ia-bol-arq" accept="image/*,application/pdf" hidden>
         <p class="ia-bol-info">Tire uma foto do boletim (ou escolha o PDF): o Edy preenche os campos e você confere antes de salvar.</p>`
      : `<p class="ia-bol-info">📷 O Edy lê o boletim por foto: entre na sua conta da nuvem para usar.</p>`;
    form.prepend(caixa);
    if (!ligado) return;
    const arq = caixa.querySelector('.ia-bol-arq');
    caixa.querySelector('.ia-bol-btn').onclick = () => arq.click();
    arq.onchange = () => { const f = arq.files?.[0]; arq.value = ''; if (f) iaLerBoletim(lotId, f, caixa); };
  };
}
