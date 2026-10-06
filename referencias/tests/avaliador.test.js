'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../avaliador.js');
const BANCO = require('../regras-afericao.json');

const {STATUS, calculos: C} = A;
const quase = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
// Cópia do banco com regras marcadas como validadas — SOMENTE para testar a lógica.
function bancoValidado(ids) {
  const b = JSON.parse(JSON.stringify(BANCO));
  b.regras.forEach(r => { if (!ids || ids.includes(r.id)) Object.assign(r, {statusValidacao: 'validada', validadoPor: 'teste', dataValidacao: '2026-10-04'}); });
  return b;
}

test('banco publicado passa na auditoria; só regras com trecho conferido estão validadas', () => {
  assert.deepEqual(A.auditarBanco(BANCO), []);
  const validadas = BANCO.regras.filter(r => r.statusValidacao === 'validada');
  assert.ok(validadas.length >= 18);
  for (const r of validadas) assert.ok(r.fontes.some(f => f.conferido === true && f.trechoLiteral), r.id);
  assert.ok(['PULV-BICO-MED-01', 'PULV-SENSOR-01'].every(id => BANCO.regras.find(r => r.id === id).statusValidacao !== 'validada'));
  assert.ok(BANCO.tabelasClassificacao.every(t => t.fontes.some(f => f.conferido === true && f.trechoLiteral && f.organizacao === 'MAPA')));
  const iso = BANCO.tabelasReferencia.find(t => t.id === 'ISO10625-CORES');
  assert.equal(iso.linhas.find(l => l.cor === 'amarela').vazao, 0.8);
  assert.equal(iso.linhas.length, 19);
});

test('cálculos de conversão', () => {
  quase(C.taxaAplicacao(0.8, 6, 0.5), 160);
  quase(C.vazaoNecessaria(160, 6, 0.5), 0.8);
  quase(C.vazaoNaPressao(0.8, 3, 4), 0.9238);
  quase(C.velocidade(50, 30), 6);
  quase(C.populacao(14, 0.5), 280000);
  quase(C.xref(14), 7.1429);
  quase(C.doseKgHa(2.5, 50, 0.5), 1000);
  const p = C.perda(30, 2); quase(p.kgHa, 150); quase(p.sc60Ha, 2.5);
  quase(C.cv([10, 12, 14]), 16.6667);
  quase(C.desvio(0.88, 0.8), 10);
  const cls = C.classificarEspacamentos([1, 5, 7, 10, 12], 7); // 3.5 e 10.5 são os limites
  assert.deepEqual([cls.duplos, cls.aceitaveis, cls.falhos], [1, 3, 1]);
  assert.throws(() => C.taxaAplicacao(0.8, 0, 0.5));
  assert.throws(() => C.cv([5]));
});

test('banco real: bicos avaliados pela tabela do fabricante (Embrapa); média da barra só informativa', () => {
  const r = A.avaliarBicos({vazoes: [0.80, 0.82, 0.79, 0.86], vazaoCatalogo: 0.8, pressaoColetaIgualCatalogo: true, mesmoTempoColeta: true, pontasMesmoModelo: true}, BANCO);
  assert.equal(r.status, STATUS.OK);
  assert.equal(r.bicos[3].avaliacaoCatalogo.regraId, 'PULV-BICO-CAT-01');
  assert.equal(r.bicos[3].avaliacaoMedia.status, STATUS.SEM_REFERENCIA); // pendente: não pesa no resultado
  assert.ok(r.bicos[3].avaliacaoCatalogo.fontes[0].trechoLiteral.includes('10%'));
  const gasto = A.avaliarBicos({vazoes: [0.80, 0.89], vazaoCatalogo: 0.8, pressaoColetaIgualCatalogo: true, mesmoTempoColeta: true, pontasMesmoModelo: true}, BANCO);
  assert.equal(gasto.bicos[1].status, STATUS.FORA_DO_PADRAO);
});

test('regras pendentes nunca geram conformidade', () => {
  const r = A.avaliarDistribuicaoTransversal({valoresSobrepostos: [100, 101, 99], fertilizanteNitrogenado: true, cvComSobreposicao: true}, BANCO);
  assert.equal(r.status, STATUS.SEM_REFERENCIA);
  assert.ok(r.pendencias.some(p => p.includes('não conferida')));
});

