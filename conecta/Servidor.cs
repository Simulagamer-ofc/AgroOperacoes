using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;

namespace MercaPlantConecta
{
    /// <summary>Conversa com o MercaPlant (função sefaz-conecta no Supabase).</summary>
    public class Servidor
    {
        public const string Url = "https://gfvtudfdhooavcchdpnm.supabase.co/functions/v1/sefaz-conecta";
        const string ChaveApp = "sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK"; // chave pública do app (a mesma do site)
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
        readonly Func<string> token;

        public Servidor(Func<string> token) { this.token = token; }

        public class Falha : Exception
        {
            public readonly int Status;
            public Falha(int status, string msg) : base(msg) { Status = status; }
        }

        public Dictionary<string, object> Chamar(string acao, Dictionary<string, object> dados = null)
        {
            dados = dados ?? new Dictionary<string, object>();
            dados["acao"] = acao;
            dados["computador"] = Environment.MachineName;
            dados["versao"] = Programa.Versao;
            var req = new HttpRequestMessage(HttpMethod.Post, Url) { Content = new StringContent(Json.Escrever(dados), Encoding.UTF8, "application/json") };
            req.Headers.Add("apikey", ChaveApp);
            var t = token();
            if (!string.IsNullOrEmpty(t)) req.Headers.Add("x-conecta-token", t);
            HttpResponseMessage r;
            try { r = http.SendAsync(req).GetAwaiter().GetResult(); }
            catch (Exception e) { throw new Falha(0, "Sem conexão com o MercaPlant (" + Raiz(e).Message + "). Confira a internet deste computador."); }
            var texto = r.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            var j = Json.Ler(texto);
            if (!r.IsSuccessStatusCode) throw new Falha((int)r.StatusCode, Json.Txt(j, "message") is var m && m != "" ? m : "O MercaPlant respondeu com erro " + (int)r.StatusCode + ".");
            return j;
        }

        static Exception Raiz(Exception e) { while (e.InnerException != null) e = e.InnerException; return e; }
    }
}
