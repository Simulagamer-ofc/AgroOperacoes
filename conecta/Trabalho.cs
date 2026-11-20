using System;
using System.Collections.Generic;
using System.Security.Cryptography.X509Certificates;
using System.Threading;

namespace MercaPlantConecta
{
    /// <summary>
    /// Laço de trabalho: pergunta ao MercaPlant o que fazer e faz (enviar à SEFAZ com o certificado, assinar a ciência).
    /// Quando não há nada, dorme o tempo que o servidor pedir (a SEFAZ só deixa consultar de novo depois de 1 hora sem novidade).
    /// </summary>
    public class Trabalho
    {
        readonly Config cfg;
        readonly Servidor srv;
        readonly AutoResetEvent acordar = new AutoResetEvent(false);
        Thread linha;
        volatile bool parar;

        public event Action<string, bool> Registro;          // (mensagem, é erro)
        public event Action<string> Situacao;                // texto curto para a janela/bandeja
        public event Action<string> PrecisaCertificado;      // pedir ao usuário para escolher o certificado
        public event Action Desligado;                       // ADM desligou este computador

        public Trabalho(Config cfg)
        {
            this.cfg = cfg;
            srv = new Servidor(() => cfg.Token);
        }

        public void Iniciar()
        {
            if (linha != null) return;
            parar = false;
            linha = new Thread(Laco) { IsBackground = true, Name = "MercaPlant Conecta" };
            linha.Start();
        }

        public void Parar() { parar = true; acordar.Set(); }
        public void BuscarAgora() => acordar.Set();

        void Log(string m, bool erro = false) => Registro?.Invoke(m, erro);

        void Laco()
        {
            var espera = 5;
            while (!parar)
            {
                if (cfg.Ligado)
                {
                    try { espera = Rodada(); }
                    catch (Servidor.Falha f) when (f.Status == 401)
                    {
                        Log(f.Message, true); Situacao?.Invoke("Desligado do MercaPlant");
                        cfg.Token = ""; cfg.Salvar(); Desligado?.Invoke(); espera = 60;
                    }
                    catch (Exception e)
                    {
                        Log(e.Message, true); Situacao?.Invoke("Erro: " + e.Message);
                        try { srv.Chamar("erro", new Dictionary<string, object> { ["mensagem"] = e.Message }); } catch { /* sem internet */ }
                        espera = 300;
                    }
                }
                else espera = 3600;
                acordar.WaitOne(TimeSpan.FromSeconds(Math.Max(5, espera)));
            }
            linha = null;
        }