test('com regra validada: bico desgastado fora do padrão, demais OK', () => {
  const b = bancoValidado();
  const r = A.avaliarBicos({vazoes: [0.80, 0.81, 0.79, 0.92], vazaoCatalogo: 0.8, pressaoColetaIgualCatalogo: true, mesmoTempoColeta: true, pontasMesmoModelo: true}, b);
  assert.equal(r.bicos[0].status, STATUS.OK);
  assert.equal(r.bicos[3].avaliacaoCatalogo.status, STATUS.FORA_DO_PADRAO); // +15% do catálogo
  quase(r.bicos[3].avaliacaoCatalogo.diferenca, 5);
  assert.equal(r.bicos[3].avaliacaoCatalogo.regraId, 'PULV-BICO-CAT-01');
  assert.equal(r.status, STATUS.FORA_DO_PADRAO);
});

test('sem vazão de catálogo ou com pressão diferente não conclui comparação com catálogo', () => {
  const b = bancoValidado();
  const semCat = A.avaliarBicos({vazoes: [0.8, 0.8], mesmoTempoColeta: true, pontasMesmoModelo: true}, b);
  assert.equal(semCat.bicos[0].avaliacaoCatalogo.status, STATUS.DADOS_INSUFICIENTES);
  const pressaoDif = A.avaliarBicos({vazoes: [0.8, 0.8], vazaoCatalogo: 0.8, pressaoColetaIgualCatalogo: false, mesmoTempoColeta: true, pontasMesmoModelo: true}, b);
  assert.equal(pressaoDif.bicos[0].avaliacaoCatalogo.status, STATUS.SEM_REFERENCIA);
  const naoInformado = A.avaliarBicos({vazoes: [0.8, 0.8], vazaoCatalogo: 0.8, mesmoTempoColeta: true, pontasMesmoModelo: true}, b);
  assert.equal(naoInformado.bicos[0].avaliacaoCatalogo.status, STATUS.DADOS_INSUFICIENTES);
});

test('perdas (banco real): média de 5 pontos, 60 kg/ha, só soja', () => {
  const base = {areaM2: 2, incluiGraosEmVagens: true, produto: 'soja'};
  const boa = A.avaliarPerdas({...base, massasG: [10, 12, 8, 11, 9]}, BANCO); // média 10 g/2 m² = 50 kg/ha
  assert.equal(boa.status, STATUS.OK); quase(boa.pttKgHa, 50);
  const ruim = A.avaliarPerdas({...base, massasG: [15, 14, 13, 16, 12], massasPlataformaG: [9, 8, 10, 9, 9]}, BANCO);
  quase(ruim.pttKgHa, 70); quase(ruim.ppcKgHa, 45); quase(ruim.pmiKgHa, 25);
  assert.equal(ruim.status, STATUS.FORA_DO_PADRAO); quase(ruim.avaliacao.diferenca, 10);
  const poucos = A.avaliarPerdas({...base, massasG: [10, 10, 10]}, BANCO);
  assert.equal(poucos.status, STATUS.SEM_REFERENCIA);
  assert.ok(poucos.pendencias.some(p => p.includes('cinco pontos')));
  const plataformaLarga = A.avaliarPerdas({...base, areaM2: 0.22 * 9.1, massasG: [10, 10, 10, 10, 10]}, BANCO);
  assert.equal(plataformaLarga.status, STATUS.OK);
  const milho = A.avaliarPerdas({...base, produto: 'milho', massasG: [10, 10, 10, 10, 10]}, BANCO);
  assert.equal(milho.status, STATUS.SEM_REFERENCIA);
  assert.ok(milho.pendencias.some(p => p.includes('milho')));
  const semProduto = A.avaliarPerdas({areaM2: 2, incluiGraosEmVagens: true, massasG: [10, 10, 10, 10, 10]}, BANCO);
  assert.equal(semProduto.status, STATUS.DADOS_INSUFICIENTES);
  const semVagens = A.avaliarPerdas({...base, incluiGraosEmVagens: undefined, massasG: [10, 10, 10, 10, 10]}, BANCO);
  assert.equal(semVagens.status, STATUS.DADOS_INSUFICIENTES);
});

test('distribuidor a lanço: escolhe limite pela condição nitrogenado', () => {
  const b = bancoValidado();
  const vals = [100, 120, 80, 110, 90]; // CV ≈ 15,8%
  const n = A.avaliarDistribuicaoTransversal({valoresSobrepostos: vals, fertilizanteNitrogenado: true, cvComSobreposicao: true}, b);
  assert.equal(n.status, STATUS.FORA_DO_PADRAO); assert.equal(n.avaliacao.regraId, 'ADUB-CV-N-01');
  const k = A.avaliarDistribuicaoTransversal({valoresSobrepostos: vals, fertilizanteNitrogenado: false, cvComSobreposicao: true}, b);
  assert.equal(k.status, STATUS.OK); assert.equal(k.avaliacao.regraId, 'ADUB-CV-OUT-01');
  const sem = A.avaliarDistribuicaoTransversal({valoresSobrepostos: vals, cvComSobreposicao: true}, b);
  assert.equal(sem.status, STATUS.DADOS_INSUFICIENTES);
});

