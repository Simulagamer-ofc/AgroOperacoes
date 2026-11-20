using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace MercaPlantConecta
{
    /// <summary>
    /// Certificado A3 (token USB ou cartão) pelo repositório do Windows. Todo token/cartão ICP-Brasil aparece ali
    /// depois de instalado o programa do fabricante (SafeNet, GD, Watchdata, Gemalto, Valid…): por isso funciona com
    /// qualquer marca. O PIN é pedido pela janela do próprio fabricante; a chave nunca sai do aparelho.
    /// Também aceita certificado A1 instalado no Windows (para quem prefere assim).
    /// </summary>
    public static class Certificado
    {
        /// <summary>Certificados pessoais com chave (do usuário e da máquina), válidos, para escolher.</summary>
        public static X509Certificate2Collection Disponiveis()
        {
            var r = new X509Certificate2Collection();
            foreach (var local in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
            {
                try
                {
                    using (var st = new X509Store(StoreName.My, local))
                    {
                        st.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
                        foreach (var c in st.Certificates)
                            if (c.HasPrivateKey && c.NotAfter > DateTime.Now && !r.Cast<X509Certificate2>().Any(x => x.Thumbprint == c.Thumbprint)) r.Add(c);
                    }
                }
                catch { /* sem acesso a este repositório */ }
            }
            return r;
        }

        public static X509Certificate2 Achar(string thumbprint)
        {
            if (string.IsNullOrEmpty(thumbprint)) return null;
            foreach (X509Certificate2 c in Disponiveis()) if (string.Equals(c.Thumbprint, thumbprint, StringComparison.OrdinalIgnoreCase)) return c;
            return null;
        }

        /// <summary>Nome curto para mostrar (parte do CN antes do ":" do CNPJ/CPF).</summary>
        public static string Titular(X509Certificate2 c)
        {
            var cn = c.GetNameInfo(X509NameType.SimpleName, false) ?? c.Subject;
            var i = cn.IndexOf(':');
            return i > 0 ? cn.Substring(0, i).Trim() : cn;
        }

        public static string Base64(X509Certificate2 c) => Convert.ToBase64String(c.RawData);

        /// <summary>Assina o texto (UTF-8) com RSA-SHA1 PKCS#1 v1.5, como pede a NF-e. No A3 o token faz a conta e pode pedir o PIN.</summary>
        public static string Assinar(X509Certificate2 c, string texto)
        {
            var dados = Encoding.UTF8.GetBytes(texto);
            using (var rsa = c.GetRSAPrivateKey())
            {
                if (rsa == null) throw new InvalidOperationException("O certificado escolhido não tem chave RSA disponível. Confira se o token/cartão está conectado.");
                try { return Convert.ToBase64String(rsa.SignData(dados, HashAlgorithmName.SHA1, RSASignaturePadding.Pkcs1)); }
                catch (CryptographicException e) { throw new InvalidOperationException(MensagemToken(e), e); }
            }
        }

        public static string MensagemToken(Exception e)
        {
            var m = e.Message ?? "";
            if (m.IndexOf("cancel", StringComparison.OrdinalIgnoreCase) >= 0) return "O PIN do token/cartão foi cancelado. Clique em Buscar agora e digite o PIN.";
            if (m.IndexOf("PIN", StringComparison.OrdinalIgnoreCase) >= 0 || m.IndexOf("senha", StringComparison.OrdinalIgnoreCase) >= 0) return "PIN do token/cartão incorreto ou bloqueado.";
            if (m.IndexOf("keyset", StringComparison.OrdinalIgnoreCase) >= 0 || m.IndexOf("smart card", StringComparison.OrdinalIgnoreCase) >= 0 || m.IndexOf("cartão", StringComparison.OrdinalIgnoreCase) >= 0)
                return "Não consegui usar o token/cartão. Confira se ele está conectado e se o programa do fabricante está instalado.";
            return "Erro no certificado: " + m;
        }
    }

    /// <summary>Envio à SEFAZ (Ambiente Nacional) com o certificado. Endereços fixos: o servidor não escolhe para onde vai.</summary>
    public static class Sefaz
    {
        static readonly Dictionary<string, (string url, string acao)> Destinos = new Dictionary<string, (string, string)>
        {
            ["dist1"] = ("https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx", "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"),
            ["dist2"] = ("https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx", "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"),
            ["evento1"] = ("https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx", "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"),
            ["evento2"] = ("https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx", "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"),
        };

        static Sefaz()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            // Os servidores da SEFAZ podem usar certificado da cadeia ICP-Brasil, que o Windows nem sempre tem instalada.
            // Aceita só para os endereços fixos acima, quando o único problema é a cadeia e a raiz é ICP-Brasil.
            ServicePointManager.ServerCertificateValidationCallback = (sender, cert, chain, erros) =>
            {
                if (erros == SslPolicyErrors.None) return true;
                var host = (sender as HttpWebRequest)?.RequestUri?.Host ?? "";
                if (!host.EndsWith(".fazenda.gov.br", StringComparison.OrdinalIgnoreCase)) return false;
                if (erros != SslPolicyErrors.RemoteCertificateChainErrors || chain == null) return false;
                var raiz = chain.ChainElements.Count > 0 ? chain.ChainElements[chain.ChainElements.Count - 1].Certificate : null;
                return raiz != null && raiz.Subject.IndexOf("ICP-Brasil", StringComparison.OrdinalIgnoreCase) >= 0;
            };
        }

        /// <summary>Envia o SOAP e devolve (status HTTP, corpo). Status 0 = sem conexão.</summary>
        public static (int status, string corpo) Enviar(string servico, int ambiente, string soap, X509Certificate2 cert)
        {
            if (!Destinos.TryGetValue(servico + (ambiente == 2 ? "2" : "1"), out var d)) throw new ArgumentException("Serviço da SEFAZ desconhecido.");
            var req = (HttpWebRequest)WebRequest.Create(d.url);
            req.Method = "POST";
            req.ContentType = "application/soap+xml; charset=utf-8; action=\"" + d.acao + "\"";
            req.Timeout = 60000; req.ReadWriteTimeout = 60000;
            req.ClientCertificates.Add(cert);
            req.KeepAlive = false;
            var bytes = Encoding.UTF8.GetBytes(soap);
            try
            {
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var r = (HttpWebResponse)req.GetResponse())
                using (var l = new StreamReader(r.GetResponseStream(), Encoding.UTF8))
                    return ((int)r.StatusCode, l.ReadToEnd());
            }
            catch (WebException e) when (e.Response is HttpWebResponse r)
            {
                using (r)
                using (var l = new StreamReader(r.GetResponseStream(), Encoding.UTF8))
                    return ((int)r.StatusCode, l.ReadToEnd());
            }
            catch (WebException e)
            {
                var m = e.InnerException != null ? e.InnerException.Message : e.Message;
                if (e.Status == WebExceptionStatus.SecureChannelFailure || e.Status == WebExceptionStatus.TrustFailure)
                    throw new InvalidOperationException("Não consegui a conexão segura com a SEFAZ usando o certificado (" + m + "). Confira se o token/cartão está conectado e o PIN foi digitado.");
                throw new InvalidOperationException("Sem conexão com a SEFAZ (" + m + ").");
            }
        }
    }
}
