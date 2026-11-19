using System;
using System.Drawing;
using System.Security.Cryptography.X509Certificates;
using System.Windows.Forms;

namespace MercaPlantConecta
{
    /// <summary>Janela do MercaPlant Conecta (fica na bandeja, perto do relógio do Windows).</summary>
    public class Janela : Form
    {
        static readonly Color Navy = Color.FromArgb(8, 24, 43), Verde = Color.FromArgb(24, 166, 106), Suave = Color.FromArgb(160, 196, 208), Vermelho = Color.FromArgb(224, 90, 90);
        readonly Config cfg;
        readonly Trabalho trab;
        readonly NotifyIcon bandeja;
        readonly Label lblFazenda, lblCert, lblSituacao;
        readonly Button btLigar, btCert, btBuscar, btDesligar;
        readonly CheckBox ckIniciar;
        readonly ListBox registro;
        bool sair;

        public Janela(Config cfg, Trabalho trab, Icon icone)
        {
            this.cfg = cfg; this.trab = trab;
            Text = "MercaPlant Conecta"; Icon = icone;
            ClientSize = new Size(560, 470); FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
            BackColor = Navy; ForeColor = Color.White; Font = new Font("Segoe UI", 10f); StartPosition = FormStartPosition.CenterScreen;

            var titulo = new Label { Text = "MercaPlant Conecta", Font = new Font("Segoe UI Semibold", 16f), AutoSize = true, Location = new Point(20, 16) };
            var sub = new Label { Text = "Certificado A3 (token ou cartão) da fazenda ligado ao MercaPlant", ForeColor = Suave, AutoSize = true, Location = new Point(22, 50) };
            lblFazenda = Rotulo(86); lblCert = Rotulo(116); lblSituacao = Rotulo(146);
            btLigar = Botao("Ligar com código", 20, 186, Verde);
            btCert = Botao("Escolher certificado", 196, 186, Color.FromArgb(16, 45, 66));
            btBuscar = Botao("Buscar agora", 372, 186, Color.FromArgb(16, 45, 66));
            ckIniciar = new CheckBox { Text = "Abrir junto com o Windows (recomendado)", ForeColor = Suave, AutoSize = true, Location = new Point(22, 232), Checked = cfg.IniciarComWindows };
            btDesligar = Botao("Desligar este computador", 372, 228, Color.FromArgb(42, 36, 16)); btDesligar.Height = 30; btDesligar.Font = new Font("Segoe UI", 8.5f);
            registro = new ListBox { Location = new Point(20, 270), Size = new Size(520, 180), BackColor = Color.FromArgb(16, 45, 66), ForeColor = Color.White, BorderStyle = BorderStyle.None, HorizontalScrollbar = true };
            Controls.AddRange(new Control[] { titulo, sub, lblFazenda, lblCert, lblSituacao, btLigar, btCert, btBuscar, ckIniciar, btDesligar, registro });

            btLigar.Click += (s, e) => Ligar();
            btCert.Click += (s, e) => EscolherCertificado(null);
            btBuscar.Click += (s, e) => { trab.BuscarAgora(); Anotar("Buscando agora…", false); };
            btDesligar.Click += (s, e) => Desligar();
            ckIniciar.CheckedChanged += (s, e) => { cfg.IniciarComWindows = ckIniciar.Checked; cfg.Salvar(); Programa.AjustarInicio(cfg.IniciarComWindows); };

            bandeja = new NotifyIcon { Icon = icone, Text = "MercaPlant Conecta", Visible = true, ContextMenuStrip = new ContextMenuStrip() };
            bandeja.ContextMenuStrip.Items.Add("Abrir", null, (s, e) => Mostrar());
            bandeja.ContextMenuStrip.Items.Add("Buscar notas agora", null, (s, e) => trab.BuscarAgora());
            bandeja.ContextMenuStrip.Items.Add("Sair", null, (s, e) => { sair = true; Close(); });
            bandeja.DoubleClick += (s, e) => Mostrar();

            trab.Registro += (m, erro) => NaTela(() => Anotar(m, erro));
            trab.Situacao += m => NaTela(() => { lblSituacao.Text = "Situação: " + m; bandeja.Text = Corta("MercaPlant Conecta — " + m, 63); });
            trab.PrecisaCertificado += m => NaTela(() => { bandeja.ShowBalloonTip(8000, "MercaPlant Conecta", m, ToolTipIcon.Warning); Atualizar(); });
            trab.Desligado += () => NaTela(Atualizar);
            Atualizar();
        }

        Label Rotulo(int y) => new Label { AutoSize = false, Size = new Size(520, 26), Location = new Point(20, y), ForeColor = Color.White };
        Button Botao(string t, int x, int y, Color fundo) => new Button { Text = t, Location = new Point(x, y), Size = new Size(168, 36), BackColor = fundo, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, FlatAppearance = { BorderSize = 0 }, Cursor = Cursors.Hand };
        static string Corta(string s, int n) => s.Length <= n ? s : s.Substring(0, n - 1) + "…";
        void NaTela(Action a) { if (IsDisposed) return; if (InvokeRequired) BeginInvoke(a); else a(); }