test('semeadora: classifica e exige amostra mínima', () => {
  const b = bancoValidado();
  const boa = Array.from({length: 60}, () => 7.1);
  const r = A.avaliarDistribuicaoLongitudinal({sementesPorMetro: 14, espacamentos: boa}, b);
  assert.equal(r.status, STATUS.OK); assert.equal(r.pctAceitaveis, 100);
  const pouca = A.avaliarDistribuicaoLongitudinal({sementesPorMetro: 14, espacamentos: boa.slice(0, 20)}, b);
  assert.equal(pouca.status, STATUS.SEM_REFERENCIA);
  const ruim = A.avaliarDistribuicaoLongitudinal({sementesPorMetro: 14, espacamentos: [...boa.slice(0, 45), ...Array(15).fill(2)]}, b);
  assert.equal(ruim.status, STATUS.FORA_DO_PADRAO); assert.equal(ruim.duplos, 15);
});

test('taxa e dose sem tolerância documentada: calcula, mas não conclui', () => {
  const b = bancoValidado();
  const t = A.avaliarTaxaAplicacao({vazaoMediaBico: 0.8, velocidadeKmH: 6, espacamentoBicosM: 0.5, taxaPlanejada: 150}, b);
  quase(t.taxaLHa, 160); quase(t.desvio, 6.67, 0.01); assert.equal(t.status, STATUS.SEM_REFERENCIA);
  const d = A.avaliarDose({massaKg: 2.5, distanciaM: 50, larguraM: 0.5, dosePlanejada: 1000, equipamentoFamilia: 'adubadora_linha'}, b);
  quase(d.doseKgHa, 1000); assert.equal(d.status, STATUS.SEM_REFERENCIA);
});

test('sensor: ponto obrigatório, unidade e escopo verificados', () => {
  const b = bancoValidado();
  const ok = A.avaliarSensor({ponto: 'sensor_velocidade', leituraControlador: 6.2, referencia: 6.0, comparadoComInstrumentoReferencia: true}, b);
  assert.equal(ok.status, STATUS.OK); quase(ok.valorMedido, 3.33, 0.01);
  const fora = A.avaliarSensor({ponto: 'fluxometro', leituraControlador: 10.8, referencia: 10, comparadoComInstrumentoReferencia: true}, b);
  assert.equal(fora.status, STATUS.FORA_DO_PADRAO);
  const semPonto = A.avaliarSensor({leituraControlador: 6.2, referencia: 6.0, comparadoComInstrumentoReferencia: true}, b);
  assert.equal(semPonto.status, STATUS.DADOS_INSUFICIENTES);
  const outraMaquina = A.avaliarSensor({equipamentoFamilia: 'semeadora_precisao', ponto: 'sensor_velocidade', leituraControlador: 6.2, referencia: 6, comparadoComInstrumentoReferencia: true}, b);
  assert.equal(outraMaquina.status, STATUS.SEM_REFERENCIA);
});

test('unidade diferente não é convertida nem comparada', () => {
  const b = bancoValidado();
  const r = A.avaliar({equipamentoFamilia: 'colhedora', produto: 'soja', etapa: 'colheita', ponto: 'atras_colhedora', variavel: 'perda_total', unidade: 'sc60/ha', valor: 0.5, condicoes: {areaAmostralM2: 2, numeroPontos: 5, incluiGraosEmVagens: true}}, b);
  assert.equal(r.status, STATUS.SEM_REFERENCIA);
});

test('variável sem regra e valor ausente', () => {
  assert.equal(A.avaliar({variavel: 'temperatura_ar_entrada', unidade: '°C', valor: 160}, BANCO).status, STATUS.SEM_REFERENCIA);
  assert.equal(A.avaliar({variavel: 'perda_total', unidade: 'kg/ha'}, BANCO).status, STATUS.DADOS_INSUFICIENTES);
});

test('regras validadas conflitantes não concluem', () => {
  const b = bancoValidado();
  b.regras.push({...b.regras.find(r => r.id === 'COLH-PERDA-SOJA-01'), id: 'COLH-PERDA-SOJA-X', limiteMax: 90});
  const r = A.avaliarPerdas({massasG: [10, 10, 10, 10, 10], areaM2: 2, produto: 'soja', incluiGraosEmVagens: true}, b);
  assert.equal(r.status, STATUS.SEM_REFERENCIA);
  assert.ok(r.pendencias[0].includes('conflitantes'));
});

