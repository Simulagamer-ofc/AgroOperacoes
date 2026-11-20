using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MercaPlantConecta
{
    public static class Programa
    {
        public static string Versao => Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
        static string PastaInstalacao => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MercaPlant Conecta");
        static string ExeInstalado => Path.Combine(PastaInstalacao, "MercaPlantConecta.exe");

        [STAThread]
        static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--autoteste") return AutoTeste(args.Length > 1 ? args[1] : null);

            // Uma cópia só por usuário
            using (var unico = new Mutex(true, "MercaPlantConecta-" + Environment.UserName, out var primeiro))
            {
                if (!primeiro) { MessageBox.Show("O MercaPlant Conecta já está aberto (veja o ícone perto do relógio).", "MercaPlant Conecta"); return 0; }
                Instalar();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var cfg = Config.Ler();
                AjustarInicio(cfg.IniciarComWindows);
                var trab = new Trabalho(cfg);
                Icon icone;
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MercaPlantConecta.app.ico")) icone = s != null ? new Icon(s) : SystemIcons.Application;
                var janela = new Janela(cfg, trab, icone);
                // Aberto pelo Windows ao iniciar: começa só na bandeja
                var escondido = Array.IndexOf(args, "--bandeja") >= 0 && cfg.Ligado;
                if (!escondido) janela.Show();
                trab.Iniciar();
                Application.Run();
            }
            return 0;
        }

        /// <summary>Copia o programa para a pasta do usuário (sem pedir administrador), para continuar funcionando mesmo se o arquivo baixado for apagado.</summary>
        static void Instalar()
        {
            try
            {
                var atual = Assembly.GetExecutingAssembly().Location;
                if (string.Equals(Path.GetFullPath(atual), Path.GetFullPath(ExeInstalado), StringComparison.OrdinalIgnoreCase)) return;
                Directory.CreateDirectory(PastaInstalacao);
                File.Copy(atual, ExeInstalado, true);
            }
            catch { /* segue rodando de onde está */ }
        }

        public static void AjustarInicio(bool ligar)
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (k == null) return;
                    var exe = File.Exists(ExeInstalado) ? ExeInstalado : Assembly.GetExecutingAssembly().Location;
                    if (ligar) k.SetValue("MercaPlant Conecta", "\"" + exe + "\" --bandeja");
                    else k.DeleteValue("MercaPlant Conecta", false);
                }
            }
            catch { /* sem permissão: o usuário abre manualmente */ }
        }

        /// <summary>
        /// Teste automático (usado na compilação do GitHub): cria um certificado de teste no Windows, assina como na
        /// ciência da NF-e e confere a assinatura; confere também a leitura do JSON. Grava o resultado no arquivo indicado.
        /// </summary>
        static int AutoTeste(string saida)
        {
            var log = new StringBuilder();
            int falhas = 0;
            void Ok(bool cond, string nome) { log.AppendLine((cond ? "ok   " : "FALHA ") + nome); if (!cond) falhas++; }
            try
            {
                using (var rsa = RSA.Create(2048))
                {
                    var pedido = new CertificateRequest("CN=FAZENDA TESTE LTDA:12345678000199", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                    using (var cert = pedido.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(1)))
                    {
                        var pfx = new X509Certificate2(cert.Export(X509ContentType.Pfx, "t"), "t", X509KeyStorageFlags.UserKeySet | X509KeyStorageFlags.PersistKeySet);
                        using (var st = new X509Store(StoreName.My, StoreLocation.CurrentUser)) { st.Open(OpenFlags.ReadWrite); st.Add(pfx); }
                        try
                        {
                            var achado = Certificado.Achar(pfx.Thumbprint);
                            Ok(achado != null, "acha o certificado no repositório do Windows");
                            Ok(Certificado.Titular(achado) == "FAZENDA TESTE LTDA", "nome do titular");
                            const string si = "<SignedInfo xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><DigestValue>abc=</DigestValue></SignedInfo>";
                            var ass = Convert.FromBase64String(Certificado.Assinar(achado, si));
                            using (var pub = achado.GetRSAPublicKey())
                                Ok(pub.VerifyData(Encoding.UTF8.GetBytes(si), ass, HashAlgorithmName.SHA1, RSASignaturePadding.Pkcs1), "assinatura RSA-SHA1 confere");
                            Ok(Certificado.Base64(achado).StartsWith("MII"), "certificado em base64 (DER)");
                        }
                        finally { using (var st = new X509Store(StoreName.My, StoreLocation.CurrentUser)) { st.Open(OpenFlags.ReadWrite); st.Remove(pfx); } }
                    }
                }
                var j = Json.Ler("{\"tipo\":\"assinar\",\"ambiente\":1,\"lote\":{\"itens\":[{\"id\":\"x\",\"signedInfo\":\"<a/>\"}]}}");
                Ok(Json.Txt(j, "tipo") == "assinar" && Json.Num(j, "ambiente") == 1, "lê tarefa do servidor");
                Ok(Json.Lista(Json.Obj(j, "lote"), "itens").Count == 1, "lê o lote de ciência");
                Ok(Json.Escrever(new System.Collections.Generic.Dictionary<string, object> { ["a"] = new[] { "x" } }) == "{\"a\":[\"x\"]}", "escreve JSON");
            }
            catch (Exception e) { log.AppendLine("FALHA exceção: " + e); falhas++; }
            log.AppendLine(falhas == 0 ? "TUDO OK" : falhas + " falha(s)");
            if (saida != null) File.WriteAllText(saida, log.ToString());
            return falhas == 0 ? 0 : 1;
        }
    }
}
