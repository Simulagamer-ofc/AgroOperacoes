using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace MercaPlantConecta
{
    /// <summary>Configuração deste computador. A chave de acesso fica protegida pelo Windows (DPAPI, só este usuário lê).</summary>
    public class Config
    {
        public string Fazenda = "";
        public string FarmId = "";
        public string Token = "";            // chave do computador (em memória); no disco vai criptografada
        public string CertThumbprint = "";   // certificado escolhido (token/cartão) — só a identificação
        public string CertTitular = "";
        public string CertValidade = "";
        public bool IniciarComWindows = true;

        public static string Pasta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MercaPlant Conecta");
        static string Arquivo => Path.Combine(Pasta, "config.json");
        public bool Ligado => !string.IsNullOrEmpty(Token);

        public static Config Ler()
        {
            var c = new Config();
            try
            {
                if (!File.Exists(Arquivo)) return c;
                var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Arquivo, Encoding.UTF8));
                c.Fazenda = Json.Txt(d, "fazenda");
                c.FarmId = Json.Txt(d, "farmId");
                c.CertThumbprint = Json.Txt(d, "certThumbprint");
                c.CertTitular = Json.Txt(d, "certTitular");
                c.CertValidade = Json.Txt(d, "certValidade");
                c.IniciarComWindows = !d.ContainsKey("iniciarComWindows") || Equals(d["iniciarComWindows"], true);
                var prot = Json.Txt(d, "token");
                if (prot != "")
                    c.Token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(prot), Entropia, DataProtectionScope.CurrentUser));
            }
            catch { /* arquivo danificado: começa do zero */ }
            return c;
        }

        public void Salvar()
        {
            Directory.CreateDirectory(Pasta);
            var prot = Token == "" ? "" : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Token), Entropia, DataProtectionScope.CurrentUser));
            var d = new Dictionary<string, object>
            {
                ["fazenda"] = Fazenda, ["farmId"] = FarmId, ["token"] = prot, ["certThumbprint"] = CertThumbprint,
                ["certTitular"] = CertTitular, ["certValidade"] = CertValidade, ["iniciarComWindows"] = IniciarComWindows
            };
            File.WriteAllText(Arquivo, new JavaScriptSerializer().Serialize(d), Encoding.UTF8);
        }

        static readonly byte[] Entropia = Encoding.UTF8.GetBytes("MercaPlant Conecta v1");
    }

    /// <summary>Ajudantes para ler o JSON do servidor (JavaScriptSerializer devolve dicionários e listas).</summary>
    public static class Json
    {
        public static string Txt(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : "";
        public static int Num(Dictionary<string, object> d, string k, int padrao = 0) => int.TryParse(Txt(d, k), out var n) ? n : padrao;
        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) ? v as Dictionary<string, object> : null;
        public static List<Dictionary<string, object>> Lista(Dictionary<string, object> d, string k)
        {
            var r = new List<Dictionary<string, object>>();
            if (d != null && d.TryGetValue(k, out var v) && v is System.Collections.IEnumerable e && !(v is string))
                foreach (var x in e) if (x is Dictionary<string, object> o) r.Add(o);
            return r;
        }
        public static Dictionary<string, object> Ler(string texto)
        {
            try { return new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Deserialize<Dictionary<string, object>>(texto) ?? new Dictionary<string, object>(); }
            catch { return new Dictionary<string, object>(); }
        }
        public static string Escrever(object o) => new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Serialize(o);
    }
}