test('resultado congelado preserva regra, versão e limites mesmo se o banco mudar', () => {
  const b = bancoValidado();
  const r = A.avaliarPerdas({massasG: [10, 10, 10, 10, 10], areaM2: 2, produto: 'soja', incluiGraosEmVagens: true}, b, {dataAnalise: '2026-10-04T12:00:00Z'});
  const salvo = A.congelar(r.avaliacao);
  b.regras.find(x => x.id === 'COLH-PERDA-SOJA-01').limiteMax = 1;
  assert.equal(salvo.limiteMax, 60); assert.equal(salvo.regraVersao, '1.1.0'); assert.equal(salvo.dataAnalise, '2026-10-04T12:00:00Z');
  assert.ok(Object.isFrozen(salvo) && Object.isFrozen(salvo.fontes));
});

test('regra suspensa é ignorada; validada sem responsável é apontada na auditoria', () => {
  const b = bancoValidado(['COLH-PERDA-SOJA-01']);
  b.regras.find(r => r.id === 'COLH-PERDA-SOJA-01').statusValidacao = 'suspensa';
  assert.equal(A.avaliarPerdas({massasG: [10, 10, 10, 10, 10], areaM2: 2, produto: 'soja', incluiGraosEmVagens: true}, b).status, STATUS.SEM_REFERENCIA);
  const c = JSON.parse(JSON.stringify(BANCO)); c.regras.find(r => r.id === 'ADUB-CV-N-01').statusValidacao = 'validada';
  assert.ok(A.auditarBanco(c).some(p => p.includes('validadoPor')));
});

test('catálogo de modelos: estrutura, ids únicos e origem declarada', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '..', 'modelos');
  const indice = JSON.parse(fs.readFileSync(path.join(dir, 'indice.json'), 'utf8'));
  let total = 0;
  for (const m of indice.marcas) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', m.arquivo), 'utf8'));
    assert.equal(d.modelos.length, m.totalModelos);
    const ids = new Set();
    for (const x of d.modelos) {
      assert.ok(x.id && x.marca && x.modelo && x.url && x.dataConsulta, `campos obrigatórios: ${x.id}`);
      assert.ok(!ids.has(x.id), `id duplicado ${x.id}`); ids.add(x.id);
      if (x.especificacoes.length) assert.ok(x.origemEspecificacoes, `origem ausente: ${x.id}`);
      for (const e of x.especificacoes) assert.ok(e.campo && typeof e.valor === 'string' && !e.valor.includes('\n'));
    }
    total += d.modelos.length;
  }
  assert.ok(total > 700);
});

test('lista BNDES/FINAME: estrutura, CNPJ e códigos válidos', () => {
  const fs = require('node:fs'), path = require('node:path');
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bndes', 'produtos-agricolas-finame.json'), 'utf8'));
  assert.ok(d.fonte.dataFechamentoLista && d.totalProdutos > 10000);
  let n = 0;
  for (const f of d.fabricantes) {
    assert.match(f.cnpj, /^\d{14}$/);
    for (const p of f.produtos) { assert.match(p.codigoFiname, /^\d{7}$/); assert.ok(p.nome && p.classificacoes.length); n++; }
  }
  assert.equal(n, d.totalProdutos);
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogo-fabricantes.json'), 'utf8'));
  const tatu = cat.fabricantes.find(f => f.nome === 'Tatu Marchesan');
  assert.equal(tatu.cnpj, '52311289000163'); // mesmo CNPJ usado pelo site da Tatu no link do BNDES
});

test('dados do aplicativo sincronizados com referencias/ (rode ferramentas/gerar_dados_app.py)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const www = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
  assert.equal(fs.readFileSync(path.join(www, 'avaliador.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'avaliador.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(www, 'dados', 'regras-afericao.json'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'regras-afericao.json'), 'utf8'));
  const cat = JSON.parse(fs.readFileSync(path.join(www, 'dados', 'catalogo-modelos.json'), 'utf8'));
  const indice = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'modelos', 'indice.json'), 'utf8'));
  assert.equal(cat.modelos.length, indice.marcas.reduce((s, m) => s + m.totalModelos, 0));
  const fin = JSON.parse(fs.readFileSync(path.join(www, 'dados', 'finame.json'), 'utf8'));
  assert.equal(fin.produtos.length, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bndes', 'produtos-agricolas-finame.json'), 'utf8')).totalProdutos);
});


// ---------------- Secador, moega e armazenagem ----------------
const sec = (d) => A.avaliarSecagem(d, BANCO);
const L = (ponto, variavel, valor) => ({ponto, variavel, valor});

test('ESPECIFICAÇÃO: soja semente, ar de entrada 160 °C → não foi possível avaliar', () => {
  const r = sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [{...L('ar_entrada', 'temperatura', 160), posicao: 'superior'}]});
  assert.equal(r.status, STATUS.SEM_REFERENCIA);
  assert.ok(r.pendencias.some(p => p.includes('ponto medido "ar_entrada"')));
});

