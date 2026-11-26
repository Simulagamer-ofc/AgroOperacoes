'use strict';
/* MercaPlant — Caminhões e tara cadastrada (moega).
   • Toda pesagem do caminhão vazio (romaneio novo) cadastra o caminhão pela placa e atualiza a tara dele, com histórico.
   • Na chegada ou na carga na moega, a placa com tara cadastrada há até 30 dias preenche a tara sozinha: uma pesagem só,
     peso da carga = bruto − tara cadastrada. Vale para grão próprio e de terceiros; o romaneio, o histórico e o ticket
     dizem “tara cadastrada do caminhão, pesada em dd/mm”.
   • Tara vencida (mais de 30 dias): não preenche e pede para pesar o caminhão vazio.
   Cadastro em Grãos → Moega → Caminhões e taras (placa, motorista, transportadora, tara e data da pesagem vazia). */
const TARA_VALIDADE_DIAS = 30;
const chavePlaca = p => String(p || '').replace(/\W/g, '').toUpperCase();
const caminhaoDaPlaca = placa => { const k = chavePlaca(placa); return k ? (db.caminhoes || []).find(c => chavePlaca(c.placa) === k) || null : null; };
/** Situação da tara cadastrada: kg, data, dias desde a pesagem, dias que ainda vale e se vale. */
function taraSituacao(c, hoje = today()) {
  if (!c || !(Number(c.tara) > 0) || !c.taraEm) return null;
  const em = String(c.taraEm).slice(0, 10), dias = Math.round((new Date(hoje + 'T12:00:00') - new Date(em + 'T12:00:00')) / 864e5), resta = TARA_VALIDADE_DIAS - dias;
  return {kg: Number(c.tara), em, dias, resta, valida: resta >= 0, vence: addDias(em, TARA_VALIDADE_DIAS)};
}
const taraValida = placa => { const c = caminhaoDaPlaca(placa), s = taraSituacao(c); return s?.valida ? {...s, caminhaoId: c.id} : null; };
const placaFmt = p => { const k = chavePlaca(p); return k.length === 7 ? k.slice(0, 3) + '-' + k.slice(3) : k; };

// ---------- No formulário: escolher o caminhão cadastrado → placa, motorista e tara ----------
/** Campo “Caminhão cadastrado” (lista de placas com motorista e tara) para a chegada e a carga na moega. */
function camposCaminhao() {
  const lista = (db.caminhoes || []).slice().sort((a, b) => String(a.placa).localeCompare(String(b.placa)));
  if (!lista.length) return [];
  return [{k: 'caminhao', label: 'Caminhão cadastrado', type: 'select', full: true, hint: 'Escolha a placa: o motorista e a tara vêm do cadastro do caminhão.',
    options: [{value: '', label: 'Outro caminhão — digitar a placa'}, ...lista.map(c => { const t = taraSituacao(c);
      const quem = c.motorista || (c.maquinaId && find('machines', c.maquinaId)?.name) || ''; return {value: c.id, label: `${c.placa}${quem ? ' • ' + quem : ''} • ${t ? `tara ${n0(t.kg)} kg${t.valida ? '' : ' (vencida)'}` : 'sem tara'}`}; })]}];
}
function ligarCaminhao(f) {
  const sel = f?.elements.caminhao, pl = f?.elements.placa, mo = f?.elements.motorista; if (!sel || !pl) return;
  let motAuto = '';
  sel.addEventListener('change', () => {
    const c = find('caminhoes', sel.value); if (!c) return;
    pl.value = c.placa;
    if (mo && (!mo.value || mo.value === motAuto)) { mo.value = c.motorista || ''; motAuto = mo.value; }
    pl.dispatchEvent(new Event('input', {bubbles: true}));
  });
  pl.addEventListener('input', () => { const c = caminhaoDaPlaca(pl.value); if ((c?.id || '') !== sel.value) sel.value = c?.id || ''; });
}
/** Chegada: mostra a tara do caminhão escolhido e a carga (bruto − tara) enquanto digita o peso bruto. */
function chegadaLigar() {
  const f = document.querySelector('#dialog form'), pl = f?.elements.placa, pb = f?.elements.pesoBruto, ut = f?.elements.usarTara; if (!pl || !pb) return;
  ligarCaminhao(f);
  const aviso = document.createElement('small'); aviso.className = 'tara-cad'; aviso.setAttribute('aria-live', 'polite');
  (pb.closest('.field') || pb.parentElement).appendChild(aviso);
  const atualizar = () => {
    const s = taraSituacao(caminhaoDaPlaca(pl.value)), bruto = typeof numeroBR === 'function' ? numeroBR(pb.value) : Number(pb.value);
    if (!s || ut?.value === 'pesar') { aviso.textContent = ''; aviso.className = 'tara-cad'; return; }
    if (!s.valida) { aviso.className = 'tara-cad vencida'; aviso.textContent = `Tara cadastrada vencida (${n0(s.kg)} kg, pesada em ${fmtDate(s.em)}): o caminhão fica no pátio para pesar vazio.`; return; }
    aviso.className = 'tara-cad ok';
    aviso.textContent = `Tara cadastrada: ${n0(s.kg)} kg (pesada em ${fmtDate(s.em)})${bruto > s.kg ? ` → carga: ${n0(bruto - s.kg)} kg` : ''}. Ao registrar, o romaneio abre com essa tara.`;
  };
  [pl, pb].forEach(el => el.addEventListener('input', atualizar)); ut?.addEventListener('change', atualizar); f.elements.caminhao?.addEventListener('change', () => setTimeout(atualizar, 0));
  atualizar();
}

