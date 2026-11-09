'use strict';
/* Foto da nota fiscal (DANFE) → estoque (0.86).
   A foto vai para a função "nota-foto" no servidor, que devolve a transcrição da nota. Aqui o app confere o que der
   para conferir (dígito da chave, número e CNPJ dentro da chave, quantidade × unitário, soma dos itens × total)
   e abre a mesma conferência do XML, com os avisos e os itens duvidosos marcados. Nada entra no estoque sem a pessoa confirmar. */

const NF_FOTO_MAX = 4;

// Chave de acesso: 44 dígitos e dígito verificador (módulo 11, pesos 2 a 9 da direita para a esquerda)
function chaveNfeValida(c) {
  const s = String(c || '').replace(/\D/g, '');
  if (s.length !== 44) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11, dv = r < 2 ? 0 : 11 - r;
  return dv === Number(s[43]);
}
// O que a própria chave diz: CNPJ do emitente, série e número
const nfDaChave = c => ({cnpj: c.slice(6, 20), serie: String(Number(c.slice(22, 25))), numero: String(Number(c.slice(25, 34)))});
const nfSoDig = v => String(v ?? '').replace(/\D/g, '');
const nfNum = v => (typeof v === 'number' && Number.isFinite(v)) ? v : (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null);
const nfDataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(new Date(d + 'T12:00').getTime());
const nfDinheiro = v => Math.round(v * 100) / 100;

// Resposta da função → o mesmo formato do XML lido (nfeLida), com origem "foto" e avisos
function nfDaFotoParaNota(r) {
  const avisos = [];
  const chave = nfSoDig(r.chave), chaveOk = chaveNfeValida(chave);
  let numero = nfSoDig(r.numero).replace(/^0+(?=\d)/, ''), serie = nfSoDig(r.serie).replace(/^0+(?=\d)/, ''), cnpj = nfSoDig(r.cnpj_emitente);
  if (chaveOk) {
    const k = nfDaChave(chave);
    if ((numero && numero !== k.numero) || (cnpj && cnpj !== k.cnpj)) avisos.push('O número ou o CNPJ lidos não batiam com a chave de acesso; foi usado o que está na chave.');
    numero = k.numero; serie = k.serie; cnpj = k.cnpj;
  } else avisos.push(chave ? 'A chave de acesso não foi lida com certeza (o dígito verificador não confere). A nota repetida é conferida pelo número e CNPJ.' : 'A chave de acesso não foi lida. A nota repetida é conferida pelo número e CNPJ.');
  if (!numero) avisos.push('O número da nota não foi lido.');

  let duvidosos = 0;
  const itens = (Array.isArray(r.itens) ? r.itens : []).map((x, i) => {
    const qtd = nfNum(x.quantidade), vu = nfNum(x.valor_unitario), vt0 = nfNum(x.valor_total), desc = Math.max(0, nfNum(x.desconto) || 0);
    const vt = vt0 ?? (qtd != null && vu != null ? nfDinheiro(qtd * vu) : null);
    // Quantidade × unitário tem de dar o total do item (1% de folga para arredondamento do unitário)
    const conta = qtd != null && vu != null && vt0 != null && Math.abs(qtd * vu - vt0) > Math.max(0.02, Math.abs(vt0) * 0.01);
    const duvida = !!x.duvida || qtd == null || !(qtd > 0) || vt == null || conta || !String(x.descricao || '').trim();
    if (duvida) duvidosos++;
    const valor = vt == null ? 0 : vt;
    return {nItem: String(i + 1), codigo: String(x.codigo || '').trim(), nome: String(x.descricao || '').trim() || `Item ${i + 1} (sem descrição)`, ncm: nfSoDig(x.ncm).slice(0, 8),
      unidade: String(x.unidade || '').trim(), qtd: qtd ?? 0, valor, desconto: vt == null ? 0 : Math.min(desc, valor),
      lote: String(x.lote || '').trim(), validade: nfDataOk(x.validade) ? x.validade : '', lotes: [], porLote: false, duvida,
      // Valor que aparece para corrigir: em branco quando não foi lido, para não entrar zero sem querer
      ...(vt == null ? {valorEd: ''} : {}), ...(qtd == null ? {qtdEst: ''} : {})};
  });
  if (duvidosos) avisos.push(`${duvidosos} ${duvidosos === 1 ? 'item ficou' : 'itens ficaram'} com leitura duvidosa (marcados com ⚠): confira quantidade e valor.`);

  const soma = nfDinheiro(itens.reduce((t, it) => t + Math.max(0, it.valor - it.desconto), 0));
  const totProd = nfNum(r.total_produtos), totNota = nfNum(r.total_nota);
  const somaBruta = nfDinheiro(itens.reduce((t, it) => t + it.valor, 0));
  if (totProd != null && Math.abs(somaBruta - totProd) > Math.max(0.05, totProd * 0.005)) avisos.push(`A soma dos itens (R$ ${num(somaBruta, 2)}) não bate com o total dos produtos impresso (R$ ${num(totProd, 2)}). Pode faltar item ou ter número mal lido.`);
  if (totNota == null) avisos.push('O valor total da nota não foi lido; o gasto vai pela soma dos itens.');

  const dups = (Array.isArray(r.duplicatas) ? r.duplicatas : []).map(d => ({numero: String(d.numero || '').trim(), vencimento: nfDataOk(d.vencimento) ? d.vencimento : '', valor: nfNum(d.valor) || 0})).filter(d => d.valor > 0);
  if (dups.some(d => !d.vencimento)) avisos.push('Alguma duplicata ficou sem vencimento legível; ela vai vencer na data da nota. Ajuste depois em Financeiro.');
  const somaDups = nfDinheiro(dups.reduce((t, d) => t + d.valor, 0));
  if (dups.length && totNota != null && Math.abs(somaDups - totNota) > 0.05) avisos.push(`As duplicatas somam R$ ${num(somaDups, 2)} e o total da nota é R$ ${num(totNota, 2)}.`);
  const data = nfDataOk(r.data_emissao) ? r.data_emissao : '';
  if (!data) avisos.push('A data de emissão não foi lida; vai a data de hoje.');
  else if (data > today()) avisos.push('A data de emissão lida é futura; confira.');

  return {origem: 'foto', chave: chaveOk ? chave : `foto-${cnpj || 'semcnpj'}-${numero || Date.now()}`, numero: numero || 's/n', serie, data,
    emitente: String(r.emitente || '').trim() || 'Fornecedor não lido', cnpj, total: totNota ?? soma, itens, dups, avisos};
}

