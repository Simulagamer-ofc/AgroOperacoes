package com.simulagamer.agrooperacoes;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Atualização das telas sem reinstalar o APK (núcleo, sem nada do Android — testado no computador por
 * referencias/ota/TesteOta.java).
 *
 * O site publica em ota/ um manifesto assinado com a MESMA chave que assina o APK (manifest.txt + manifest.sig)
 * e cada arquivo das telas com o nome igual ao seu SHA-256 (ota/f/&lt;sha&gt;). O app só aceita o pacote se a
 * assinatura conferir com o certificado do próprio APK instalado e se cada arquivo tiver exatamente o SHA-256
 * do manifesto. Arquivos que não mudaram são copiados do próprio aparelho (só o que mudou é baixado).
 *
 * Estado em &lt;raiz&gt;/estado.properties: ativa (pacote em uso), anterior (o último que abriu bem, para voltar),
 * pronta (baixado, entra ao tocar "Atualizar agora" ou ao abrir o app), testando (1 = acabou de entrar e ainda
 * não confirmou que abriu; 2 = segunda tentativa; na terceira volta sozinho para o anterior) e ruins (não tenta de novo).
 * Os pacotes são identificados pelo carimbo (hora do commit, em segundos), que só cresce.
 */
public final class OtaNucleo {
    private OtaNucleo() {}

    public static final String CABECALHO = "mercaplant-ota 1";
    private static final Pattern CAMINHO = Pattern.compile("[A-Za-z0-9_][A-Za-z0-9._-]*(/[A-Za-z0-9_][A-Za-z0-9._-]*)*");
    private static final Pattern SHA = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern VERSAO = Pattern.compile("[0-9A-Za-z.+_-]{1,40}");
    private static final Pattern APK = Pattern.compile("https://github\\.com/Simulagamer-ofc/AgroOperacoes/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk");
    static final long MAX_ARQUIVO = 40L << 20, MAX_TOTAL = 150L << 20, MAX_MANIFESTO = 1L << 20;

    // ---------------------------------------------------------------- manifesto

    public static final class Arquivo {
        public final String sha, caminho;
        public final long tamanho;
        Arquivo(String sha, long tamanho, String caminho) { this.sha = sha; this.tamanho = tamanho; this.caminho = caminho; }
    }

    public static final class Manifesto {
        public final String versao, apk;
        public final long carimbo;
        public final int nivel;
        public final List<Arquivo> arquivos;
        Manifesto(String versao, long carimbo, int nivel, String apk, List<Arquivo> arquivos) {
            this.versao = versao; this.carimbo = carimbo; this.nivel = nivel; this.apk = apk; this.arquivos = Collections.unmodifiableList(arquivos);
        }
    }

    /** Lê e valida o manifesto (formato de texto simples, uma informação por linha). */
    public static Manifesto ler(byte[] bruto) throws IOException {
        if (bruto.length > MAX_MANIFESTO) throw new IOException("manifesto grande demais");
        String[] linhas = new String(bruto, StandardCharsets.UTF_8).split("\n");
        if (linhas.length == 0 || !CABECALHO.equals(linhas[0].trim())) throw new IOException("manifesto desconhecido");
        String versao = null, apk = null;
        long carimbo = -1;
        int nivel = -1;
        List<Arquivo> arquivos = new ArrayList<>();
        Set<String> vistos = new HashSet<>();
        long total = 0;
        for (int i = 1; i < linhas.length; i++) {
            String l = linhas[i].trim();
            if (l.isEmpty()) continue;
            String[] p = l.split(" ");
            switch (p[0]) {
                case "versao":
                    exigir(p.length == 2 && VERSAO.matcher(p[1]).matches(), "versão inválida");
                    versao = p[1];
                    break;
                case "carimbo":
                    exigir(p.length == 2, "carimbo inválido");
                    carimbo = numero(p[1]);
                    break;
                case "nivel":
                    exigir(p.length == 2, "nível inválido");
                    nivel = (int) Math.min(numero(p[1]), Integer.MAX_VALUE);
                    break;
                case "apk":
                    exigir(p.length == 2 && APK.matcher(p[1]).matches(), "endereço do APK não reconhecido");
                    apk = p[1];
                    break;
                case "arquivo":
                    exigir(p.length == 4 && SHA.matcher(p[1]).matches() && p[3].length() <= 200 && CAMINHO.matcher(p[3]).matches(),
                        "arquivo inválido na linha " + (i + 1));
                    long t = numero(p[2]);
                    exigir(t <= MAX_ARQUIVO, "arquivo grande demais: " + p[3]);
                    exigir(vistos.add(p[3]), "arquivo repetido: " + p[3]);
                    total += t;
                    arquivos.add(new Arquivo(p[1], t, p[3]));
                    break;
                default:
                    // campo de uma versão futura: ignora
            }
        }
        exigir(versao != null && carimbo > 0 && nivel >= 0 && vistos.contains("index.html"), "manifesto incompleto");
        exigir(total <= MAX_TOTAL, "pacote grande demais");
        return new Manifesto(versao, carimbo, nivel, apk, arquivos);
    }