// ---------- No formulário: placa → tara ----------
let taraNoForm = null; // {caminhaoId, kg, em} quando a tara foi preenchida pela cadastrada
/** Liga a placa à tara no formulário aberto (romaneio da moega). preencher: já coloca a tara da placa ao abrir. */
function taraLigarForm(preencher = false) {
  taraNoForm = null;
  const f = document.querySelector('#dialog form'), pl = f?.elements.placa, ta = f?.elements.tara; if (!pl || !ta) return;
  ligarCaminhao(f);
  const aviso = document.createElement('small'); aviso.className = 'tara-cad'; aviso.setAttribute('aria-live', 'polite');
  (ta.closest('.field') || ta.parentElement).appendChild(aviso);
  const atualizar = (forcar = false) => {
    const c = caminhaoDaPlaca(pl.value), s = taraSituacao(c);
    if (!s) { if (taraNoForm && Number(ta.value) === taraNoForm.kg) ta.value = ''; taraNoForm = null; aviso.textContent = ''; aviso.className = 'tara-cad'; return; }
    if (!s.valida) {
      if (taraNoForm && Number(ta.value) === taraNoForm.kg) ta.value = '';
      taraNoForm = null; aviso.className = 'tara-cad vencida';
      aviso.textContent = `Tara cadastrada vencida: ${n0(s.kg)} kg, pesada em ${fmtDate(s.em)} (há ${s.dias} dias). Pese o caminhão vazio.`; return;
    }
    if (forcar || ta.value === '' || (taraNoForm && Number(ta.value) === taraNoForm.kg)) { ta.value = s.kg; taraNoForm = {caminhaoId: c.id, kg: s.kg, em: s.em}; }
    aviso.className = 'tara-cad ok';
    aviso.textContent = taraNoForm && Number(ta.value) === s.kg
      ? `Tara cadastrada do caminhão: ${n0(s.kg)} kg, pesada em ${fmtDate(s.em)} (vale até ${fmtDate(s.vence)}). Para pesar vazio, apague e digite.`
      : `Tara digitada. Cadastrada: ${n0(s.kg)} kg (${fmtDate(s.em)}).`;
  };
  pl.addEventListener('input', () => atualizar()); pl.addEventListener('change', () => atualizar());
  ta.addEventListener('input', () => { if (taraNoForm && Number(ta.value) !== taraNoForm.kg) taraNoForm = null; atualizar(); });
  atualizar(preencher);
}
/** No salvar: a tara usada foi a cadastrada? */
const taraCadastradaUsada = v => taraNoForm && Number(v.tara) === taraNoForm.kg ? {...taraNoForm} : null;