test('limite da massa de grãos nunca é aplicado ao ar de entrada', () => {
  const massa = sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [L('massa_graos', 'temperatura', 41)]});
  assert.equal(massa.status, STATUS.FORA_DO_PADRAO); assert.equal(massa.leituras[0].avaliacao.regraId, 'SEC-SOJA-SEM-MASSA-01');
  assert.equal(sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [L('massa_graos', 'temperatura', 40)]}).status, STATUS.OK);
  assert.equal(sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [L('ar_entrada', 'temperatura', 41)]}).status, STATUS.SEM_REFERENCIA);
  // agroindústria tem outro limite (48 °C)
  assert.equal(sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'agroindustria', etapa: 'secagem', leituras: [L('massa_graos', 'temperatura', 45)]}).status, STATUS.OK);
});

test('regra substituída (38 °C, 2005) não gera conflito nem conclusão', () => {
  const r = sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [L('massa_graos', 'temperatura', 39)]});
  assert.equal(r.status, STATUS.OK); assert.equal(r.leituras[0].avaliacao.regraId, 'SEC-SOJA-SEM-MASSA-01');
});

test('milho: limite do ar de secagem depende do destino', () => {
  const m = (destino, v) => sec({equipamentoFamilia: 'secador', produto: 'milho', destino, etapa: 'secagem', leituras: [L('ar_entrada', 'temperatura', v)]}).status;
  assert.equal(m('semente', 50), STATUS.FORA_DO_PADRAO); assert.equal(m('semente', 44), STATUS.OK);
  assert.equal(m('moagem_alimentacao_humana', 50), STATUS.OK); assert.equal(m('racao_animal', 80), STATUS.OK); assert.equal(m('racao_animal', 85), STATUS.FORA_DO_PADRAO);
  assert.equal(sec({equipamentoFamilia: 'secador', produto: 'milho', destino: 'semente', etapa: 'secagem', leituras: [L('massa_graos', 'temperatura', 50)]}).status, STATUS.SEM_REFERENCIA);
});

test('umidade: limite exclusivo "abaixo de 14%" e destino/etapa obrigatórios', () => {
  const u = (o) => sec({equipamentoFamilia: 'secador', produto: 'soja', etapa: 'pos_secagem', ...o, leituras: [L('amostra', 'umidade_graos', o.v)]});
  assert.equal(u({destino: 'agroindustria', v: 14}).status, STATUS.FORA_DO_PADRAO);
  assert.equal(u({destino: 'agroindustria', v: 13.9}).status, STATUS.OK);
  assert.equal(u({destino: 'comercializacao', v: 13}).status, STATUS.SEM_REFERENCIA); // norma do MAPA só no recebimento
  assert.equal(u({destino: undefined, v: 13}).status, STATUS.DADOS_INSUFICIENTES);
  const moega = sec({equipamentoFamilia: 'moega', produto: 'soja', destino: 'agroindustria', etapa: 'recebimento', leituras: [L('amostra', 'umidade_graos', 18)]});
  assert.equal(moega.status, STATUS.FORA_DO_PADRAO); assert.equal(moega.leituras[0].avaliacao.regraId, 'COM-SOJA-UMID-01'); // IN 11, Art. 4º, § 4º
});

test('semente armazenada: umidade por região e embalagem', () => {
  const s = (cond, v) => sec({equipamentoFamilia: 'armazem', produto: 'soja', destino: 'semente', etapa: 'armazenamento', condicoes: cond, leituras: [L('amostra', 'umidade_graos', v)]});
  assert.equal(s({}, 11).status, STATUS.DADOS_INSUFICIENTES);
  assert.equal(s({regiaoArmazenamento: 'cerrados', embalagem: 'sacaria'}, 11.5).status, STATUS.OK);
  assert.equal(s({regiaoArmazenamento: 'cerrados', embalagem: 'sacaria'}, 11.8).status, STATUS.FORA_DO_PADRAO);
  assert.equal(s({regiaoArmazenamento: 'cerrados', embalagem: 'big_bag'}, 10.6).status, STATUS.FORA_DO_PADRAO);
  assert.equal(s({regiaoArmazenamento: 'sul', embalagem: 'sacaria'}, 13.4).status, STATUS.OK);
  const t = sec({equipamentoFamilia: 'armazem', produto: 'soja', destino: 'semente', etapa: 'armazenamento', leituras: [L('massa_graos', 'temperatura', 25)]});
  assert.equal(t.status, STATUS.FORA_DO_PADRAO); // "abaixo de 25 ºC"
});