        /// <summary>Uma rodada: segue as tarefas até o servidor mandar aguardar. Devolve quantos segundos dormir.</summary>
        int Rodada()
        {
            var t = srv.Chamar("tarefa");
            for (var passos = 0; passos < 40 && !parar; passos++)
            {
                var tipo = Json.Txt(t, "tipo");
                if (tipo == "aguardar")
                {
                    var s = Json.Num(t, "segundos", 900);
                    var ate = Json.Txt(t, "ate");
                    Situacao?.Invoke(DateTime.TryParse(ate, out var d) ? "Em dia. Próxima consulta à SEFAZ às " + d.ToLocalTime().ToString("HH:mm") : "Em dia");
                    return s;
                }
                if (tipo == "desligado")
                {
                    Log(Json.Txt(t, "mensagem"), true); Situacao?.Invoke("A fazenda não usa mais o certificado A3");
                    return 3600;
                }
                if (tipo == "certificado")
                {
                    var c = Certificado.Achar(cfg.CertThumbprint);
                    if (c != null && Json.Txt(t, "mensagem").IndexOf("venceu", StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        t = EnviarCertificado(c); continue;
                    }
                    var m = Json.Txt(t, "mensagem");
                    Situacao?.Invoke("Escolha o certificado"); PrecisaCertificado?.Invoke(m);
                    return 3600;
                }
                var cert = Certificado.Achar(cfg.CertThumbprint);
                if (cert == null)
                {
                    var m = "O certificado escolhido não foi encontrado. Conecte o token/cartão ou escolha o certificado de novo.";
                    Situacao?.Invoke("Token/cartão não encontrado"); PrecisaCertificado?.Invoke(m);
                    throw new InvalidOperationException(m);
                }
                if (tipo == "enviar")
                {
                    var servico = Json.Txt(t, "servico");
                    Situacao?.Invoke(servico == "dist" ? "Buscando notas na SEFAZ…" : "Enviando ciência à SEFAZ…");
                    var (status, corpo) = Sefaz.Enviar(servico, Json.Num(t, "ambiente", 1), Json.Txt(t, "soap"), cert);
                    var r = srv.Chamar("resposta", new Dictionary<string, object> { ["servico"] = servico, ["status"] = status, ["corpo"] = corpo });
                    Resumo(servico, r);
                    t = Json.Obj(r, "proxima") ?? srv.Chamar("tarefa");
                    continue;
                }
                if (tipo == "assinar")
                {
                    var lote = Json.Obj(t, "lote");
                    var itens = Json.Lista(lote, "itens");
                    Situacao?.Invoke("Assinando a ciência de " + itens.Count + " nota(s)…");
                    var assinaturas = new List<string>();
                    foreach (var it in itens) assinaturas.Add(Certificado.Assinar(cert, Json.Txt(it, "signedInfo")));
                    t = srv.Chamar("assinado", new Dictionary<string, object> { ["lote"] = lote, ["assinaturas"] = assinaturas, ["cert"] = Certificado.Base64(cert) });
                    continue;
                }
                throw new InvalidOperationException("Tarefa desconhecida do MercaPlant: " + tipo + ". Atualize o MercaPlant Conecta.");
            }
            return 60;
        }

        /// <summary>Manda ao MercaPlant a parte pública do certificado escolhido (CNPJ/CPF, titular, validade).</summary>
        public Dictionary<string, object> EnviarCertificado(X509Certificate2 c)
        {
            var r = srv.Chamar("certificado", new Dictionary<string, object> { ["cert"] = Certificado.Base64(c) });
            cfg.CertThumbprint = c.Thumbprint; cfg.CertTitular = Json.Txt(r, "titular"); cfg.CertValidade = Json.Txt(r, "validade");
            cfg.Salvar();
            Log("Certificado aceito: " + cfg.CertTitular + " (" + Json.Txt(r, "tipo") + " " + Json.Txt(r, "doc") + ")");
            return Json.Obj(r, "proxima") ?? srv.Chamar("tarefa");
        }

        public Dictionary<string, object> Ligar(string codigo)
        {
            var r = new Servidor(() => "").Chamar("ligar", new Dictionary<string, object> { ["codigo"] = codigo });
            cfg.Token = Json.Txt(r, "token"); cfg.FarmId = Json.Txt(r, "farm_id"); cfg.Fazenda = Json.Txt(r, "fazenda");
            cfg.Salvar();
            Log("Ligado à fazenda " + cfg.Fazenda + ".");
            return r;
        }

        void Resumo(string servico, Dictionary<string, object> r)
        {
            var erro = Json.Txt(r, "erro");
            if (erro != "") { Log(erro, true); return; }
            if (servico == "dist")
            {
                int n = Json.Num(r, "novas"), c = Json.Num(r, "completas"), x = Json.Num(r, "canceladas");
                Log(n + c + x == 0 ? "Consulta à SEFAZ feita: nenhuma nota nova." : $"Notas: {n} nova(s), {c} completa(s), {x} cancelada(s).");
                var motivo = Json.Txt(r, "motivo"); if (motivo != "") Log(motivo, true);
            }
            else
            {
                Log("Ciência da Operação registrada em " + Json.Num(r, "ciencias") + " nota(s).");
                foreach (var f in (r.TryGetValue("cienciaFalhas", out var v) && v is System.Collections.IEnumerable e ? e : new object[0])) Log("Ciência não registrada: " + f, true);
            }
        }
    }
}
