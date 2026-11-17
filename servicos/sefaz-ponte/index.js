'use strict';
/* MercaPlant — ponte para a SEFAZ (Netlify Functions ou Google Cloud Run).
   Por que existe: a SEFAZ pede o certificado do cliente por renegociação TLS, e o servidor do Supabase (Deno/rustls)
   não faz renegociação. O Node (OpenSSL) faz. Esta ponte só repassa a mensagem SOAP já pronta para a SEFAZ e devolve
   a resposta. Ela NÃO guarda nada: o certificado vem em cada chamada (do Vault do Supabase), fica só na memória
   durante a conexão e não é registrado em log.
   Segurança: só aceita chamadas com a chave PONTE_CHAVE (cabeçalho x-ponte-chave) e só fala com os endereços fixos
   da SEFAZ abaixo (não aceita endereço vindo de fora). */
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const CHAVE = () => process.env.PONTE_CHAVE || '';
const PORTA = Number(process.env.PORT || 8080);
const MAX_CORPO = 6 * 1024 * 1024; // pedido (SOAP + certificado)
const MAX_RESPOSTA = 20 * 1024 * 1024; // resposta da SEFAZ (até 50 documentos compactados)

// Serviços do Ambiente Nacional (tpAmb 1 = produção, 2 = homologação)
const DESTINOS = {
  dist: {
    1: {url: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', acao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'},
    2: {url: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', acao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'},
  },
  evento: {
    1: {url: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', acao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento'},
    2: {url: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', acao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento'},
  },
};

const responder = (res, status, corpo) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(corpo)); };
function chaveOk(recebida) {
  const k = CHAVE();
  if (!k || k.length < 32 || typeof recebida !== 'string') return false;
  const a = crypto.createHash('sha256').update(recebida).digest(), b = crypto.createHash('sha256').update(k).digest();
  return crypto.timingSafeEqual(a, b);
}

// Envia o SOAP à SEFAZ com o certificado A1 (pfx + senha). Devolve {status, corpo}.
function enviarSefaz(destino, soap, pfx, senha, opcoes = {}) {
  return new Promise((ok, falha) => {
    const u = new URL(destino.url);
    const req = https.request({
      host: u.hostname, path: u.pathname, port: 443, method: 'POST', pfx, passphrase: senha,
      minVersion: 'TLSv1.2', timeout: 60000, agent: false, ...opcoes,
      headers: {'Content-Type': `application/soap+xml; charset=utf-8; action="${destino.acao}"`, 'Content-Length': Buffer.byteLength(soap)},
    }, r => {
      const partes = []; let total = 0;
      r.on('data', c => { total += c.length; if (total > MAX_RESPOSTA) { req.destroy(new Error('Resposta da SEFAZ grande demais')); return; } partes.push(c); });
      r.on('end', () => ok({status: r.statusCode, corpo: Buffer.concat(partes).toString('utf8')}));
    });
    req.on('timeout', () => req.destroy(new Error('A SEFAZ não respondeu em 60 segundos')));
    req.on('error', falha);
    req.end(soap);
  });
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > MAX_CORPO) { falha(Object.assign(new Error('Pedido grande demais'), {status: 413})); req.destroy(); return; } partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

// Trata um pedido já lido (usado pelo servidor do Cloud Run e pela função do Netlify). Devolve {status, corpo}.
async function atender({metodo, caminho, chave, corpoTexto}, {destinos = DESTINOS, opcoesTls = {}} = {}) {
  try {
    if (metodo === 'GET' && caminho === '/saude') return {status: 200, corpo: {ok: true}};
    if (metodo !== 'POST' || caminho !== '/enviar') return {status: 404, corpo: {erro: 'Não encontrado'}};
    if (!chaveOk(chave)) return {status: 401, corpo: {erro: 'Chave inválida'}};
    if (Buffer.byteLength(corpoTexto || '') > MAX_CORPO) return {status: 413, corpo: {erro: 'Pedido grande demais'}};
    let b;
    try { b = JSON.parse(corpoTexto); } catch { return {status: 400, corpo: {erro: 'Pedido inválido'}}; }
    const destino = destinos[b?.servico]?.[Number(b?.ambiente) === 2 ? 2 : 1];
    if (!destino) return {status: 400, corpo: {erro: 'Serviço inválido'}};
    if (typeof b.soap !== 'string' || !b.soap.startsWith('<') || typeof b.pfx !== 'string' || typeof b.senha !== 'string') return {status: 400, corpo: {erro: 'Pedido incompleto'}};
    const r = await enviarSefaz(destino, b.soap, Buffer.from(b.pfx, 'base64'), b.senha, opcoesTls);
    return {status: 200, corpo: {status: r.status, corpo: r.corpo}};
  } catch (e) {
    // Sem detalhes do certificado no log: só o tipo do erro
    const msg = /mac verify|bad decrypt|PKCS12/i.test(String(e?.message)) ? 'Senha do certificado incorreta ou arquivo inválido'
      : /ECONNRESET|socket hang up/i.test(String(e?.message)) ? 'A SEFAZ recusou a conexão (certificado não aceito ou vencido)'
      : String(e?.message || 'Erro').slice(0, 200);
    console.error('falha', e?.code || '', msg);
    return {status: 502, corpo: {erro: msg}};
  }
}

function criarServidor(opcoes = {}) {
  return http.createServer(async (req, res) => {
    let corpoTexto = '';
    if (req.method === 'POST') {
      try { corpoTexto = await lerCorpo(req); } catch (e) { return responder(res, e.status || 400, {erro: e.status ? e.message : 'Pedido inválido'}); }
    }
    const r = await atender({metodo: req.method, caminho: req.url, chave: req.headers['x-ponte-chave'], corpoTexto}, opcoes);
    return responder(res, r.status, r.corpo);
  });
}

if (require.main === module) {
  if (CHAVE().length < 32) { console.error('Defina PONTE_CHAVE (32 caracteres ou mais).'); process.exit(1); }
  criarServidor().listen(PORTA, () => console.log('ponte SEFAZ ouvindo na porta', PORTA));
}
module.exports = {criarServidor, atender, chaveOk, DESTINOS};