// Reduz a foto antes de enviar: JPEG, lado maior até 2200 px, até ~3 MB em base64
async function nfReduzirFoto(arq) {
  const url = URL.createObjectURL(arq);
  try {
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('Não foi possível abrir a foto')); i.src = url; });
    let lado = 2200, q = 0.88, dados = '';
    for (let t = 0; t < 6; t++) {
      const f = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = Object.assign(document.createElement('canvas'), {width: Math.round(img.naturalWidth * f), height: Math.round(img.naturalHeight * f)});
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      dados = cv.toDataURL('image/jpeg', q).split(',')[1] || '';
      if (dados.length <= 3_000_000) break;
      q = Math.max(0.6, q - 0.1); if (q === 0.6) lado = Math.round(lado * 0.8);
    }
    if (!dados) throw new Error('Não foi possível preparar a foto');
    return {tipo: 'image/jpeg', dados};
  } finally { URL.revokeObjectURL(url); }
}

function nfFotoLendo(n) {
  dialog.innerHTML = `<h3>📷 Lendo a nota…</h3><p class="sub">${n === 1 ? 'Enviando a foto' : `Enviando ${n} fotos`} e lendo os itens. Leva uns 20 a 40 segundos.</p><div class="nf-foto-lendo" role="status" aria-live="polite"><span class="nf-foto-roda" aria-hidden="true"></span> Aguarde, não feche o app.</div>`;
  modal.classList.add('open');
}

async function nfLerFotos(arquivos) {
  const lista = [...arquivos].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)).slice(0, NF_FOTO_MAX);
  if (!lista.length) return showToast('Escolha a foto da nota');
  if (arquivos.length > NF_FOTO_MAX) showToast(`Só as ${NF_FOTO_MAX} primeiras fotos serão lidas`);
  nfFotoLendo(lista.length);
  try {
    const imagens = [];
    for (const f of lista) imagens.push(await nfReduzirFoto(f));
    const r = await nvHttp('/functions/v1/nota-foto', {method: 'POST', body: {farm_id: nv.fazenda.id, imagens}});
    closeModal();
    const nota = r?.nota;
    if (!nota || nota.eh_nota === false) return showToast(nota?.motivo ? `Não parece uma nota fiscal: ${nota.motivo}` : 'Não foi possível ler a nota. Tire a foto de novo, com boa luz e a nota inteira.', true);
    if (!Array.isArray(nota.itens) || !nota.itens.length) return showToast('Nenhum item foi lido na foto. Fotografe o quadro “Dados dos produtos” bem de perto.', true);
    nfeLida = nfDaFotoParaNota(nota);
    go('nfe');
  } catch (e) {
    closeModal();
    showToast(e?.message || 'Não foi possível ler a nota', true);
  }
}

function nfFotoDisponivel() {
  if (typeof nvVinculado !== 'function' || !nvVinculado() || !nv.sessao) return 'A leitura pela foto usa o servidor: entre na conta da fazenda (menu → Nuvem) para usar.';
  if (navigator.onLine === false) return 'Sem internet agora. A leitura pela foto precisa de conexão; use o XML ou tente mais tarde.';
  return '';
}

ACTIONS['nfe-foto'] = () => {
  const motivo = nfFotoDisponivel();
  if (motivo) return showToast(motivo, true);
  dialog.innerHTML = `<h3>📷 Foto da nota fiscal</h3>
    <p class="sub">Tire a foto da nota (DANFE) que veio com a mercadoria. O sistema lê os itens e mostra tudo para você conferir antes de entrar no estoque.</p>
    <ul class="nf-foto-dicas"><li>Nota inteira na foto, reta e com boa luz, sem sombra.</li><li>Nota com mais de uma página: uma foto por página (até ${NF_FOTO_MAX}).</li><li>Se tiver o XML da nota, ele é mais seguro: não depende de leitura.</li></ul>
    <div class="actions"><button class="secondary" data-close>Cancelar</button><button class="secondary" data-nf-galeria>Escolher da galeria</button><button class="primary" data-nf-camera>📷 Tirar foto</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  const escolher = camera => {
    const inp = Object.assign(document.createElement('input'), {type: 'file', accept: 'image/*', multiple: !camera});
    if (camera) inp.setAttribute('capture', 'environment');
    inp.onchange = () => { if (inp.files?.length) nfLerFotos(inp.files); };
    inp.click();
  };
  $('[data-nf-camera]', dialog).onclick = () => escolher(true);
  $('[data-nf-galeria]', dialog).onclick = () => escolher(false);
  modal.classList.add('open');
};