test('secador estático: UR do ar ≥ 35% só com o tipo de secador informado', () => {
  const s = (tipo, v) => sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', condicoes: {tipoSecador: tipo}, leituras: [L('ar_entrada', 'umidade_relativa_ar', v)]}).status;
  assert.equal(s('estatico', 30), STATUS.FORA_DO_PADRAO); assert.equal(s('estatico', 40), STATUS.OK);
  assert.equal(s('continuo', 30), STATUS.SEM_REFERENCIA); assert.equal(s(undefined, 30), STATUS.DADOS_INSUFICIENTES);
});

test('várias leituras: pior resultado prevalece; cálculos de umidade e quebra', () => {
  const r = sec({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', umidadeInicial: 18, umidadeFinal: 12, umidadeMeta: 12.5, massaInicial: 1000,
    leituras: [L('massa_graos', 'temperatura', 39), L('ar_entrada', 'temperatura', 70)]});
  assert.equal(r.status, STATUS.SEM_REFERENCIA); // ar de entrada sem referência impede conclusão geral
  assert.equal(r.leituras[0].avaliacao.status, STATUS.OK);
  assert.equal(r.calculos.reducaoUmidadePP, 6); assert.equal(r.calculos.diferencaMetaPP, -0.5);
  quase(r.calculos.massaFinalEstimada, 931.818, 0.01); quase(r.calculos.quebraPct, 6.82, 0.01);
});

test('soja IN 11/2007: tabelas oficiais conferidas e enquadramento pelo pior tipo', () => {
  const t = id => BANCO.tabelasClassificacao.find(x => x.id === id);
  assert.deepEqual(t('CLA-SOJA-IN11-GII').tipos[0].limites, {ardidos_queimados: 4, queimados: 1, mofados: 6, avariados_total: 8, esverdeados: 8, quebrados: 30, impurezas: 1});
  assert.deepEqual(t('CLA-SOJA-IN11-GI').tipos.map(x => x.limites.quebrados), [8, 15]);
  const c = (grupo, valores) => A.classificarGraos({produto: 'soja', destino: 'comercializacao', etapa: 'recebimento', grupo, valores}, BANCO);
  const base = {avariados_total: 3, ardidos_queimados: 0.8, queimados: 0.2, mofados: 0.4, esverdeados: 1.5, quebrados: 7, impurezas: 0.9};
  assert.equal(c('I', base).enquadramento, 'Tipo 1');
  assert.equal(c('I', {...base, quebrados: 9}).enquadramento, 'Tipo 2'); // pior defeito decide (Art. 27)
  const fora = c('I', {...base, esverdeados: 4.1});
  assert.equal(fora.status, STATUS.FORA_DO_PADRAO); assert.equal(fora.enquadramento, 'Fora de Tipo');
  assert.ok(fora.consequencias.some(x => x.includes('§ 3º'))); // esverdeados = defeito leve
  assert.equal(c('II', {...base, quebrados: 30}).enquadramento, 'Padrão Básico'); // limite inclusivo
  assert.equal(c('II', {...base, avariados_total: 7.96}).enquadramento, 'Padrão Básico'); // 1 casa decimal (Art. 25, VII)
  assert.equal(c('II', {...base, avariados_total: 8.05}).enquadramento, 'Fora do Padrão Básico');
  // defeitos graves = ardidos e queimados + mofados; > 40% desclassifica (Grupo II), > 12% (Grupo I)
  const g = {...base, avariados_total: 45, ardidos_queimados: 30, queimados: 1, mofados: 11};
  assert.equal(c('II', g).enquadramento, 'Desclassificado');
  assert.equal(c('II', {...g, mofados: 10}).enquadramento, 'Fora do Padrão Básico');
  assert.equal(c('I', {...base, avariados_total: 13, ardidos_queimados: 10, queimados: 1, mofados: 2.1}).enquadramento, 'Desclassificado');
  // grupo é obrigatório; defeito faltando e valores incoerentes impedem concluir
  assert.equal(c(undefined, base).status, STATUS.DADOS_INSUFICIENTES);
  const falta = c('II', {quebrados: 12});
  assert.equal(falta.status, STATUS.DADOS_INSUFICIENTES); assert.equal(falta.enquadramento, null);
  assert.equal(c('II', {...base, queimados: 2}).status, STATUS.DADOS_INSUFICIENTES); // queimados > ardidos e queimados
  // fora do escopo: semente, outra etapa
  assert.equal(A.classificarGraos({produto: 'soja', destino: 'semente', etapa: 'recebimento', grupo: 'II', valores: base}, BANCO).status, STATUS.SEM_REFERENCIA);
  assert.equal(A.classificarGraos({produto: 'soja', destino: 'comercializacao', etapa: 'armazenamento', grupo: 'II', valores: base}, BANCO).status, STATUS.SEM_REFERENCIA);
});

