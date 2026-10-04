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
  const validadas = BANCO.regras.filter(r => r.statusValidacao === 'validada').map(r => r.id).sort();
  assert.deepEqual(validadas, ['COLH-PERDA-SOJA-01', 'PULV-BICO-CAT-01']);
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
