// MercaPlant — núcleo da comunicação com a SEFAZ (NF-e: Distribuição de DF-e e evento de Ciência da Operação).
// Funções puras (sem banco, sem rede) para poderem ser testadas fora do servidor.
import forge from 'npm:node-forge@1.3.1';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';

// ---------- Certificado A1 (.pfx) ----------
export type Certificado = {certPem: string; keyPem: string; certB64: string; doc: string; tipoDoc: 'CNPJ' | 'CPF'; nome: string; validade: string; inicio: string};

// OIDs ICP-Brasil no "outro nome" do certificado: 2.16.76.1.3.3 = CNPJ (e-CNPJ); 2.16.76.1.3.1 = dados do titular (e-CPF: nasc. 8 + CPF 11)
function docDoSan(cert: forge.pki.Certificate): {doc: string; tipo: 'CNPJ' | 'CPF'} | null {
  const ext = cert.extensions.find((e: any) => e.name === 'subjectAltName') as any;
  if (!ext?.value) return null;
  try {
    const asn = forge.asn1.fromDer(ext.value);
    for (const gn of asn.value as any[]) {
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue; // otherName
      const oid = forge.asn1.derToOid(gn.value[0].value);
      const bruto = (function achar(n: any): string { if (typeof n.value === 'string') return n.value; for (const f of n.value || []) { const s = achar(f); if (s) return s; } return ''; })(gn.value[1]);
      const dig = bruto.replace(/\D/g, '');
      if (oid === '2.16.76.1.3.3' && dig.length >= 14) return {doc: dig.slice(0, 14), tipo: 'CNPJ'};
      if (oid === '2.16.76.1.3.1' && dig.length >= 19) return {doc: dig.slice(8, 19), tipo: 'CPF'};
    }
  } catch { /* segue para o nome */ }
  return null;
}

/** Certificado sem chave (A3: o Conecta manda só a parte pública, DER em base64). */
export type CertPublico = {certB64: string; doc: string; tipoDoc: 'CNPJ' | 'CPF'; nome: string; validade: string; inicio: string};
function dadosDoTitular(titular: forge.pki.Certificate): Omit<CertPublico, 'certB64'> {
  const cn = String(titular.subject.getField('CN')?.value || '');
  let id = docDoSan(titular);
  if (!id) { const d = (cn.split(':').pop() || '').replace(/\D/g, ''); if (d.length === 14) id = {doc: d, tipo: 'CNPJ'}; else if (d.length === 11) id = {doc: d, tipo: 'CPF'}; }
  if (!id) throw new Error('Não achei o CNPJ ou CPF no certificado. Confirme se é um certificado ICP-Brasil (e-CNPJ ou e-CPF).');
  return {doc: id.doc, tipoDoc: id.tipo, nome: cn.split(':')[0].trim(), validade: titular.validity.notAfter.toISOString(), inicio: titular.validity.notBefore.toISOString()};
}
export function lerCertificadoPublico(certB64: string): CertPublico {
  let c: forge.pki.Certificate;
  try { c = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(certB64.replace(/\s/g, '')))); }
  catch { throw new Error('Certificado inválido enviado pelo MercaPlant Conecta.'); }
  if (!(c.publicKey as forge.pki.rsa.PublicKey)?.n) throw new Error('O certificado precisa ser RSA (padrão ICP-Brasil).');
  return {certB64: certB64.replace(/\s/g, ''), ...dadosDoTitular(c)};
}

export function lerCertificado(pfxB64: string, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(pfxB64)), false, senha); }
  catch (e) { throw new Error(/MAC|password|Invalid/i.test(String((e as Error).message)) ? 'Senha do certificado incorreta.' : 'Arquivo de certificado inválido. Use o arquivo .pfx (ou .p12) do certificado A1.'); }
  const chaves = [...(p12.getBags({bagType: forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({bagType: forge.pki.oids.keyBag})[forge.pki.oids.keyBag] || [])];
  const certs = p12.getBags({bagType: forge.pki.oids.certBag})[forge.pki.oids.certBag] || [];
  const key = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error('O arquivo não tem a chave privada. Exporte o certificado A1 com a chave (arquivo .pfx).');
  // O certificado do titular é o que tem a mesma chave pública da chave privada
  const titular = certs.map((b: any) => b.cert as forge.pki.Certificate).find((c: forge.pki.Certificate) => c && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n));
  if (!titular) throw new Error('Não encontrei o certificado do titular dentro do arquivo.');
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(titular)).getBytes();
  return {
    certPem: forge.pki.certificateToPem(titular),
    keyPem: forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))),
    certB64: forge.util.encode64(der), ...dadosDoTitular(titular),
  };
}