test('milho IN 60/2011: tipos 1–3, Fora de Tipo e desclassificação', () => {
  const c = valores => A.classificarGraos({produto: 'milho', destino: 'racao_animal', etapa: 'recebimento', valores}, BANCO);
  const base = {avariados_total: 5, ardidos: 0.8, quebrados: 2.5, impurezas: 0.9, carunchados: 1.5};
  assert.equal(c(base).enquadramento, 'Tipo 1');
  assert.equal(c({...base, impurezas: 1.5}).enquadramento, 'Tipo 2');
  assert.equal(c({...base, avariados_total: 15}).enquadramento, 'Tipo 3');
  const q = c({...base, quebrados: 5.01});
  assert.equal(q.enquadramento, 'Fora de Tipo'); assert.ok(q.consequencias[0].includes('não pode ser comercializado como se apresenta'));
  assert.ok(c({...base, carunchados: 6}).consequencias[0].includes('pode ser comercializado como se apresenta'));
  assert.equal(c({...base, ardidos: 5.01, avariados_total: 10}).enquadramento, 'Desclassificado');
  assert.equal(c({...base, carunchados: 8}).enquadramento, 'Fora de Tipo'); // 8,00 ainda é Fora de Tipo
  assert.equal(c({avariados_total: 21}).enquadramento, 'Desclassificado'); // desclassifica mesmo com dados parciais
  assert.equal(c({...base, ardidos: 6, avariados_total: 5}).status, STATUS.DADOS_INSUFICIENTES); // ardidos > total
});

test('moega: classificação integrada à leitura; umidade de comercialização conferida (14%)', () => {
  const m = (d) => sec({equipamentoFamilia: 'moega', etapa: 'recebimento', ...d});
  const r = m({produto: 'soja', destino: 'armazenamento_graos', leituras: [L('amostra', 'umidade_graos', 15)],
    classificacao: {grupo: 'II', valores: {avariados_total: 3, ardidos_queimados: 1, queimados: 0.1, mofados: 0.5, esverdeados: 2, quebrados: 10, impurezas: 0.5}}});
  assert.equal(r.classificacao.enquadramento, 'Padrão Básico');
  assert.equal(r.leituras[0].avaliacao.regraId, 'COM-SOJA-UMID-01'); assert.equal(r.leituras[0].avaliacao.status, STATUS.FORA_DO_PADRAO);
  assert.equal(r.status, STATUS.FORA_DO_PADRAO);
  const so = m({produto: 'milho', destino: 'comercializacao', leituras: [], classificacao: {valores: {avariados_total: 5, ardidos: 0.8, quebrados: 2.5, impurezas: 0.9, carunchados: 1.5}}});
  assert.equal(so.status, STATUS.OK); assert.ok(!so.pendencias.includes('Nenhuma leitura informada.'));
  assert.equal(m({produto: 'milho', destino: 'comercializacao', leituras: [L('amostra', 'umidade_graos', 14)]}).status, STATUS.OK); // "até 14,0%"
  // regras antigas de 0.5.0 suspensas, mas mantidas no banco
  assert.ok(['CLA-SOJA-AVAR-01', 'CLA-SOJA-QUEB-01', 'CLA-SOJA-IMPUR-01'].every(id => BANCO.regras.find(x => x.id === id).statusValidacao === 'suspensa'));
});

test('descontos da carga na moega: balanço de massa, tabela do comprador e nenhum padrão assumido', () => {
  // 30 000 kg, impureza 2% (padrão 1%), umidade 16% (padrão 14%)
  const r = A.descontosCarga({pesoLiquido: 30000, impureza: 2, impurezaPadrao: 1, umidade: 16, umidadePadrao: 14});
  assert.equal(r.status, STATUS.OK);
  const limpo = 30000 * 98 / 99, seco = limpo * 84 / 86;
  quase(r.linhas[0].descontoKg, 30000 - limpo);              // 303,03 kg
  quase(r.linhas[1].descontoKg, limpo - seco);               // 690,55 kg
  quase(r.linhas[1].percentual, (16 - 14) / (100 - 14) * 100); // F-DESC-UMIDADE: 2,3256%
  quase(r.pesoFinalKg, seco); quase(r.sacas60, seco / 60);
  // abaixo do padrão: sem desconto e sem acréscimo
  const b = A.descontosCarga({pesoLiquido: 1000, umidade: 12, umidadePadrao: 14});
  assert.equal(b.linhas[0].descontoKg, 0); assert.equal(b.pesoFinalKg, 1000);
  // percentual da tabela do comprador tem prioridade
  const t = A.descontosCarga({pesoLiquido: 1000, umidade: 16, umidadePadrao: 14, descUmidadePct: 3, outrosPct: 1, pesoRomaneio: 960});
  assert.equal(t.linhas[0].metodo, 'tabela_comprador'); quase(t.linhas[0].descontoKg, 30); quase(t.linhas[1].descontoKg, 9.7); quase(t.pesoFinalKg, 960.3); quase(t.diferencaRomaneioKg, -0.3);
  // sem padrão: não calcula e pede o dado (nunca assume 14%)
  const s = A.descontosCarga({pesoLiquido: 1000, umidade: 16});
  assert.equal(s.status, STATUS.DADOS_INSUFICIENTES); assert.equal(s.linhas.length, 0); assert.equal(s.pesoFinalKg, 1000);
  assert.equal(A.descontosCarga({umidade: 16, umidadePadrao: 14}).status, STATUS.DADOS_INSUFICIENTES);
});

