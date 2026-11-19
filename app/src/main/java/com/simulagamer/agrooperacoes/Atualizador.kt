package com.simulagamer.agrooperacoes

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Atualização dentro do app: baixa o APK da página de versões do GitHub, confere a assinatura e abre o instalador
 * do Android ("Deseja atualizar este app?"). Com a chave fixa, instala por cima e mantém os dados.
 * Fora da Play Store o Android sempre pede essa confirmação (e, na 1ª vez, a permissão de instalar apps).
 */
object Atualizador {
    // Só aceita APK publicado no repositório do MercaPlant
    private val URL_SEGURA = Regex("^https://github\\.com/Simulagamer-ofc/AgroOperacoes/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk$")
    private const val PASTA = "atualizacao"
    @Volatile private var baixando = false
    /** APK baixado esperando a permissão de "instalar apps desconhecidos". */
    var pendente: File? = null
        private set

    fun urlValida(url: String) = URL_SEGURA.matches(url)

    /** [avisar] recebe (etapa, porcentagem, mensagem) para a página mostrar o andamento. */
    fun baixar(act: Activity, url: String, avisar: (String, Int, String) -> Unit) {
        if (!urlValida(url)) { avisar("erro", 0, "Endereço de atualização não reconhecido."); return }
        if (baixando) return
        baixando = true
        Thread {
            try {
                val pasta = File(act.cacheDir, PASTA).apply { mkdirs() }
                pasta.listFiles()?.forEach { it.delete() }
                val destino = File(pasta, "MercaPlant.apk")
                var con = URL(url).openConnection() as HttpURLConnection
                // O GitHub redireciona para o armazenamento dele (sempre https)
                var saltos = 0
                while (true) {
                    con.instanceFollowRedirects = false
                    con.connectTimeout = 20_000; con.readTimeout = 30_000
                    val codigo = con.responseCode
                    if (codigo in 300..399 && saltos < 5) {
                        val prox = con.getHeaderField("Location") ?: break
                        if (!prox.startsWith("https://")) throw IllegalStateException("redirecionamento inseguro")
                        con.disconnect(); con = URL(prox).openConnection() as HttpURLConnection; saltos++
                        continue
                    }
                    if (codigo != 200) throw IllegalStateException("servidor respondeu $codigo")
                    break
                }
                val total = con.contentLengthLong
                var lido = 0L
                var ultimo = -1
                con.inputStream.use { ent ->
                    destino.outputStream().use { sai ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = ent.read(buf); if (n < 0) break
                            sai.write(buf, 0, n); lido += n
                            val pct = if (total > 0) (lido * 100 / total).toInt() else -1
                            if (pct != ultimo && (pct < 0 || pct % 5 == 0)) { ultimo = pct; avisar("baixando", pct, "") }
                        }
                    }
                }
                con.disconnect()
                if (total > 0 && lido != total) throw IllegalStateException("download incompleto")
                val conf = conferirAssinatura(act, destino)
                if (conf != null) { destino.delete(); avisar("chave", 0, conf); return@Thread }
                act.runOnUiThread { instalarOuPedirPermissao(act, destino, avisar) }
            } catch (e: Exception) {
                avisar("erro", 0, "Não foi possível baixar a atualização (${e.message ?: "sem conexão"}). Tente de novo.")
            } finally {
                baixando = false
            }
        }.start()
    }

    /** null = pode instalar por cima; texto = motivo para não instalar. */
    private fun conferirAssinatura(ctx: Context, apk: File): String? {
        val pm = ctx.packageManager
        val novo = infoArquivo(pm, apk.absolutePath) ?: return "O arquivo baixado não é um APK válido. Tente de novo."
        if (novo.packageName != ctx.packageName) return "O arquivo baixado não é do MercaPlant."
        val instalado = runCatching { infoInstalado(pm, ctx.packageName) }.getOrNull() ?: return null
        val a = digitos(instalado), b = digitos(novo)
        if (a.isEmpty() || b.isEmpty() || a == b) return null
        return "Esta versão usa a nova chave fixa do MercaPlant. Só desta vez é preciso desinstalar o app e instalar o novo " +
            "(sincronize com a nuvem antes). Depois disso, as próximas atualizações instalam por cima."
    }

    @Suppress("DEPRECATION")
    private fun infoArquivo(pm: PackageManager, caminho: String): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 28) pm.getPackageArchiveInfo(caminho, PackageManager.GET_SIGNING_CERTIFICATES)
        else pm.getPackageArchiveInfo(caminho, PackageManager.GET_SIGNATURES)

    @Suppress("DEPRECATION")
    private fun infoInstalado(pm: PackageManager, pacote: String): PackageInfo =
        if (Build.VERSION.SDK_INT >= 28) pm.getPackageInfo(pacote, PackageManager.GET_SIGNING_CERTIFICATES)
        else pm.getPackageInfo(pacote, PackageManager.GET_SIGNATURES)

    @Suppress("DEPRECATION")
    private fun digitos(info: PackageInfo): Set<String> {
        val assinaturas = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.let { si ->
            if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
        } else info.signatures
        val md = MessageDigest.getInstance("SHA-256")
        return assinaturas?.map { s -> md.digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
    }

    private fun instalarOuPedirPermissao(act: Activity, apk: File, avisar: (String, Int, String) -> Unit) {
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            pendente = apk
            avisar("permissao", 100, "Permita que o MercaPlant instale atualizações e volte para o app.")
            runCatching {
                act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
            }
            return
        }
        instalar(act, apk, avisar)
    }

    /** Chamado ao voltar para o app (depois de liberar a permissão). */
    fun continuar(act: Activity, avisar: (String, Int, String) -> Unit) {
        val apk = pendente ?: return
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            avisar("permissao-negada", 0, "Sem a permissão o Android não instala a atualização. Toque em Atualizar para tentar de novo.")
            pendente = null
            return
        }
        pendente = null
        instalar(act, apk, avisar)
    }

    private fun instalar(act: Activity, apk: File, avisar: (String, Int, String) -> Unit) {
        runCatching {
            val uri = FileProvider.getUriForFile(act, "${act.packageName}.fotos", apk)
            act.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            avisar("instalando", 100, "")
        }.onFailure { avisar("erro", 0, "Não foi possível abrir o instalador do Android.") }
    }
}
