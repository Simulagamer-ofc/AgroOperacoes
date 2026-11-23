import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.Key;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.List;

/**
 * Gera o pacote das telas para a atualização sem reinstalar (usado pelo pages.yml).
 *
 *   java referencias/ota/GerarOta.java &lt;pasta www&gt; &lt;saída ota&gt; &lt;versão&gt; &lt;carimbo&gt; &lt;nível&gt; &lt;url do APK ou -&gt;
 *
 * A chave é a mesma que assina o APK, lida dos segredos (variáveis MERCAPLANT_KEYSTORE, MERCAPLANT_KEYSTORE_PASS,
 * MERCAPLANT_KEY_ALIAS, MERCAPLANT_KEY_PASS). Saída: manifest.txt, manifest.sig e f/&lt;sha256&gt; de cada arquivo.
 * O formato é lido por app/src/main/java/com/simulagamer/agrooperacoes/OtaNucleo.java.
 */
public class GerarOta {
    public static void main(String[] a) throws Exception {
        if (a.length != 6) {
            System.err.println("uso: GerarOta <www> <saida> <versao> <carimbo> <nivel> <apk|->");
            System.exit(2);
        }
        String ks = System.getenv("MERCAPLANT_KEYSTORE");
        if (ks == null || ks.isBlank() || !new File(ks).isFile()) {
            System.err.println("sem a chave de assinatura (MERCAPLANT_KEYSTORE)");
            System.exit(3);
        }
        String r = gerar(new File(a[0]), new File(a[1]), a[2], Long.parseLong(a[3]), Integer.parseInt(a[4]), "-".equals(a[5]) ? null : a[5],
            new File(ks), System.getenv("MERCAPLANT_KEYSTORE_PASS"), System.getenv("MERCAPLANT_KEY_ALIAS"), System.getenv("MERCAPLANT_KEY_PASS"));
        System.out.println(r);
    }

    public static String gerar(File www, File saida, String versao, long carimbo, int nivel, String apk,
                               File keystore, String storePass, String alias, String keyPass) throws Exception {
        List<String> caminhos = new ArrayList<>();
        listar(www, "", caminhos);
        caminhos.sort(null);
        File f = new File(saida, "f");
        if (!f.isDirectory() && !f.mkdirs()) throw new IOException("não criou " + f);
        StringBuilder man = new StringBuilder("mercaplant-ota 1\n");
        man.append("versao ").append(versao).append('\n');
        man.append("carimbo ").append(carimbo).append('\n');
        man.append("nivel ").append(nivel).append('\n');
        if (apk != null) man.append("apk ").append(apk).append('\n');
        long total = 0;
        for (String c : caminhos) {
            File arq = new File(www, c);
            String sha = sha256(arq);
            Files.copy(arq.toPath(), new File(f, sha).toPath(), StandardCopyOption.REPLACE_EXISTING);
            man.append("arquivo ").append(sha).append(' ').append(arq.length()).append(' ').append(c).append('\n');
            total += arq.length();
        }
        byte[] bruto = man.toString().getBytes(StandardCharsets.UTF_8);

        char[] sp = storePass == null ? new char[0] : storePass.toCharArray();
        KeyStore k = KeyStore.getInstance(keystore, sp); // JKS ou PKCS12, detectado pelo próprio Java
        String al = alias != null && !alias.isBlank() ? alias : k.aliases().nextElement();
        Key chave = k.getKey(al, keyPass != null && !keyPass.isEmpty() ? keyPass.toCharArray() : sp);
        if (!(chave instanceof PrivateKey)) throw new IOException("a chave '" + al + "' não foi encontrada no keystore");
        PrivateKey priv = (PrivateKey) chave;
        String alg = switch (priv.getAlgorithm()) {
            case "RSA" -> "SHA256withRSA";
            case "EC" -> "SHA256withECDSA";
            case "DSA" -> "SHA256withDSA";
            default -> throw new IOException("tipo de chave não suportado: " + priv.getAlgorithm());
        };
        Signature s = Signature.getInstance(alg);
        s.initSign(priv);
        s.update(bruto);
        byte[] sig = s.sign();
        // Confere com o certificado (o mesmo que o app usa para conferir)
        Certificate cert = k.getCertificate(al);
        PublicKey pub = cert.getPublicKey();
        Signature v = Signature.getInstance(alg);
        v.initVerify(pub);
        v.update(bruto);
        if (!v.verify(sig)) throw new IOException("a assinatura gerada não confere com o certificado");

        Files.write(new File(saida, "manifest.txt").toPath(), bruto);
        Files.write(new File(saida, "manifest.sig").toPath(), sig);
        return "pacote " + versao + " (carimbo " + carimbo + ", nível " + nivel + "): " + caminhos.size() + " arquivos, "
            + (total / 1024) + " KB; certificado SHA-256 " + hex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
    }

    static void listar(File dir, String prefixo, List<String> saida) {
        File[] itens = dir.listFiles();
        if (itens == null) return;
        for (File x : itens) {
            if (x.getName().startsWith(".")) continue;
            if (x.isDirectory()) listar(x, prefixo + x.getName() + "/", saida);
            else saida.add(prefixo + x.getName());
        }
    }

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) >= 0; ) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }
}