// ---------- Depois do romaneio: cadastra/atualiza o caminhão ----------
/** Pesagem real do caminhão vazio (romaneio novo sem tara cadastrada): cadastra a placa e atualiza a tara. */
function taraAtualizar(reg) {
  if (!reg?.placa || !(Number(reg.tara) > 0) || reg.taraCadastrada) return;
  const c = caminhaoDaPlaca(reg.placa), em = String(reg.saida || reg.date || today()).slice(0, 10);
  if (c && c.taraEm && String(c.taraEm).slice(0, 10) > em) return; // pesagem antiga lançada depois: não troca a mais nova
  const hist = [...(c?.historico || []), {em, kg: Number(reg.tara), origem: 'pesagem', romaneio: reg.numero, por: quemUsa()}].slice(-20);
  upsert('caminhoes', {...(c || {id: uid(), placa: placaFmt(reg.placa), criadoEm: Date.now()}), motorista: c?.motorista || reg.motorista || '', tara: Number(reg.tara), taraEm: em, taraOrigem: 'pesagem', historico: hist});
}

// ---------- Cadastro e lista ----------
/** Tara digitada no cadastro do caminhão em Máquinas: grava no cadastro de caminhões da moega (mesma placa). */
function taraDaMaquina(maq, {kg, em}) {
  const c = caminhaoDaPlaca(maq.placa) || null;
  if (c && Number(c.tara) === kg && String(c.taraEm || '').slice(0, 10) === em) { if (c.maquinaId !== maq.id) upsert('caminhoes', {...c, maquinaId: maq.id}); return; }
  const hist = [...(c?.historico || []), {em, kg, origem: 'cadastro da máquina', por: quemUsa()}].slice(-20);
  upsert('caminhoes', {...(c || {id: uid(), placa: placaFmt(maq.placa), criadoEm: Date.now(), transportadora: 'Próprio'}), maquinaId: maq.id, tara: kg, taraEm: em, taraOrigem: 'manual', historico: hist});
}
function caminhaoForm(c = {}) {
  openForm({title: c.id ? `Caminhão ${c.placa}` : 'Tara do caminhão (vazio)', submit: c.id ? 'Salvar' : 'Salvar tara',
    sub: c.id ? `A tara vale ${TARA_VALIDADE_DIAS} dias a partir da pesagem do caminhão vazio. Toda pesagem vazia na moega atualiza sozinha.`
      : `Pese o caminhão vazio (antes de ir para a lavoura). Quando ele voltar cheio, a Chegada do caminhão fecha o romaneio com esta tara. Vale ${TARA_VALIDADE_DIAS} dias.`,
    values: {placa: c.placa || '', motorista: c.motorista || '', transportadora: c.transportadora || '', tara: c.tara ?? '', taraEm: c.taraEm ? String(c.taraEm).slice(0, 10) : today(), obs: c.obs || ''},
    fields: [{k: 'placa', label: 'Placa', required: true, placeholder: 'ABC1D23'}, {k: 'motorista', label: 'Motorista'}, {k: 'transportadora', label: 'Transportadora / dono do caminhão', full: true},
      {k: 'tara', label: 'Tara — peso do caminhão vazio (kg)', type: 'number', min: 0, required: true}, {k: 'taraEm', label: 'Data da pesagem vazia', type: 'date', required: true, hint: 'Na balança, com tanque e lona como o caminhão costuma vir.'},
      {k: 'obs', label: 'Observações', type: 'textarea', full: true}],
    onSubmit: v => {
      const k = chavePlaca(v.placa); if (k.length < 6) return 'Placa inválida';
      const outro = (db.caminhoes || []).find(x => x.id !== c.id && chavePlaca(x.placa) === k);
      if (outro && c.id) return `A placa ${outro.placa} já está cadastrada`;
      if (outro) { c = outro; v.motorista = v.motorista || outro.motorista || ''; v.transportadora = v.transportadora || outro.transportadora || ''; } // placa já cadastrada: atualiza a tara dela
      if (!(v.tara > 0)) return 'Informe a tara do caminhão vazio';
      if (v.taraEm > today()) return 'A data da pesagem não pode ser no futuro';
      const mudou = Number(c.tara) !== Number(v.tara) || String(c.taraEm || '').slice(0, 10) !== v.taraEm;
      const hist = mudou ? [...(c.historico || []), {em: v.taraEm, kg: Number(v.tara), origem: 'manual', por: quemUsa()}].slice(-20) : c.historico || [];
      upsert('caminhoes', {...c, ...v, id: c.id || uid(), placa: placaFmt(v.placa), tara: Number(v.tara), taraOrigem: mudou ? 'manual' : c.taraOrigem || 'manual', historico: hist, criadoEm: c.criadoEm || Date.now()});
      showToast(`Caminhão ${placaFmt(v.placa)}: tara ${n0(v.tara)} kg`); render();
    }});
}
function blocoCaminhoes() {
  const lista = (db.caminhoes || []).slice().sort((a, b) => String(b.taraEm || '').localeCompare(String(a.taraEm || '')));
  const vencidas = lista.filter(c => taraSituacao(c) && !taraSituacao(c).valida).length;
  return `<section class="card panel tara-bloco"><details ${lista.length && lista.length <= 6 ? 'open' : ''}><summary><span><strong>Caminhões e taras${lista.length ? ` (${lista.length})` : ''}</strong>
      <small>${lista.length ? `Placa com tara de até ${TARA_VALIDADE_DIAS} dias: uma pesagem só (bruto − tara cadastrada)${vencidas ? ` • ${vencidas} vencida${vencidas > 1 ? 's' : ''}` : ''}` : 'Cadastre a tara do caminhão para pesar só uma vez'}</small></span></summary>
    <div class="btn-row" style="margin:6px 0 4px">${btn('+ Caminhão', 'tara-novo', '', 'secondary')}</div>
    ${lista.length ? lista.map(c => { const s = taraSituacao(c);
      return `<div class="hoje-item"><span class="alert-icon ${s?.valida ? 'green' : 'orange'}">🚚</span><div><strong>${esc(c.placa)} • ${s ? n0(s.kg) + ' kg' : 'sem tara'} ${chip(s?.valida ? 'Tara válida' : 'Pesar vazio', s?.valida ? 'green' : 'orange')}</strong><small>${esc([c.motorista, c.transportadora].filter(Boolean).join(' • ') || 'Sem motorista cadastrado')} • ${s ? (s.valida ? `pesado em ${fmtDate(s.em).slice(0, 5)}, vale até ${fmtDate(s.vence).slice(0, 5)}` : `vencida (pesado há ${s.dias} dias)`) : ''}${c.taraOrigem === 'manual' ? ' • digitada' : ''}</small></div>${mini('Editar', 'tara-editar', c.id)}</div>`; }).join('')
      : '<p class="nota" style="margin:0">Os caminhões entram aqui sozinhos quando são pesados vazios na moega. Você também pode cadastrar a tara agora.</p>'}
  </details></section>`;
}
Object.assign(ACTIONS, {
  'tara-novo': () => caminhaoForm(),
  'tara-editar': id => { const c = find('caminhoes', id); if (c) caminhaoForm(c); },
  // Pátio: fechar a pesagem com a tara cadastrada (sem pesar vazio)
  'gr-tara-cad': id => { if (typeof fecharPesagem === 'function') fecharPesagem(id, true); }
});
