import com.simulagamer.agrooperacoes.OtaNucleo;
import com.sun.net.httpserver.HttpServer;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.PublicKey;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Teste da atualização das telas sem reinstalar, de ponta a ponta no computador: gera chaves com o keytool,
 * monta pacotes com o GerarOta (o mesmo do pages.yml), serve por HTTP local e roda o OtaNucleo (o mesmo do APK).
 *
 *   javac -d /tmp/ota app/src/main/java/com/simulagamer/agrooperacoes/OtaNucleo.java referencias/ota/*.java
 *   java -cp /tmp/ota TesteOta [pasta www real]
 */
public class TesteOta {
    static int ok = 0;

    static void checar(boolean cond, String o_que) {
        if (!cond) throw new AssertionError("FALHOU: " + o_que);
        ok++;
        System.out.println("  ok  " + o_que);
    }

    static File tmp;
    static final AtomicInteger pedidosF = new AtomicInteger();

    public static void main(String[] args) throws Exception {
        tmp = Files.createTempDirectory("teste-ota").toFile();
        File ksRsa = chave("rsa", "RSA"), ksEc = chave("ec", "EC"), ksIntruso = chave("intruso", "RSA");

        // "APK" com as telas v1
        File apk = new File(tmp, "apk-www");
        escrever(apk, "index.html", "<h1>v1</h1>");
        escrever(apk, "app.js", "console.log('v1')");
        escrever(apk, "lib/grande.bin", "x".repeat(200_000));
        escrever(apk, "LICENSE", "MIT");
        OtaNucleo.Fonte fonteApk = c -> {
            File f = new File(apk, c);
            return f.isFile() ? new FileInputStream(f) : null;
        };
        long carimboApk = 1_000;

        // Site: servidor HTTP local servindo <site>/ota/...
        File site = new File(tmp, "site");
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            String p = ex.getRequestURI().getPath();
            if (p.startsWith("/velho/")) { // redirecionamento (como github.io -> domínio próprio)
                ex.getResponseHeaders().add("Location", p.replace("/velho/", "/ota/"));
                ex.sendResponseHeaders(301, -1);
                ex.close();
                return;
            }
            if (p.startsWith("/ota/f/")) pedidosF.incrementAndGet();
            File f = new File(site, p.substring(1));
            if (!f.isFile() || p.contains("..")) { ex.sendResponseHeaders(404, -1); ex.close(); return; }
            byte[] b = Files.readAllBytes(f.toPath());
            ex.sendResponseHeaders(200, b.length);
            try (OutputStream o = ex.getResponseBody()) { o.write(b); }
        });
        srv.start();
        String base = "http://127.0.0.1:" + srv.getAddress().getPort() + "/ota/";
        String baseVelha = "http://127.0.0.1:" + srv.getAddress().getPort() + "/velho/";
        OtaNucleo.Rede rede = OtaNucleo.redePadrao(false);
        List<PublicKey> chaves = chavesDe(ksRsa);
        File raiz = new File(tmp, "aparelho/ota");

        System.out.println("1. Pacote v2: muda app.js e cria novo.js (o resto vem do APK)");
        File w2 = copia(apk, "w2");
        escrever(w2, "app.js", "console.log('v2')");
        escrever(w2, "novo.js", "novo");
        publicar(w2, "1.1.0", 2_000, 1, ksRsa);
        OtaNucleo.Resultado r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("pronta".equals(r.situacao), "verificar deixa a v2 pronta (" + r.situacao + " " + r.erro + ")");
        checar(r.arquivosBaixados == 2 && pedidosF.get() == 2, "só baixou os 2 arquivos que mudaram (" + r.arquivosBaixados + ")");
        checar(OtaNucleo.estado(raiz).pronta == 2_000 && OtaNucleo.estado(raiz).ativa == 0, "pronta = v2, ainda usando as telas do APK");

        System.out.println("2. Abrir o app coloca a v2 em uso (em teste até a página confirmar)");
        File pasta = OtaNucleo.abrir(raiz, carimboApk);
        checar(pasta != null && ler(new File(pasta, "app.js")).equals("console.log('v2')"), "app.js da v2");
        checar(ler(new File(pasta, "lib/grande.bin")).length() == 200_000, "arquivo grande copiado do APK");
        checar(OtaNucleo.estado(raiz).testando == 1, "em teste");
        OtaNucleo.confirmar(raiz);
        checar(OtaNucleo.estado(raiz).testando == 0, "confirmado");
        checar("atual".equals(OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null).situacao), "sem novidade: atual");
        publicar(w2, "1.1.0", 2_500, 1, ksRsa);
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("atual".equals(r.situacao) && OtaNucleo.estado(raiz).vista == 2_500, "publicação nova com as mesmas telas: não oferece nada");

        System.out.println("3. v3 quebrada: não confirma, na 3ª abertura volta para a v2");
        File w3 = copia(w2, "w3");
        escrever(w3, "app.js", "erro de sintaxe(");
        publicar(w3, "1.2.0", 3_000, 1, ksRsa);
        pedidosF.set(0);
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("pronta".equals(r.situacao) && pedidosF.get() == 1, "v3 pronta baixando só 1 arquivo (o resto copiado da v2)");
        pasta = OtaNucleo.abrir(raiz, carimboApk);
        checar(ler(new File(pasta, "app.js")).startsWith("erro"), "abre a v3");
        checar(OtaNucleo.estado(raiz).anterior == 2_000, "guarda a v2 para voltar");
        OtaNucleo.abrir(raiz, carimboApk);
        checar(OtaNucleo.estado(raiz).testando == 2, "2ª chance");
        pasta = OtaNucleo.abrir(raiz, carimboApk);
        checar(pasta != null && ler(new File(pasta, "app.js")).equals("console.log('v2')"), "voltou sozinho para a v2");
        checar(OtaNucleo.estado(raiz).ruins.contains(3_000L), "v3 marcada como ruim");
        checar("atual".equals(OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null).situacao), "não baixa a v3 de novo");

        System.out.println("4. Reverter na hora (página não confirmou em 30 s)");
        File w4 = copia(w2, "w4");
        escrever(w4, "app.js", "v4 travada");
        publicar(w4, "1.3.0", 4_000, 1, ksRsa);
        checar("pronta".equals(OtaNucleo.verificar(raiz, List.of(baseVelha), carimboApk, 1, chaves, fonteApk, rede, null).situacao), "segue redirecionamento (endereço antigo -> novo)");
        pasta = OtaNucleo.aplicarPronta(raiz, carimboApk);
        checar(pasta != null && ler(new File(pasta, "app.js")).equals("v4 travada"), "Atualizar agora coloca a v4");
        checar(OtaNucleo.aplicarPronta(raiz, carimboApk) == null, "nada mais pronto");
        checar(OtaNucleo.reverter(raiz), "reverter");
        pasta = OtaNucleo.abrir(raiz, carimboApk);
        checar(ler(new File(pasta, "app.js")).equals("console.log('v2')"), "volta para a v2");

        System.out.println("5. Segurança");
        File w5 = copia(w2, "w5");
        escrever(w5, "app.js", "malicioso");
        publicar(w5, "9.9.9", 5_000, 1, ksIntruso);
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("erro".equals(r.situacao) && r.erro.contains("assinatura"), "recusa pacote assinado por outra chave");
        publicar(w5, "9.9.9", 5_000, 1, ksRsa);
        // troca o conteúdo de um arquivo no servidor, mantendo o manifesto assinado
        String shaApp = OtaNucleo.hex(java.security.MessageDigest.getInstance("SHA-256").digest("malicioso".getBytes(StandardCharsets.UTF_8)));
        Files.writeString(new File(site, "ota/f/" + shaApp).toPath(), "trocado");
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("erro".equals(r.situacao) && r.erro.contains("diferente"), "recusa arquivo alterado no servidor");
        checar(OtaNucleo.estado(raiz).pronta == 0, "nada ficou pronto");
        publicar(w2, "0.9.0", 1_500, 1, ksRsa);
        checar("atual".equals(OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null).situacao), "não volta para versão mais velha");
        for (String ruim : new String[]{"../fora.js", "/abs.js", "a/../b.js", ".oculto", "a//b.js"}) {
            String man = "mercaplant-ota 1\nversao 1\ncarimbo 9\nnivel 1\narquivo " + "0".repeat(64) + " 1 index.html\narquivo " + "1".repeat(64) + " 1 " + ruim + "\n";
            boolean recusou = false;
            try { OtaNucleo.ler(man.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { recusou = true; }
            checar(recusou, "recusa caminho " + ruim);
        }
        boolean recusouApk = false;
        try { OtaNucleo.ler("mercaplant-ota 1\nversao 1\ncarimbo 9\nnivel 1\napk https://outro.site/x.apk\narquivo 0000000000000000000000000000000000000000000000000000000000000000 1 index.html\n".getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { recusouApk = true; }
        checar(recusouApk, "recusa APK de outro endereço");
        boolean recusouHttp = false;
        try { OtaNucleo.redePadrao(true).abrir(base + "manifest.txt"); } catch (IOException e) { recusouHttp = true; }
        checar(recusouHttp, "no aparelho só aceita https");

        System.out.println("6. Mudança na parte Android (nível 2): pede o APK novo, não troca as telas");
        File w6 = copia(w2, "w6");
        escrever(w6, "app.js", "precisa do apk novo");
        publicar(w6, "2.0.0", 6_000, 2, ksRsa, "https://github.com/Simulagamer-ofc/AgroOperacoes/releases/download/v2.0.0/MercaPlant-2.0.0.apk");
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 1, chaves, fonteApk, rede, null);
        checar("precisa-apk".equals(r.situacao) && r.apk.endsWith("MercaPlant-2.0.0.apk"), "precisa-apk com o endereço do APK");
        checar(OtaNucleo.estado(raiz).pronta == 0, "telas não trocadas");
        r = OtaNucleo.verificar(raiz, List.of(base), carimboApk, 2, chaves, fonteApk, rede, null);
        checar("pronta".equals(r.situacao), "APK com nível 2 aceita o pacote");

        System.out.println("7. APK novo instalado (mais novo que os pacotes): volta a usar as telas do APK e limpa");
        checar(OtaNucleo.abrir(raiz, 7_000) == null, "usa as telas do APK");
        File[] sobras = raiz.listFiles(f -> f.getName().startsWith("b"));
        checar(sobras != null && sobras.length == 0, "pacotes antigos apagados");

        System.out.println("8. Chave EC (outro tipo de chave) e estado corrompido");
        File raizEc = new File(tmp, "aparelho-ec/ota");
        publicar(w2, "1.1.0", 2_000, 1, ksEc);
        checar("pronta".equals(OtaNucleo.verificar(raizEc, List.of(base), carimboApk, 1, chavesDe(ksEc), fonteApk, rede, null).situacao), "assinatura EC");
        Files.writeString(new File(raizEc, "estado.properties").toPath(), "ativa=abc");
        checar(OtaNucleo.abrir(raizEc, carimboApk) == null, "estado ilegível: telas do APK, sem travar");

        if (args.length > 0) {
            System.out.println("9. Telas reais do MercaPlant (" + args[0] + ")");
            File saida = new File(tmp, "real");
            String resumo = GerarOta.gerar(new File(args[0]), saida, "1.1.0-beta1", 9_000, 1,
                "https://github.com/Simulagamer-ofc/AgroOperacoes/releases/download/v1.1.0-beta1/MercaPlant-1.1.0-beta1.apk",
                ksRsa, "senha123", "mp", "senha123");
            System.out.println("     " + resumo);
            OtaNucleo.Manifesto m = OtaNucleo.ler(Files.readAllBytes(new File(saida, "manifest.txt").toPath()));
            checar(m.arquivos.size() > 50, "manifesto real válido (" + m.arquivos.size() + " arquivos)");
            OtaNucleo.Fonte fonteReal = c -> { File f = new File(args[0], c); return f.isFile() ? new FileInputStream(f) : null; };
            File raizReal = new File(tmp, "aparelho-real/ota");
            File siteReal = new File(site, "ota");
            apagar(siteReal);
            Files.move(saida.toPath(), siteReal.toPath());
            pedidosF.set(0);
            r = OtaNucleo.verificar(raizReal, List.of(base), 8_000, 1, chaves, fonteReal, rede, null);
            checar("atual".equals(r.situacao) && pedidosF.get() == 0, "publicação sem mudança nas telas: nada baixado nem oferecido (" + r.situacao + " " + r.erro + ")");
            checar(OtaNucleo.estado(raizReal).vista == 9_000 && OtaNucleo.estado(raizReal).pronta == 0, "anotada como vista");
        }
        srv.stop(0);
        apagar(tmp);
        System.out.println("TUDO OK (" + ok + " verificações)");
    }

    // ---------------------------------------------------------------- apoio

    static File chave(String nome, String alg) throws Exception {
        File ks = new File(tmp, nome + ".p12");
        List<String> cmd = new ArrayList<>(List.of("keytool", "-genkeypair", "-keystore", ks.getPath(), "-storetype", "PKCS12",
            "-storepass", "senha123", "-keypass", "senha123", "-alias", "mp", "-keyalg", alg, "-dname", "CN=MercaPlant Teste", "-validity", "2"));
        if (alg.equals("RSA")) cmd.addAll(List.of("-keysize", "2048"));
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        String saida = new String(p.getInputStream().readAllBytes());
        if (p.waitFor() != 0) throw new IOException("keytool: " + saida);
        return ks;
    }

    static List<PublicKey> chavesDe(File ks) throws Exception {
        KeyStore k = KeyStore.getInstance(ks, "senha123".toCharArray());
        return OtaNucleo.chavesDosCertificados(List.of(k.getCertificate("mp").getEncoded()));
    }

    static void publicar(File www, String versao, long carimbo, int nivel, File ks) throws Exception { publicar(www, versao, carimbo, nivel, ks, null); }

    static void publicar(File www, String versao, long carimbo, int nivel, File ks, String apk) throws Exception {
        File ota = new File(tmp, "site/ota");
        apagar(ota);
        GerarOta.gerar(www, ota, versao, carimbo, nivel, apk, ks, "senha123", "mp", "senha123");
    }

    static void escrever(File dir, String caminho, String conteudo) throws IOException {
        File f = new File(dir, caminho);
        f.getParentFile().mkdirs();
        Files.writeString(f.toPath(), conteudo);
    }

    static String ler(File f) throws IOException { return Files.readString(f.toPath()); }

    static File copia(File origem, String nome) throws IOException {
        File destino = new File(tmp, nome);
        copiar(origem, destino);
        return destino;
    }

    static void copiar(File o, File d) throws IOException {
        if (o.isDirectory()) {
            d.mkdirs();
            for (File x : o.listFiles()) copiar(x, new File(d, x.getName()));
        } else {
            try (InputStream in = new FileInputStream(o)) { Files.copy(in, d.toPath()); }
        }
    }

    static void apagar(File f) {
        File[] filhos = f.listFiles();
        if (filhos != null) for (File x : filhos) apagar(x);
        f.delete();
    }
}
