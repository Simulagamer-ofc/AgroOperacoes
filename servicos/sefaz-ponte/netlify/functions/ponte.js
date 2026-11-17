'use strict';
// MercaPlant — ponte da SEFAZ como função do Netlify (Node, OpenSSL: faz a renegociação TLS que a SEFAZ pede).
// Endereços: /enviar e /saude (redirecionados para esta função no netlify.toml). Variável de ambiente: PONTE_CHAVE.
const {atender} = require('../../index.js');

function criarHandler(opcoes = {}) {
  return async event => {
    const caminho = /\/saude\/?$/.test(event.path || '') ? '/saude' : /\/enviar\/?$/.test(event.path || '') ? '/enviar' : event.path;
    const corpoTexto = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    // O Netlify encerra a função em 60 s: a conexão com a SEFAZ desiste antes, em 50 s
    const r = await atender({metodo: event.httpMethod, caminho, chave: event.headers?.['x-ponte-chave'], corpoTexto}, {opcoesTls: {timeout: 50000}, ...opcoes});
    return {statusCode: r.status, headers: {'Content-Type': 'application/json; charset=utf-8'}, body: JSON.stringify(r.corpo)};
  };
}
exports.handler = criarHandler();
exports.criarHandler = criarHandler;