test('revisão: entradas inválidas devolvem pendência em vez de travar', () => {
  const b = bancoValidado();
  const s = A.avaliarSecagem({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [], massaInicial: 1000, umidadeInicial: -1, umidadeFinal: 13}, BANCO);
  assert.ok(s.pendencias.some(p => p.includes('entre 0 e 100%')) && s.calculos.massaFinalEstimada === undefined);
  const s2 = A.avaliarSecagem({equipamentoFamilia: 'secador', produto: 'soja', destino: 'semente', etapa: 'secagem', leituras: [], massaInicial: 1000, umidadeInicial: 12, umidadeFinal: 14}, BANCO);
  assert.ok(s2.pendencias.some(p => p.includes('maior que a inicial')) && s2.calculos.quebraMassa === undefined);
  assert.equal(A.avaliarDistribuicaoTransversal({valoresSobrepostos: [0, 0, 0]}, b).status, STATUS.DADOS_INSUFICIENTES);
  assert.equal(A.avaliarDistribuicaoTransversal({valoresSobrepostos: [-5, 10, 12]}, b).status, STATUS.DADOS_INSUFICIENTES);
  const p = A.avaliarPerdas({massasG: [10, 10, 10, 10, 10], massasPlataformaG: [20, 20, 20, 20, 20], areaM2: 2, produto: 'soja'}, b);
  assert.equal(p.pmiKgHa, null); assert.ok(p.pendencias.some(x => x.includes('PMI não calculada')));
  assert.equal(A.classificarGraos({produto: 'soja', valores: {impurezas: 1}}, BANCO).status, STATUS.DADOS_INSUFICIENTES);
  const quebrado = JSON.parse(JSON.stringify(BANCO)); delete quebrado.tabelasClassificacao[0].defeitos; quebrado.tabelasClassificacao[1].tipos[0].limites = undefined;
  assert.doesNotThrow(() => A.auditarBanco(quebrado));
});

test('revisão: limite comparado com o valor medido sem arredondar; conflitos e regra específica avisados', () => {
  const regra = (id, extra = {}) => ({id, versao: '1.0.0', titulo: id, equipamentoFamilia: '*', avaliacao: 'x', produto: '*', destino: '*', etapa: '*', ponto: '*', posicao: '*',
    variavel: 'v', unidade: '%', limiteMin: -10, limiteMax: 10, condicoes: [], fontes: [{conferido: true, trechoLiteral: 't'}], statusValidacao: 'validada', ...extra});
  const banco = r => ({versaoBanco: 't', regras: r});
  const av = (b, valor, cond = {}) => A.avaliar({variavel: 'v', unidade: '%', valor, condicoes: cond}, b);
  const b1 = banco([regra('R1')]);
  assert.equal(av(b1, 10.004).status, STATUS.FORA_DO_PADRAO);   // antes: 10,00 → OK
  assert.equal(av(b1, -10.005).status, STATUS.FORA_DO_PADRAO);  // antes: −10,00 → OK
  assert.equal(av(b1, 10).status, STATUS.OK);
  assert.equal(av(b1, 10.004).valorMedido, 10.004);
  // mesma faixa, um exclusivo e outro não → conflito
  const b2 = banco([regra('R1'), regra('R2', {limiteMaxExclusivo: true})]);
  assert.equal(av(b2, 10).status, STATUS.SEM_REFERENCIA);
  // regra específica validada com condição não respondida → aviso
  const b3 = banco([regra('GERAL', {limiteMin: null, limiteMax: 25}), regra('ESPEC', {limiteMin: null, limiteMax: 15, condicoes: [{campo: 'nitrogenado', operador: 'igual', valor: true, descricao: 'Produto nitrogenado.'}]})]);
  const r3 = av(b3, 20);
  assert.equal(r3.status, STATUS.OK); assert.ok(r3.pendencias.some(p => p.includes('outra referência validada')));
});
