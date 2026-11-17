// Integração da função sefaz: banco em memória + ponte/SEFAZ simuladas.
// Uso: bash referencias/servidor/sefaz/rodar.sh   (precisa de deno e openssl)
import {tabelas, vault, papelAtual} from './fake-supabase.ts';
Deno.env.set('SUPABASE_URL', 'http://fake'); Deno.env.set('SUPABASE_ANON_KEY', 'anon'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'svc');
Deno.env.set('SEFAZ_PONTE_URL', 'http://localhost:8790'); Deno.env.set('SEFAZ_PONTE_CHAVE', 'x'.repeat(40));
const CERT = Deno.readTextFileSync(Deno.env.get('CERT_B64') || 'a1.b64').trim();
const FAZ = '11111111-2222-3333-4444-555555555555';
const ch = (n: number) => `4326119876543200011055001${String(n).padStart(9, '0')}1123456780`.slice(0, 43) + '0';
const gz = async (s: string) => { const b = await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); return btoa(String.fromCharCode(...new Uint8Array(b))); };
const res = (c: string, nome: string, v: number, tp = '1', sit = '1') => `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${c}</chNFe><CNPJ>98765432000110</CNPJ><xNome>${nome}</xNome><IE>1</IE><dhEmi>2026-11-10T09:00:00-03:00</dhEmi><tpNF>${tp}</tpNF><vNF>${v}</vNF><digVal>x</digVal><dhRecbto>x</dhRecbto><nProt>1</nProt><cSitNFe>${sit}</cSitNFe></resNFe>`;
const proc = (c: string) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${c}" versao="4.00"><ide><nNF>${Number(c.slice(25, 34))}</nNF><dhEmi>2026-11-10T09:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>98765432000110</CNPJ><xNome>AGRO EXEMPLO</xNome></emit><total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${c}</chNFe></infProt></protNFe></nfeProc>`;
const canc = (c: string) => `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cOrgao>43</cOrgao><CNPJ>98765432000110</CNPJ><chNFe>${c}</chNFe><dhEvento>2026-11-11T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento></resEvento>`;
const ret = (cStat: string, ult: number, max: number, docs: [number, string, string][]) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>${cStat}</cStat><xMotivo>${cStat === '138' ? 'Documento localizado' : cStat === '137' ? 'Nenhum documento localizado' : 'Rejeicao: Consumo Indevido'}</xMotivo><ultNSU>${String(ult).padStart(15, '0')}</ultNSU><maxNSU>${String(max).padStart(15, '0')}</maxNSU>${docs.length ? `<loteDistDFeInt>${docs.map(([n, s, b]) => `<docZip NSU="${String(n).padStart(15, '0')}" schema="${s}">${b}</docZip>`).join('')}</loteDistDFeInt>` : ''}</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;
let cenario: (ult: number) => Promise<string>;
const log: string[] = [];
Deno.serve({port: 8790, onListen() {}}, async req => {
  if (req.headers.get('x-ponte-chave') !== 'x'.repeat(40)) return Response.json({erro: 'Chave inválida'}, {status: 401});
  const b = await req.json();
  if (b.servico === 'dist') { const ult = Number((b.soap.match(/<ultNSU>(\d+)/) || [])[1]); log.push('dist:' + ult); return Response.json({status: 200, corpo: await cenario(ult)}); }
  const chaves = [...b.soap.matchAll(/<chNFe>(\d{44})<\/chNFe>/g)].map((m: RegExpMatchArray) => m[1]);
  log.push('evento:' + chaves.length);
  return Response.json({status: 200, corpo: `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><cStat>128</cStat><xMotivo>Lote processado</xMotivo>${chaves.map((c: string, i: number) => `<retEvento versao="1.00"><infEvento><cStat>${i === 0 ? '135' : '573'}</cStat><xMotivo>${i === 0 ? 'Evento registrado' : 'Duplicidade de evento'}</xMotivo><chNFe>${c}</chNFe></infEvento></retEvento>`).join('')}</retEnvEvento>`});
});
await import('../../../supabase/functions/sefaz/index.ts');
const chamar = (corpo: any) => fetch('http://localhost:8000', {method: 'POST', headers: {Authorization: 'Bearer t', 'Content-Type': 'application/json'}, body: JSON.stringify({farm_id: FAZ, ...corpo})}).then(async r => ({s: r.status, j: await r.json()}));
let ok = true; const check = (c: boolean, m: string) => { console.log((c ? 'OK   ' : 'FALHA ') + m); ok &&= c; };