// ---------- XML: utilidades ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Primeira ocorrência de <tag>texto</tag> (com ou sem prefixo de namespace)
export function tag(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${nome}>`));
  return m ? desesc(m[1].trim()) : '';
}
function bloco(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[A-Za-z0-9_]+:)?${nome}>`));
  return m ? m[0] : '';
}
const nsu15 = (n: string | number) => String(n || '0').replace(/\D/g, '').padStart(15, '0').slice(-15);
// Data/hora no fuso de Brasília (-03:00), formato exigido nos eventos
export function dhBrasilia(d = new Date()): string {
  const t = new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19);
  return `${t}-03:00`;
}

// ---------- Distribuição de DF-e ----------
export function soapDist(o: {tpAmb: number; cUF: string; doc: string; tipoDoc: 'CNPJ' | 'CPF'; ultNSU?: string; chave?: string}): string {
  const consulta = o.chave ? `<consChNFe><chNFe>${o.chave}</chNFe></consChNFe>` : `<distNSU><ultNSU>${nsu15(o.ultNSU || '0')}</ultNSU></distNSU>`;
  const dist = `<distDFeInt xmlns="${NS_NFE}" versao="1.01"><tpAmb>${o.tpAmb}</tpAmb><cUFAutor>${o.cUF}</cUFAutor><${o.tipoDoc}>${o.doc}</${o.tipoDoc}>${consulta}</distDFeInt>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

export type RetDist = {cStat: string; xMotivo: string; ultNSU: string; maxNSU: string; docs: {nsu: string; schema: string; b64: string}[]};
export function lerRetDist(xml: string): RetDist {
  const ret = bloco(xml, 'retDistDFeInt') || xml;
  const docs = [...ret.matchAll(/<(?:[A-Za-z0-9_]+:)?docZip\s+([^>]*)>([^<]+)<\/(?:[A-Za-z0-9_]+:)?docZip>/g)].map(m => {
    const at = m[1];
    return {nsu: (at.match(/NSU="(\d+)"/) || [])[1] || '', schema: (at.match(/schema="([^"]+)"/) || [])[1] || '', b64: m[2].trim()};
  });
  return {cStat: tag(ret, 'cStat'), xMotivo: tag(ret, 'xMotivo'), ultNSU: tag(ret, 'ultNSU'), maxNSU: tag(ret, 'maxNSU'), docs};
}

export async function descompactar(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(s).text();
}

export type Documento = {tipo: 'resumo' | 'completa' | 'evento' | 'outro'; chave: string; cnpjEmit: string; nomeEmit: string; valor: number | null; emissao: string | null;
  tpNF: string; cSit: string; tpEvento: string; xml: string; numero: string};
// Lê o documento descompactado conforme o schema (resNFe, procNFe, resEvento, procEventoNFe)
export function lerDocumento(schema: string, xml: string): Documento {
  const base = {chave: '', cnpjEmit: '', nomeEmit: '', valor: null as number | null, emissao: null as string | null, tpNF: '', cSit: '', tpEvento: '', xml: '', numero: ''};
  const num = (s: string) => { const n = Number(s); return s && Number.isFinite(n) ? n : null; };
  if (/^resNFe/.test(schema)) {
    const ch = tag(xml, 'chNFe');
    return {...base, tipo: 'resumo', chave: ch, cnpjEmit: tag(xml, 'CNPJ') || tag(xml, 'CPF'), nomeEmit: tag(xml, 'xNome'), valor: num(tag(xml, 'vNF')), emissao: tag(xml, 'dhEmi') || null,
      tpNF: tag(xml, 'tpNF'), cSit: tag(xml, 'cSitNFe'), numero: ch ? String(Number(ch.slice(25, 34))) : ''};
  }
  if (/^procNFe/.test(schema)) {
    const emit = bloco(xml, 'emit'), ide = bloco(xml, 'ide');
    const ch = tag(bloco(xml, 'infProt'), 'chNFe') || ((xml.match(/Id="NFe(\d{44})"/) || [])[1] || '');
    return {...base, tipo: 'completa', chave: ch, cnpjEmit: tag(emit, 'CNPJ') || tag(emit, 'CPF'), nomeEmit: tag(emit, 'xNome'), valor: num(tag(bloco(xml, 'ICMSTot'), 'vNF')),
      emissao: tag(ide, 'dhEmi') || (tag(ide, 'dEmi') ? tag(ide, 'dEmi') + 'T12:00:00-03:00' : null), tpNF: tag(ide, 'tpNF'), cSit: '1', xml, numero: tag(ide, 'nNF')};
  }
  if (/^(resEvento|procEventoNFe)/.test(schema)) {
    return {...base, tipo: 'evento', chave: tag(xml, 'chNFe'), tpEvento: tag(xml, 'tpEvento'), cnpjEmit: tag(xml, 'CNPJ'), emissao: tag(xml, 'dhEvento') || null};
  }
  return {...base, tipo: 'outro'};
}

// ---------- Evento: Ciência da Operação (210210), assinado ----------
// A assinatura é feita em duas partes para servir aos dois tipos de certificado:
//   A1 (arquivo no servidor): prepararCiencia → assina aqui com a chave do .pfx → montarEnvEvento
//   A3 (token/cartão no computador da fazenda): prepararCiencia → o MercaPlant Conecta assina o SignedInfo
//      com o token (RSA-SHA1) → montarEnvEvento com a assinatura e o certificado que ele devolve
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
export type ItemCiencia = {id: string; corpo: string; signedInfo: string};

export function prepararCiencia(chaves: string[], doc: string, tipoDoc: 'CNPJ' | 'CPF', tpAmb: number, quando = new Date()): ItemCiencia[] {
  if (!chaves.length || chaves.length > 20) throw new Error('De 1 a 20 notas por lote de ciência.');
  const dh = dhBrasilia(quando);
  return chaves.map(ch => {
    const id = `ID210210${ch}01`;
    const corpo = `<cOrgao>91</cOrgao><tpAmb>${tpAmb}</tpAmb><${tipoDoc}>${doc}</${tipoDoc}><chNFe>${ch}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>`;
    // Forma canônica (C14N) do infEvento: herda o namespace da NF-e do elemento de cima
    const canon = `<infEvento xmlns="${NS_NFE}" Id="${id}">${corpo}</infEvento>`;
    const md = forge.md.sha1.create(); md.update(canon, 'utf8');
    const digest = forge.util.encode64(md.digest().getBytes());
    // SignedInfo canônico: é exatamente este texto (UTF-8) que a chave assina com RSA-SHA1
    const signedInfo = `<SignedInfo xmlns="${NS_DS}"><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="${NS_DS}rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="${NS_DS}enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms><DigestMethod Algorithm="${NS_DS}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
    return {id, corpo, signedInfo};
  });
}