    private static void exigir(boolean ok, String motivo) throws IOException { if (!ok) throw new IOException(motivo); }

    private static long numero(String s) throws IOException {
        try {
            long n = Long.parseLong(s);
            if (n < 0) throw new IOException("número negativo");
            return n;
        } catch (NumberFormatException e) {
            throw new IOException("número inválido");
        }
    }

    // ---------------------------------------------------------------- assinatura e hash

    /** Chaves públicas dos certificados que assinam o APK (bytes DER de cada certificado). */
    public static List<PublicKey> chavesDosCertificados(Collection<byte[]> certificados) {
        List<PublicKey> chaves = new ArrayList<>();
        for (byte[] der : certificados) {
            try {
                chaves.add(CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(der)).getPublicKey());
            } catch (Exception ignorado) {
                // certificado ilegível: não serve para conferir
            }
        }
        return chaves;
    }

    static String algoritmo(String tipoChave) {
        switch (tipoChave) {
            case "RSA": return "SHA256withRSA";
            case "EC": return "SHA256withECDSA";
            case "DSA": return "SHA256withDSA";
            default: return null;
        }
    }

    public static boolean assinaturaValida(byte[] dados, byte[] assinatura, Collection<PublicKey> chaves) {
        for (PublicKey k : chaves) {
            String alg = algoritmo(k.getAlgorithm());
            if (alg == null) continue;
            try {
                Signature s = Signature.getInstance(alg);
                s.initVerify(k);
                s.update(dados);
                if (s.verify(assinatura)) return true;
            } catch (Exception ignorado) {
                // assinatura malformada para esta chave: tenta a próxima
            }
        }
        return false;
    }

    static MessageDigest novoSha() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    static byte[] lerTudo(InputStream in, long max) throws IOException {
        try (InputStream ent = in) {
            ByteArrayOutputStream sai = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            long total = 0;
            for (int n; (n = ent.read(buf)) >= 0; ) {
                total += n;
                if (total > max) throw new IOException("resposta grande demais");
                sai.write(buf, 0, n);
            }
            return sai.toByteArray();
        }
    }

    /** Copia para [destino] conferindo tamanho e SHA-256; se não bater, apaga e devolve false. */
    static boolean copiarConferindo(InputStream in, File destino, Arquivo a) throws IOException {
        MessageDigest md = novoSha();
        long total = 0;
        try (InputStream ent = in; OutputStream sai = new FileOutputStream(destino)) {
            byte[] buf = new byte[65536];
            for (int n; (n = ent.read(buf)) >= 0; ) {
                total += n;
                if (total > a.tamanho) break;
                md.update(buf, 0, n);
                sai.write(buf, 0, n);
            }
        }
        boolean ok = total == a.tamanho && hex(md.digest()).equals(a.sha);
        if (!ok) destino.delete();
        return ok;
    }

    // ---------------------------------------------------------------- rede e fontes

    /** Abre um endereço e devolve o conteúdo (lança IOException se não for 200). */
    public interface Rede { InputStream abrir(String url) throws IOException; }

    /** Arquivo das telas que já vem dentro do APK (null ou exceção se não existir). */
    public interface Fonte { InputStream abrir(String caminho) throws IOException; }

    public interface Progresso { void avisar(long feito, long total); }

    /** HttpURLConnection seguindo até 5 redirecionamentos (o GitHub Pages redireciona para o domínio próprio). */
    public static Rede redePadrao(final boolean soHttps) {
        return url -> {
            URL u = new URL(url);
            for (int saltos = 0; ; saltos++) {
                if (soHttps && !"https".equals(u.getProtocol())) throw new IOException("endereço inseguro");
                HttpURLConnection con = (HttpURLConnection) u.openConnection();
                con.setInstanceFollowRedirects(false);
                con.setConnectTimeout(15_000);
                con.setReadTimeout(30_000);
                con.setRequestProperty("Cache-Control", "no-cache");
                int codigo = con.getResponseCode();
                if (codigo >= 300 && codigo < 400 && saltos < 5) {
                    String prox = con.getHeaderField("Location");
                    con.disconnect();
                    if (prox == null) throw new IOException("redirecionamento sem destino");
                    u = new URL(u, prox);
                    continue;
                }
                if (codigo != 200) {
                    con.disconnect();
                    throw new IOException("servidor respondeu " + codigo);
                }
                return con.getInputStream();
            }
        };
    }

    // ---------------------------------------------------------------- estado

    public static final class Estado {
        public long ativa, anterior, pronta, vista;
        public int testando;
        public final Set<Long> ruins = new TreeSet<>();

        static Estado ler(File raiz) {
            Estado e = new Estado();
            File f = new File(raiz, "estado.properties");
            if (!f.isFile()) return e;
            Properties p = new Properties();
            try (InputStream in = new FileInputStream(f)) {
                p.load(in);
                e.ativa = Long.parseLong(p.getProperty("ativa", "0"));
                e.anterior = Long.parseLong(p.getProperty("anterior", "0"));
                e.pronta = Long.parseLong(p.getProperty("pronta", "0"));
                e.vista = Long.parseLong(p.getProperty("vista", "0"));
                e.testando = Integer.parseInt(p.getProperty("testando", "0"));
                for (String r : p.getProperty("ruins", "").split(",")) if (!r.isEmpty()) e.ruins.add(Long.parseLong(r));
            } catch (Exception ignorado) {
                return new Estado(); // estado corrompido: volta para as telas do APK
            }
            return e;
        }

        void gravar(File raiz) throws IOException {
            raiz.mkdirs();
            Properties p = new Properties();
            p.setProperty("ativa", String.valueOf(ativa));
            p.setProperty("anterior", String.valueOf(anterior));
            p.setProperty("pronta", String.valueOf(pronta));
            p.setProperty("vista", String.valueOf(vista));
            p.setProperty("testando", String.valueOf(testando));
            List<Long> lista = new ArrayList<>(ruins);
            while (lista.size() > 20) lista.remove(0);
            StringBuilder sb = new StringBuilder();
            for (Long r : lista) sb.append(sb.length() > 0 ? "," : "").append(r);
            p.setProperty("ruins", sb.toString());
            File tmp = new File(raiz, "estado.tmp");
            try (OutputStream out = new FileOutputStream(tmp)) { p.store(out, "MercaPlant: telas atualizadas"); }
            File f = new File(raiz, "estado.properties");
            if (!tmp.renameTo(f)) {
                f.delete();
                if (!tmp.renameTo(f)) throw new IOException("não gravou o estado");
            }
        }
    }

    public static File pasta(File raiz, long carimbo) { return new File(raiz, "b" + carimbo); }

    /** Pasta com os arquivos das telas de um pacote. */
    public static File arquivos(File raiz, long carimbo) { return new File(pasta(raiz, carimbo), "w"); }

    static boolean completa(File raiz, long carimbo) { return carimbo > 0 && new File(pasta(raiz, carimbo), "ok").isFile(); }

    public static synchronized Estado estado(File raiz) { return Estado.ler(raiz); }

    /** Versão escrita no manifesto de um pacote baixado (null se não houver). */
    public static String versaoDe(File raiz, long carimbo) {
        try {
            return ler(lerTudo(new FileInputStream(new File(pasta(raiz, carimbo), "manifest.txt")), MAX_MANIFESTO)).versao;
        } catch (IOException e) {
            return null;
        }
    }

    private static boolean promover(File raiz, Estado e) {
        if (e.pronta <= e.ativa || e.ruins.contains(e.pronta) || !completa(raiz, e.pronta)) {
            e.pronta = 0;
            return false;
        }
        if (e.ativa > 0 && e.testando == 0) e.anterior = e.ativa; // guarda só o que já abriu bem, para poder voltar
        e.ativa = e.pronta;
        e.pronta = 0;
        e.testando = 1;
        return true;
    }

    private static void descartarAntigas(Estado e, long carimboApk) {
        // APK instalado é mais novo que os pacotes baixados: as telas do APK valem
        if (e.ativa <= carimboApk) { e.ativa = 0; e.testando = 0; }
        if (e.anterior <= carimboApk) e.anterior = 0;
        if (e.pronta <= carimboApk) e.pronta = 0;
    }

    private static void limpar(File raiz, Estado e) {
        File[] itens = raiz.listFiles();
        if (itens == null) return;
        for (File f : itens) {
            String n = f.getName();
            if (!n.startsWith("b") || !f.isDirectory()) continue;
            long c;
            try { c = Long.parseLong(n.substring(1)); } catch (NumberFormatException x) { c = -1; }
            if (c != e.ativa && c != e.anterior && c != e.pronta) apagar(f);
        }
    }

    static void apagar(File f) {
        File[] filhos = f.listFiles();
        if (filhos != null) for (File x : filhos) apagar(x);
        f.delete();
    }

    /**
     * Ao abrir o app: decide de onde vêm as telas. Devolve a pasta dos arquivos (ou null = as do APK).
     * Também conta as aberturas sem confirmação e volta para o anterior se o pacote novo não abrir.
     */
    public static synchronized File abrir(File raiz, long carimboApk) {
        Estado e = Estado.ler(raiz);
        descartarAntigas(e, carimboApk);
        if (e.ativa > 0 && !completa(raiz, e.ativa)) { e.ativa = e.anterior; e.anterior = 0; e.testando = 0; }
        if (e.ativa > 0 && e.testando >= 2) {
            e.ruins.add(e.ativa);
            e.ativa = e.anterior;
            e.anterior = 0;
            e.testando = 0;
        } else if (e.ativa > 0 && e.testando == 1) {
            e.testando = 2;
        }
        promover(raiz, e);
        limpar(raiz, e);
        gravarSemFalhar(e, raiz);
        return e.ativa > 0 ? arquivos(raiz, e.ativa) : null;
    }

    /** "Atualizar agora": coloca em uso o pacote pronto. Devolve a pasta nova ou null se não havia nada pronto. */
    public static synchronized File aplicarPronta(File raiz, long carimboApk) {
        Estado e = Estado.ler(raiz);
        descartarAntigas(e, carimboApk);
        boolean ok = promover(raiz, e);
        limpar(raiz, e);
        gravarSemFalhar(e, raiz);
        return ok ? arquivos(raiz, e.ativa) : null;
    }

    /** A página abriu direitinho com o pacote novo. */
    public static synchronized void confirmar(File raiz) {
        Estado e = Estado.ler(raiz);
        if (e.testando == 0) return;
        e.testando = 0;
        gravarSemFalhar(e, raiz);
    }

    /** O pacote novo não abriu: marca como ruim e volta para o anterior (ou para as telas do APK). */
    public static synchronized boolean reverter(File raiz) {
        Estado e = Estado.ler(raiz);
        if (e.ativa == 0) return false;
        e.ruins.add(e.ativa);
        e.ativa = e.anterior;
        e.anterior = 0;
        e.testando = 0;
        limpar(raiz, e);
        gravarSemFalhar(e, raiz);
        return true;
    }

    private static void gravarSemFalhar(Estado e, File raiz) {
        try { e.gravar(raiz); } catch (IOException ignorado) { /* sem espaço: segue com o que está em uso */ }
    }

    // ---------------------------------------------------------------- baixar

    /** Monta o pacote em &lt;raiz&gt;/tmp e só no fim troca para b&lt;carimbo&gt;. Devolve {arquivos baixados, bytes baixados}. */
    static long[] preparar(File raiz, Manifesto m, byte[] bruto, byte[] sig, String base, Fonte apk, Rede rede, Progresso prog) throws IOException {
        if (completa(raiz, m.carimbo)) { registrarPronta(raiz, m.carimbo); return new long[]{0, 0}; }
        File tmp = new File(raiz, "tmp");
        apagar(tmp);
        File w = new File(tmp, "w");
        if (!w.mkdirs()) throw new IOException("sem espaço no aparelho");
        // Arquivos iguais que já estão no aparelho (pacote em uso ou anterior): copia em vez de baixar
        Map<String, File> locais = new HashMap<>();
        Estado e = estado(raiz);
        for (long c : new long[]{e.anterior, e.ativa, e.pronta}) {
            if (!completa(raiz, c)) continue;
            try {
                for (Arquivo a : ler(lerTudo(new FileInputStream(new File(pasta(raiz, c), "manifest.txt")), MAX_MANIFESTO)).arquivos)
                    locais.put(a.sha, new File(arquivos(raiz, c), a.caminho));
            } catch (IOException ignorado) {
                // manifesto antigo ilegível: baixa de novo
            }
        }
        long total = 0, feito = 0, baixados = 0, bytes = 0;
        for (Arquivo a : m.arquivos) total += a.tamanho;
        for (Arquivo a : m.arquivos) {
            File destino = new File(w, a.caminho);
            File pai = destino.getParentFile();
            if (pai != null && !pai.isDirectory() && !pai.mkdirs()) throw new IOException("sem espaço no aparelho");
            boolean ok = false;
            File local = locais.get(a.sha);
            if (local != null && local.isFile()) ok = copiarConferindo(new FileInputStream(local), destino, a);
            if (!ok && apk != null) {
                InputStream in = null;
                try { in = apk.abrir(a.caminho); } catch (IOException ignorado) { /* não está no APK */ }
                if (in != null) ok = copiarConferindo(in, destino, a);
            }
            if (!ok) {
                if (!copiarConferindo(rede.abrir(base + "f/" + a.sha), destino, a))
                    throw new IOException("o arquivo " + a.caminho + " chegou diferente do esperado");
                baixados++;
                bytes += a.tamanho;
            }
            feito += a.tamanho;
            if (prog != null) prog.avisar(feito, total);
        }
        try (OutputStream o = new FileOutputStream(new File(tmp, "manifest.txt"))) { o.write(bruto); }
        try (OutputStream o = new FileOutputStream(new File(tmp, "manifest.sig"))) { o.write(sig); }
        synchronized (OtaNucleo.class) {
            File fim = pasta(raiz, m.carimbo);
            apagar(fim);
            if (!tmp.renameTo(fim)) throw new IOException("não conseguiu guardar o pacote");
            if (!new File(fim, "ok").createNewFile()) throw new IOException("não conseguiu guardar o pacote");
            registrarPronta(raiz, m.carimbo);
        }
        return new long[]{baixados, bytes};
    }

    private static synchronized void registrarPronta(File raiz, long carimbo) throws IOException {
        Estado e = Estado.ler(raiz);
        if (carimbo > e.pronta) e.pronta = carimbo;
        limpar(raiz, e);
        e.gravar(raiz);
    }

    /** As telas do manifesto são idênticas às que estão em uso (pacote ativo ou, sem ele, as do APK)? */
    static boolean igualAoEmUso(File raiz, Estado e, Manifesto m, Fonte apk) {
        if (e.pronta > 0) return false;
        try {
            if (e.ativa > 0) {
                Manifesto atual = ler(lerTudo(new FileInputStream(new File(pasta(raiz, e.ativa), "manifest.txt")), MAX_MANIFESTO));
                if (atual.arquivos.size() != m.arquivos.size()) return false;
                for (int i = 0; i < m.arquivos.size(); i++) {
                    Arquivo a = m.arquivos.get(i), b = atual.arquivos.get(i);
                    if (!a.sha.equals(b.sha) || !a.caminho.equals(b.caminho)) return false;
                }
                return true;
            }
            if (apk == null) return false;
            byte[] buf = new byte[65536];
            for (Arquivo a : m.arquivos) {
                InputStream in;
                try { in = apk.abrir(a.caminho); } catch (IOException x) { return false; }
                if (in == null) return false;
                MessageDigest md = novoSha();
                try (InputStream ent = in) { for (int n; (n = ent.read(buf)) >= 0; ) md.update(buf, 0, n); }
                if (!hex(md.digest()).equals(a.sha)) return false;
            }
            return true;
        } catch (IOException x) {
            return false;
        }
    }

    public static final class Resultado {
        /** atual | pronta | precisa-apk | erro */
        public String situacao = "erro";
        public String versao, apk, erro;
        public long carimbo;
        public int nivel;
        public long arquivosBaixados, bytesBaixados;
    }

    /**
     * Confere o site e, se houver telas novas compatíveis com este APK, baixa e deixa prontas.
     * [bases] terminam com "/" (ex.: https://mercaplant.com.br/ota/); tenta uma por uma.
     */
    public static Resultado verificar(File raiz, List<String> bases, long carimboApk, int nivelNativo,
                                      Collection<PublicKey> chaves, Fonte apk, Rede rede, Progresso prog) {
        Resultado r = new Resultado();
        String erro = "sem conexão";
        for (String base : bases) {
            try {
                long t = System.currentTimeMillis();
                byte[] man = lerTudo(rede.abrir(base + "manifest.txt?t=" + t), MAX_MANIFESTO);
                byte[] sig = lerTudo(rede.abrir(base + "manifest.sig?t=" + t), 16384);
                if (!assinaturaValida(man, sig, chaves)) throw new IOException("a assinatura do pacote não confere com a do app");
                Manifesto m = ler(man);
                r.versao = m.versao;
                r.carimbo = m.carimbo;
                r.nivel = m.nivel;
                r.apk = m.apk;
                Estado e = estado(raiz);
                long atual = Math.max(Math.max(carimboApk, e.vista), Math.max(e.ativa, e.pronta));
                if (m.carimbo <= atual || e.ruins.contains(m.carimbo)) {
                    r.situacao = "atual";
                    return r;
                }
                if (m.nivel > nivelNativo) {
                    r.situacao = "precisa-apk";
                    return r;
                }
                // Publicação nova sem mudança nas telas (ex.: só documentação): anota e não oferece nada
                if (igualAoEmUso(raiz, e, m, apk)) {
                    synchronized (OtaNucleo.class) {
                        Estado e2 = Estado.ler(raiz);
                        if (m.carimbo > e2.vista) e2.vista = m.carimbo;
                        e2.gravar(raiz);
                    }
                    r.situacao = "atual";
                    return r;
                }
                long[] q = preparar(raiz, m, man, sig, base, apk, rede, prog);
                r.arquivosBaixados = q[0];
                r.bytesBaixados = q[1];
                r.situacao = "pronta";
                return r;
            } catch (IOException | RuntimeException ex) {
                erro = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
            }
        }
        r.situacao = "erro";
        r.erro = erro;
        return r;
    }
}