let r = await chamar({acao: 'buscar'});
check(r.s === 400 && /ainda não cadastrou/.test(r.j.message), 'sem certificado: pede ao ADM');
papelAtual.papel = 'member';
r = await chamar({acao: 'certificado', pfx: CERT, senha: 's3nh@'});
check(r.s === 403, 'usuário comum não cadastra certificado');
papelAtual.papel = 'admin';
r = await chamar({acao: 'certificado', pfx: CERT, senha: 'errada'});
check(r.s === 400 && /Senha do certificado incorreta/.test(r.j.message), 'senha errada: mensagem clara');
r = await chamar({acao: 'certificado', pfx: CERT, senha: 's3nh@', uf: '43'});
check(r.s === 200 && r.j.config.doc === '12345678000195' && r.j.config.tipo_doc === 'CNPJ' && !!vault[FAZ], 'certificado guardado no Vault; CNPJ lido do certificado');
check(!JSON.stringify(r.j).includes('s3nh@') && !JSON.stringify(tabelas.sefaz_config).includes('s3nh@'), 'senha não volta para o app nem fica na tabela');
// 1ª busca: 2 lotes (NSU 1-3 e 4-5), com resumo, completa, cancelamento e nota de entrada (tpNF 0) ignorada
cenario = async ult => ult === 0 ? ret('138', 3, 5, [[1, 'resNFe_v1.01.xsd', await gz(res(ch(101), 'AGRO A', 1000))], [2, 'procNFe_v4.00.xsd', await gz(proc(ch(102)))], [3, 'resNFe_v1.01.xsd', await gz(res(ch(103), 'AGRO C', 300))]])
  : ret('138', 5, 5, [[4, 'resEvento_v1.01.xsd', await gz(canc(ch(103)))], [5, 'resNFe_v1.01.xsd', await gz(res(ch(104), 'CEREALISTA', 50000, '0'))]]);
r = await chamar({acao: 'buscar'});
const n = (c: string) => tabelas.nfe_recebidas.find(x => x.chave === c);
console.log('   ', JSON.stringify({novas: r.j.novas, completas: r.j.completas, canceladas: r.j.canceladas, ciencias: r.j.ciencias, falhas: r.j.cienciaFalhas, log}));
check(r.s === 200 && log.join() === 'dist:0,dist:3,evento:1', 'buscou os 2 lotes até o maxNSU e mandou a ciência');
check(n(ch(101))?.situacao === 'resumo' && !!n(ch(101))?.ciencia_em && n(ch(102))?.situacao === 'completa' && !!n(ch(102))?.xml && n(ch(103))?.situacao === 'cancelada' && !n(ch(104)), 'resumo com ciência, completa com XML, cancelada marcada, nota de entrada ignorada');
check(tabelas.sefaz_config[0].ult_nsu === '000000000000005' && new Date(tabelas.sefaz_config[0].prox_consulta) > new Date(Date.now() + 60 * 60e3), 'guardou o último NSU e só consulta de novo depois de 1 hora');
// 2ª busca logo em seguida: não consulta a SEFAZ (regra de 1 hora)
log.length = 0; r = await chamar({acao: 'buscar'});
check(r.s === 200 && !log.some(l => l.startsWith('dist')) && !!r.j.aguardar, 'antes de 1 hora: não consulta a SEFAZ (evita bloqueio)');
// depois de 1 hora: chega o XML completo da nota que teve ciência
tabelas.sefaz_config[0].prox_consulta = new Date(Date.now() - 1000).toISOString();
cenario = async ult => ult === 5 ? ret('138', 6, 6, [[6, 'procNFe_v4.00.xsd', await gz(proc(ch(101)))]]) : ret('137', ult, ult, []);
log.length = 0; r = await chamar({acao: 'buscar'});
check(n(ch(101))?.situacao === 'completa' && !!n(ch(101))?.xml && r.j.completas === 1, 'depois da ciência, o XML completo chega na busca seguinte');
// consumo indevido (656): para e espera 1 hora, com o motivo
tabelas.sefaz_config[0].prox_consulta = null;
cenario = async () => ret('656', 6, 6, []);
r = await chamar({acao: 'buscar'});
check(/656/.test(r.j.motivo) && !!r.j.aguardar, 'consumo indevido (656): espera 1 hora e mostra o motivo');
// remover
papelAtual.papel = 'admin'; r = await chamar({acao: 'remover'});
check(r.s === 200 && !vault[FAZ] && !tabelas.sefaz_config.length, 'ADM remove o certificado (some do Vault)');
console.log(ok ? 'FIM OK' : 'FIM FALHAS'); Deno.exit(ok ? 0 : 1);
