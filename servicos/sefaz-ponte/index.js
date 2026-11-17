'use strict';
/* MercaPlant — ponte para a SEFAZ (Google Cloud Run).
   Por que existe: a SEFAZ pede o certificado do cliente por renegociação TLS, e o servidor do Supabase (Deno/rustls)
   não faz renegociação. O Node (OpenSSL) faz. Esta ponte só repassa a mensagem SOAP já pronta para a SEFAZ e devolve
   a resposta. Ela NÃO guarda nada: o certificado vem em cada chamada (do Vault do Supabase), fica só na memória
   durante a conexão e não é registrado em log.
   Segurança: só aceita chamadas com a chave PONTE_CHAVE (cabeçalho x-ponte-chave) e só fala com os endereços fixos
   da SEFAZ abaixo (não aceita endereço vindo de fora). */
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const CHAVE = process.env.PONTE_CHAVE || '';
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
  if (!CHAVE || CHAVE.length < 32 || typeof recebida !== 'string') return false;
  const a = crypto.createHash('sha256').update(recebida).digest(), b = crypto.createHash('sha256').update(CHAVE).digest();
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

function criarServidor({destinos = DESTINOS, opcoesTls = {}} = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/saude') return responder(res, 200, {ok: true});
      if (req.method !== 'POST' || req.url !== '/enviar') return responder(res, 404, {erro: 'Não encontrado'});
      if (!chaveOk(req.headers['x-ponte-chave'])) return responder(res, 401, {erro: 'Chave inválida'});
      let b;
      try { b = JSON.parse(await lerCorpo(req)); } catch (e) { return responder(res, e.status || 400, {erro: e.status ? e.message : 'Pedido inválido'}); }
      const destino = destinos[b?.servico]?.[Number(b?.ambiente) === 2 ? 2 : 1];
      if (!destino) return responder(res, 400, {erro: 'Serviço inválido'});
      if (typeof b.soap !== 'string' || !b.soap.startsWith('<') || typeof b.pfx !== 'string' || typeof b.senha !== 'string') return responder(res, 400, {erro: 'Pedido incompleto'});
      const pfx = Buffer.from(b.pfx, 'base64');
      const r = await enviarSefaz(destino, b.soap, pfx, b.senha, opcoesTls);
      return responder(res, 200, {status: r.status, corpo: r.corpo});
    } catch (e) {
      // Sem detalhes do certificado no log: só o tipo do erro
      const msg = /mac verify|bad decrypt|PKCS12/i.test(String(e?.message)) ? 'Senha do certificado incorreta ou arquivo inválido'
        : /ECONNRESET|socket hang up/i.test(String(e?.message)) ? 'A SEFAZ recusou a conexão (certificado não aceito ou vencido)'
        : String(e?.message || 'Erro').slice(0, 200);
      console.error('falha', e?.code || '', msg);
      return responder(res, 502, {erro: msg});
    }
  });
}

if (require.main === module) {
  if (!CHAVE || CHAVE.length < 32) { console.error('Defina PONTE_CHAVE (32 caracteres ou mais).'); process.exit(1); }
  criarServidor().listen(PORTA, () => console.log('ponte SEFAZ ouvindo na porta', PORTA));
}
module.exports = {criarServidor, chaveOk, DESTINOS};