        void Anotar(string m, bool erro)
        {
            registro.Items.Insert(0, DateTime.Now.ToString("dd/MM HH:mm") + "  " + (erro ? "⚠ " : "") + m);
            while (registro.Items.Count > 200) registro.Items.RemoveAt(registro.Items.Count - 1);
            if (erro && !Visible) bandeja.ShowBalloonTip(6000, "MercaPlant Conecta", Corta(m, 250), ToolTipIcon.Warning);
        }

        void Atualizar()
        {
            lblFazenda.Text = cfg.Ligado ? "Fazenda: " + cfg.Fazenda : "Fazenda: este computador ainda não está ligado";
            lblFazenda.ForeColor = cfg.Ligado ? Color.White : Vermelho;
            var validade = DateTime.TryParse(cfg.CertValidade, out var v) ? " — válido até " + v.ToLocalTime().ToString("dd/MM/yyyy") : "";
            lblCert.Text = cfg.CertThumbprint != "" ? "Certificado: " + cfg.CertTitular + validade : "Certificado: nenhum escolhido";
            btCert.Enabled = btBuscar.Enabled = btDesligar.Enabled = cfg.Ligado;
            btLigar.Text = cfg.Ligado ? "Ligar de novo" : "Ligar com código";
            if (!cfg.Ligado) lblSituacao.Text = "Situação: no MercaPlant, vá em Notas da SEFAZ → Certificado A3 → Gerar código";
        }

        void Ligar()
        {
            var codigo = Perguntar("Ligar à fazenda", "Digite o código de ligação que aparece no MercaPlant\n(Notas da SEFAZ → Certificado A3 → Gerar código):");
            if (string.IsNullOrWhiteSpace(codigo)) return;
            try
            {
                Cursor = Cursors.WaitCursor;
                trab.Ligar(codigo.Trim());
                Atualizar();
                EscolherCertificado("Agora escolha o certificado A3 da fazenda (token ou cartão conectado).");
            }
            catch (Exception e) { MessageBox.Show(this, e.Message, "MercaPlant Conecta", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            finally { Cursor = Cursors.Default; }
        }

        void EscolherCertificado(string aviso)
        {
            if (!cfg.Ligado) return;
            var lista = Certificado.Disponiveis();
            if (lista.Count == 0)
            {
                MessageBox.Show(this, "Nenhum certificado encontrado neste computador.\n\nConecte o token (ou o cartão na leitora) e confira se o programa do fabricante está instalado " +
                    "(ex.: SafeNet Authentication Client, GD Burti, Watchdata, Gemalto). Depois clique em Escolher certificado de novo.", "MercaPlant Conecta", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            var esc = X509Certificate2UI.SelectFromCollection(lista, "Certificado da fazenda", aviso ?? "Escolha o certificado A3 (e-CNPJ ou e-CPF) da fazenda.", X509SelectionFlag.SingleSelection, Handle);
            if (esc.Count == 0) return;
            try
            {
                Cursor = Cursors.WaitCursor;
                trab.EnviarCertificado(esc[0]);
                Atualizar();
                trab.BuscarAgora();
            }
            catch (Exception e) { MessageBox.Show(this, e.Message, "MercaPlant Conecta", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            finally { Cursor = Cursors.Default; }
        }

        void Desligar()
        {
            if (MessageBox.Show(this, "Desligar este computador do MercaPlant? As notas param de chegar por aqui até ligar de novo com um código novo.", "MercaPlant Conecta",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            cfg.Token = ""; cfg.FarmId = ""; cfg.Fazenda = ""; cfg.Salvar();
            Anotar("Computador desligado. Para o MercaPlant parar de esperar por ele, o ADM também pode desligar em Notas da SEFAZ.", false);
            Atualizar();
        }

        string Perguntar(string titulo, string texto)
        {
            using (var f = new Form { Text = titulo, ClientSize = new Size(420, 160), FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent, MaximizeBox = false, MinimizeBox = false, Font = Font })
            {
                var l = new Label { Text = texto, Location = new Point(14, 12), Size = new Size(392, 46) };
                var t = new TextBox { Location = new Point(14, 64), Width = 392, CharacterCasing = CharacterCasing.Upper, Font = new Font("Consolas", 14f) };
                var ok = new Button { Text = "Ligar", DialogResult = DialogResult.OK, Location = new Point(230, 112), Size = new Size(84, 32) };
                var cancela = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Location = new Point(322, 112), Size = new Size(84, 32) };
                f.Controls.AddRange(new Control[] { l, t, ok, cancela }); f.AcceptButton = ok; f.CancelButton = cancela;
                return f.ShowDialog(this) == DialogResult.OK ? t.Text : null;
            }
        }

        public void Mostrar() { Show(); WindowState = FormWindowState.Normal; Activate(); }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Fechar a janela só esconde: o Conecta continua trabalhando na bandeja
            if (!sair && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true; Hide();
                bandeja.ShowBalloonTip(4000, "MercaPlant Conecta", "Continua funcionando aqui na bandeja. Para encerrar, clique com o botão direito → Sair.", ToolTipIcon.Info);
                return;
            }
            trab.Parar(); bandeja.Visible = false; bandeja.Dispose();
            base.OnFormClosing(e);
            Application.ExitThread(); // encerra o programa (Sair, ou o Windows desligando)
        }
    }
}
