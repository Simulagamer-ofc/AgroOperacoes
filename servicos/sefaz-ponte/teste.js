'use strict';
// Testes da ponte: simula a SEFAZ com um servidor HTTPS que exige o certificado do cliente, com certificados gerados
// na hora pelo openssl. (A renegociação TLS, que a SEFAZ usa e o Supabase não faz, é provada em teste-renegociacao.sh.)
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

process.env.PONTE_CHAVE = 'k'.repeat(40);
const {criarServidor} = require('./index.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-'));
const ossl = (...a) => execFileSync('openssl', a, {cwd: dir, stdio: 'pipe'});
ossl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=AC TESTE');
ossl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=localhost');
fs.writeFileSync(path.join(dir, 'ext'), 'subjectAltName=DNS:localhost\n');
ossl('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.crt', '-days', '2', '-extfile', 'ext');
ossl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'cli.key', '-out', 'cli.csr', '-subj', '/CN=FAZENDA TESTE:12345678000195');
ossl('x509', '-req', '-in', 'cli.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'cli.crt', '-days', '2');
ossl('pkcs12', '-export', '-inkey', 'cli.key', '-in', 'cli.crt', '-out', 'cli.pfx', '-passout', 'pass:senha123');
const ler = f => fs.readFileSync(path.join(dir, f));

// "SEFAZ" de mentira: TLS 1.2 e certificado do cliente obrigatório, assinado pela AC de teste
let ultimoSoap = '', ultimoCn = '', ultimaAcao = '';
const sefaz = https.createServer({key: ler('srv.key'), cert: ler('srv.crt'), ca: ler('ca.crt'), maxVersion: 'TLSv1.2', requestCert: true, rejectUnauthorized: true}, (req, res) => {
  ultimoCn = req.socket.getPeerCertificate()?.subject?.CN || '';
  ultimaAcao = req.headers['content-type'] || '';
  let b = ''; req.on('data', d => b += d); req.on('end', () => { ultimoSoap = b; res.writeHead(200, {'Content-Type': 'application/soap+xml'}); res.end('<retDistDFeInt><cStat>137</cStat></retDistDFeInt>'); });
});

let ponte, portaPonte;
test.before(async () => {
  await new Promise(ok => sefaz.listen(0, ok));
  const destino = {url: `https://localhost:${sefaz.address().port}/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`, acao: 'urn:acao-teste'};
  ponte = criarServidor({destinos: {dist: {1: destino, 2: destino}}, opcoesTls: {ca: ler('ca.crt'), port: sefaz.address().port}});
  await new Promise(ok => ponte.listen(0, ok)); portaPonte = ponte.address().port;
});
test.after(() => { ponte.close(); sefaz.close(); fs.rmSync(dir, {recursive: true, force: true}); });

const chamar = (corpo, chave = 'k'.repeat(40)) => fetch(`http://localhost:${portaPonte}/enviar`, {method: 'POST', headers: {'x-ponte-chave': chave, 'Content-Type': 'application/json'}, body: JSON.stringify(corpo)}).then(async r => ({status: r.status, json: await r.json()}));
const pfx = () => ler('cli.pfx').toString('base64');

test('repassa o SOAP à SEFAZ com o certificado A1 e devolve a resposta', async () => {
  const r = await chamar({servico: 'dist', ambiente: 1, soap: '<soap>oi</soap>', pfx: pfx(), senha: 'senha123'});
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 200);
  assert.match(r.json.corpo, /<cStat>137<\/cStat>/);
  assert.equal(ultimoSoap, '<soap>oi</soap>');
  assert.equal(ultimoCn, 'FAZENDA TESTE:12345678000195');
  assert.match(ultimaAcao, /action="urn:acao-teste"/);
});

test('sem a chave da ponte: recusa', async () => {
  const r = await chamar({servico: 'dist', soap: '<a/>', pfx: pfx(), senha: 'senha123'}, 'errada');
  assert.equal(r.status, 401);
});

test('serviço fora da lista: recusa (não aceita endereço de fora)', async () => {
  const r = await chamar({servico: 'http://evil', soap: '<a/>', pfx: pfx(), senha: 'senha123'});
  assert.equal(r.status, 400);
});

test('senha errada do certificado: mensagem clara', async () => {
  const r = await chamar({servico: 'dist', soap: '<a/>', pfx: pfx(), senha: 'errada'});
  assert.equal(r.status, 502);
  assert.match(r.json.erro, /Senha do certificado incorreta/);
});