/** Junta os eventos com as assinaturas (base64, uma por item, na mesma ordem) e o certificado do titular (DER em base64). */
export function montarEnvEvento(itens: ItemCiencia[], assinaturas: string[], certB64: string, lote = String(Date.now()).slice(-15)): string {
  if (assinaturas.length !== itens.length) throw new Error('Faltam assinaturas no lote de ciência.');
  const b64 = /^[A-Za-z0-9+/=\s]+$/;
  if (!b64.test(certB64) || assinaturas.some(a => !a || !b64.test(a))) throw new Error('Assinatura ou certificado em formato inválido.');
  const cert = certB64.replace(/\s/g, '');
  const eventos = itens.map((it, i) =>
    // No documento, SignedInfo herda o namespace de Signature (o canônico já o inclui)
    `<evento versao="1.00"><infEvento Id="${it.id}">${it.corpo}</infEvento><Signature xmlns="${NS_DS}">${it.signedInfo.replace(` xmlns="${NS_DS}"`, '')}<SignatureValue>${assinaturas[i].replace(/\s/g, '')}</SignatureValue><KeyInfo><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></Signature></evento>`
  ).join('');
  return `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${lote}</idLote>${eventos}</envEvento>`;
}

/** Assinatura RSA-SHA1 (PKCS#1 v1.5) do SignedInfo com a chave do A1. */
export function assinarComA1(signedInfo: string, cert: Certificado): string {
  const key = forge.pki.privateKeyFromPem(cert.keyPem) as forge.pki.rsa.PrivateKey;
  const md = forge.md.sha1.create(); md.update(signedInfo, 'utf8');
  return forge.util.encode64(key.sign(md));
}

export function envEventoCiencia(chaves: string[], cert: Certificado, tpAmb: number, quando = new Date(), lote?: string): string {
  const itens = prepararCiencia(chaves, cert.doc, cert.tipoDoc, tpAmb, quando);
  return montarEnvEvento(itens, itens.map(it => assinarComA1(it.signedInfo, cert)), cert.certB64, lote);
}

export function soapEvento(envEvento: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

export type RetEvento = {cStat: string; xMotivo: string; eventos: {chave: string; cStat: string; xMotivo: string}[]};
export function lerRetEvento(xml: string): RetEvento {
  const ret = bloco(xml, 'retEnvEvento') || xml;
  const cab = ret.replace(/<(?:[A-Za-z0-9_]+:)?retEvento[\s\S]*$/, '');
  const eventos = [...ret.matchAll(/<(?:[A-Za-z0-9_]+:)?retEvento[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?retEvento>/g)].map(m => ({chave: tag(m[0], 'chNFe'), cStat: tag(m[0], 'cStat'), xMotivo: tag(m[0], 'xMotivo')}));
  return {cStat: tag(cab, 'cStat'), xMotivo: tag(cab, 'xMotivo'), eventos};
}
// 135 = registrado; 136 = registrado sem vínculo; 573 = já existia (duplicidade): todos contam como ciência feita
export const cienciaOk = (cStat: string) => ['135', '136', '573'].includes(cStat);

// Corpo da SEFAZ às vezes vem como fault SOAP: tira a mensagem
export function faultSoap(xml: string): string { return tag(xml, 'Text') || tag(xml, 'faultstring') || ''; }

export {esc};
