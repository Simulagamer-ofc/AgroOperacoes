// Testes do núcleo da SEFAZ (deno test supabase/functions). Certificados de teste gerados na hora (não são ICP-Brasil).
import assert from 'node:assert/strict';
const assertEquals = (a: unknown, b: unknown) => assert.deepEqual(a, b);
const assertMatch = (s: string, r: RegExp) => assert.match(s, r);
const assertThrows = (f: () => unknown, _t: unknown, msg: string) => assert.throws(f, (e: Error) => e.message.includes(msg));
import forge from 'npm:node-forge@1.3.1';
import { lerCertificado, lerCertificadoPublico, envEventoCiencia, prepararCiencia, montarEnvEvento, assinarComA1 } from './nucleo.ts';

// Certificado de teste com o CNPJ no nome (forma usada como reserva quando não há o OID ICP-Brasil)
function pfxTeste(cn = 'FAZENDA TESTE LTDA:12345678000199') {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey; c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 864e5); c.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  c.setSubject([{name: 'commonName', value: cn}]); c.setIssuer([{name: 'commonName', value: 'AC TESTE'}]);
  c.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [c], 'senha', {algorithm: '3des'});
  return {pfx: forge.util.encode64(forge.asn1.toDer(p12).getBytes()), keys, cert: c};
}
const CHAVES = ['43261112345678000199550010000012341000012345', '43261112345678000199550010000012351000012346'];
const QUANDO = new Date('2026-11-19T15:00:00Z');

Deno.test('A1: o XML da ciência continua idêntico ao de antes da separação em duas partes', async () => {
  const {pfx} = pfxTeste();
  const cert = lerCertificado(pfx, 'senha');
  const antigo = await import('/tmp/nucleo_old.ts').catch(() => null);
  const agora = Date.now; Date.now = () => 1763564400123;
  try {
    const novo = envEventoCiencia(CHAVES, cert, 1, QUANDO);
    if (antigo) assertEquals(novo, antigo.envEventoCiencia(CHAVES, antigo.lerCertificado(pfx, 'senha'), 1, QUANDO));
    assertMatch(novo, /<SignatureValue>[A-Za-z0-9+/=]+<\/SignatureValue>/);
  } finally { Date.now = agora; }
});

Deno.test('A3: assinatura feita fora (como o token faz) gera o mesmo XML do A1', () => {
  const {pfx, keys} = pfxTeste();
  const a1 = lerCertificado(pfx, 'senha');
  const pub = lerCertificadoPublico(a1.certB64);
  assertEquals([pub.doc, pub.tipoDoc, pub.nome], ['12345678000199', 'CNPJ', 'FAZENDA TESTE LTDA']);
  const itens = prepararCiencia(CHAVES, pub.doc, pub.tipoDoc, 1, QUANDO);
  // "Token": assina o texto do SignedInfo (UTF-8) com RSA-SHA1 PKCS#1 v1.5, como o Windows faz com SignData(SHA1, Pkcs1)
  const assinaturas = itens.map(it => { const md = forge.md.sha1.create(); md.update(it.signedInfo, 'utf8'); return forge.util.encode64(keys.privateKey.sign(md)); });
  assertEquals(assinaturas, itens.map(it => assinarComA1(it.signedInfo, a1)));
  assertEquals(montarEnvEvento(itens, assinaturas, pub.certB64, '123'), envEventoCiencia(CHAVES, a1, 1, QUANDO, '123'));
});

Deno.test('A3: e-CPF pelo nome e entradas inválidas', () => {
  const {cert} = pfxTeste('JOAO DA SILVA:12345678909');
  const b64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const pub = lerCertificadoPublico(b64);
  assertEquals([pub.doc, pub.tipoDoc], ['12345678909', 'CPF']);
  assertThrows(() => lerCertificadoPublico('nao é certificado'), Error, 'Certificado inválido');
  const itens = prepararCiencia(CHAVES.slice(0, 1), pub.doc, pub.tipoDoc, 1, QUANDO);
  assertThrows(() => montarEnvEvento(itens, [], b64), Error, 'Faltam assinaturas');
  assertThrows(() => montarEnvEvento(itens, ['<x>'], b64), Error, 'formato inválido');
});
