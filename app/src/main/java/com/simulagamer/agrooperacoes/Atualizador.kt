package com.simulagamer.agrooperacoes

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Atualização do APK (só quando muda a parte Android; as telas chegam pelo Ota.kt, sem instalar nada).
 *
 * Baixa o APK da página de versões do GitHub, confere se é do MercaPlant e assinado com a mesma chave e instala
 * pelo PackageInstaller do Android:
 *  - Android 12+ com o próprio MercaPlant como instalador (depois da 1ª atualização por dentro): instala sem perguntar.
 *    Nesse caso o APK já é baixado sozinho no Wi-Fi e instala quando o usuário sai do app (ou na hora, em "Instalar agora").
 *  - Nos demais casos o Android mostra "Deseja atualizar este app?" (e, na 1ª vez, a permissão de instalar apps).
 * Ao terminar, o app tenta abrir de novo na mesma tela e deixa a notificação "MercaPlant atualizado".
 */
object Atualizador {
    // Só aceita APK publicado no repositório do MercaPlant
    private val URL_SEGURA = Regex("^https://github\\.com/Simulagamer-ofc/AgroOperacoes/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk$")
    private const val PASTA = "atualizacao"
    private const val PREFS = "atualizador"
    private const val TRABALHO = "instalar-apk-ao-sair"
    const val NOTIF_ID = 7_100_001
    private const val CANAL = "atualizacao"
    @Volatile private var baixando = false

    /** APK baixado esperando a permissão de "instalar apps desconhecidos". */
    var pendente: File? = null
        private set

    /** Andamento para a página (MainActivity registra enquanto está aberta): (etapa, porcentagem, mensagem). */
    @Volatile var ouvinte: ((String, Int, String) -> Unit)? = null

    fun urlValida(url: String) = URL_SEGURA.matches(url)

    private fun prefs(ctx: Context): SharedPreferences = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun avisarOuvinte(etapa: String, pct: Int, msg: String) { ouvinte?.invoke(etapa, pct, msg) }

    // ------------------------------------------------------------------ baixar

    /** Baixa [url] em [destino] (segue os redirecionamentos https do GitHub). */
    private fun baixarArquivo(url: String, destino: File, progresso: (Int) -> Unit) {
        var con = URL(url).openConnection() as HttpURLConnection
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
                    if (pct != ultimo && (pct < 0 || pct % 5 == 0)) { ultimo = pct; progresso(pct) }
                }
            }
        }
        con.disconnect()
        if (total > 0 && lido != total) throw IllegalStateException("download incompleto")
    }

    /** "Atualizar" na faixa da página: baixa e instala na hora. */
    fun baixar(act: Activity, url: String, avisar: (String, Int, String) -> Unit) {
        if (!urlValida(url)) { avisar("erro", 0, "Endereço de atualização não reconhecido."); return }
        // Já baixado (no Wi-Fi, em segundo plano): instala direto
        val pronto = arquivoBaixado(act)
        if (pronto != null && prefs(act).getString("url", "") == url) {
            act.runOnUiThread { instalarOuPedirPermissao(act, pronto, avisar) }
            return
        }
        if (baixando) return
        baixando = true
        Thread {
            try {
                val pasta = File(act.cacheDir, PASTA).apply { mkdirs() }
                pasta.listFiles()?.forEach { it.delete() }
                val destino = File(pasta, "MercaPlant.apk")
                baixarArquivo(url, destino) { pct -> avisar("baixando", pct, "") }
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

    /**
     * Mudou a parte Android: se a instalação silenciosa estiver liberada e a internet não for móvel (cobrada),
     * baixa o APK em segundo plano; ele instala quando o usuário sair do app.
     */
    fun prepararEmSegundoPlano(ctx: Context, url: String, versao: String?) {
        val app = ctx.applicationContext
        if (!urlValida(url) || baixando || !podeSilencioso(app) || redeCobrada(app)) return
        if (arquivoBaixado(app) != null && prefs(app).getString("url", "") == url) return
        baixando = true
        try {
            val pasta = File(app.cacheDir, PASTA).apply { mkdirs() }
            pasta.listFiles()?.forEach { it.delete() }
            val destino = File(pasta, "MercaPlant.apk")
            baixarArquivo(url, destino) { }
            if (conferirAssinatura(app, destino) != null) { destino.delete(); return }
            val codigo = infoArquivo(app.packageManager, destino.absolutePath)?.let { codigoDe(it) } ?: 0L
            prefs(app).edit().putString("url", url).putString("versao", versao ?: "").putLong("codigo", codigo)
                .putString("arquivo", destino.absolutePath).apply()
            avisarOuvinte("baixado", 100, "")
        } catch (_: Exception) {
            // tenta de novo na próxima conferência
        } finally {
            baixando = false
        }
    }

    /** APK novo já baixado e conferido (null se não houver ou se já estiver instalado). */
    private fun arquivoBaixado(ctx: Context): File? {
        val p = prefs(ctx)
        val f = p.getString("arquivo", null)?.let { File(it) } ?: return null
        val instalado = runCatching { codigoDe(ctx.packageManager.getPackageInfo(ctx.packageName, 0)) }.getOrDefault(0L)
        if (!f.isFile || p.getLong("codigo", 0L) <= instalado) {
            f.delete(); p.edit().remove("arquivo").remove("url").remove("versao").remove("codigo").apply()
            return null
        }
        return f
    }

    fun baixadoVersao(ctx: Context): String? = arquivoBaixado(ctx)?.let { prefs(ctx).getString("versao", "") }

    @Suppress("DEPRECATION")
    private fun codigoDe(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    private fun redeCobrada(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
        return runCatching { cm.isActiveNetworkMetered }.getOrDefault(true)
    }

    /** Android 12+ e o próprio MercaPlant como instalador: atualiza sem perguntar. */
    fun podeSilencioso(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31) return false
        val pm = ctx.packageManager
        if (!pm.canRequestPackageInstalls()) return false
        val instalador = runCatching { pm.getInstallSourceInfo(ctx.packageName).installingPackageName }.getOrNull()
        return instalador == ctx.packageName
    }

    // ------------------------------------------------------------------ conferir

    /** null = pode instalar por cima; texto = motivo para não instalar. */
    private fun conferirAssinatura(ctx: Context, apk: File): String? {
        val pm = ctx.packageManager
        val novo = infoArquivo(pm, apk.absolutePath) ?: return "O arquivo baixado não é um APK válido. Tente de novo."
        if (novo.packageName != ctx.packageName) return "O arquivo baixado não é do MercaPlant."
        val instalado = runCatching { infoInstalado(pm, ctx.packageName) }.getOrNull() ?: return null
        val a = digitos(instalado)
        val b = digitos(novo)
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

    // ------------------------------------------------------------------ instalar

    private fun instalarOuPedirPermissao(act: Activity, apk: File, avisar: (String, Int, String) -> Unit) {
        if (!act.packageManager.canRequestPackageInstalls()) {
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
        if (!act.packageManager.canRequestPackageInstalls()) {
            avisar("permissao-negada", 0, "Sem a permissão o Android não instala a atualização. Toque em Atualizar para tentar de novo.")
            pendente = null
            return
        }
        pendente = null
        instalar(act, apk, avisar)
    }

    private fun instalar(act: Activity, apk: File, avisar: (String, Int, String) -> Unit) {
        val silencioso = podeSilencioso(act)
        avisar("instalando", 100, if (silencioso) "Instalando… o MercaPlant fecha e abre de novo em alguns segundos, já atualizado."
            else "Confirme <b>Atualizar</b> na tela do Android. Seus dados continuam no app.")
        val app = act.applicationContext
        Thread {
            try {
                instalarSessao(app, apk, reabrir = true)
            } catch (e: Exception) {
                avisar("erro", 0, "Não foi possível abrir o instalador do Android (${e.message ?: "erro"}).")
            }
        }.start()
    }

    /** Instala pelo PackageInstaller (sem perguntar quando o Android permite). */
    private fun instalarSessao(ctx: Context, apk: File, reabrir: Boolean) {
        val app = ctx.applicationContext
        val pi = app.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(app.packageName)
            setSize(apk.length())
            setInstallReason(PackageManager.INSTALL_REASON_USER)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = pi.createSession(params)
        try {
            pi.openSession(id).use { s ->
                apk.inputStream().use { ent ->
                    s.openWrite("MercaPlant.apk", 0, apk.length()).use { sai ->
                        ent.copyTo(sai, 64 * 1024)
                        s.fsync(sai)
                    }
                }
                // Grava antes de confirmar: o Android encerra o app durante a troca
                prefs(app).edit().putLong("reabrir_ate", if (reabrir) System.currentTimeMillis() + 10 * 60_000L else 0L).commit()
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val retorno = PendingIntent.getBroadcast(app, 7101, Intent(app, InstalacaoReceiver::class.java), flags)
                s.commit(retorno.intentSender)
            }
        } catch (e: Exception) {
            runCatching { pi.abandonSession(id) }
            throw e
        }
    }

    /** "Instalar agora" com o APK já baixado em segundo plano. */
    fun instalarBaixado(act: Activity, avisar: (String, Int, String) -> Unit) {
        val apk = arquivoBaixado(act)
        if (apk == null) { avisar("erro", 0, "A atualização baixada não está mais no aparelho. Toque em Atualizar para baixar de novo."); return }
        act.runOnUiThread { instalarOuPedirPermissao(act, apk, avisar) }
    }

    /** O usuário saiu do app: instala daqui a 1 minuto se ele não voltar (só no modo silencioso). */
    fun agendarAoSair(ctx: Context) {
        if (arquivoBaixado(ctx) == null || !podeSilencioso(ctx)) return
        val req = OneTimeWorkRequestBuilder<InstalarApkWorker>().setInitialDelay(60, TimeUnit.SECONDS).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(TRABALHO, ExistingWorkPolicy.REPLACE, req)
    }

    fun cancelarAoSair(ctx: Context) {
        runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(TRABALHO) }
    }

    internal fun instalarAoSair(ctx: Context) {
        if (MainActivity.visivel || !podeSilencioso(ctx)) return
        val apk = arquivoBaixado(ctx) ?: return
        if (conferirAssinatura(ctx, apk) != null) return
        instalarSessao(ctx, apk, reabrir = false)
    }

    // ------------------------------------------------------------------ retorno do Android

    internal fun retorno(ctx: Context, intent: Intent) {
        when (val st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // O Android quer a confirmação: mostra a tela dele se o app estiver aberto
                val confirmar = intentExtra(intent)
                if (confirmar != null && MainActivity.visivel) {
                    runCatching { ctx.startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        .onFailure { avisarOuvinte("erro", 0, "Não foi possível abrir a confirmação do Android. Toque em Atualizar de novo.") }
                } else {
                    avisarOuvinte("erro", 0, "Toque em Atualizar para concluir a instalação.")
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // o app é reaberto em AtualizadoReceiver
            PackageInstaller.STATUS_FAILURE_ABORTED -> avisarOuvinte("erro", 0, "Atualização cancelada. Seus dados continuam no app.")
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                avisarOuvinte("erro", 0, "O Android não instalou a atualização" + (if (msg.isNullOrBlank()) "." else " ($msg).") + " Tente de novo.")
                if (st == PackageInstaller.STATUS_FAILURE_INVALID || st == PackageInstaller.STATUS_FAILURE_CONFLICT) {
                    prefs(ctx).getString("arquivo", null)?.let { File(it).delete() }
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun intentExtra(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_INTENT)

    /** O APK foi trocado (o Android avisa o próprio app): limpa o download e reabre se foi pelo "Atualizar". */
    internal fun aposAtualizar(ctx: Context) {
        val p = prefs(ctx)
        val reabrir = p.getLong("reabrir_ate", 0L) > System.currentTimeMillis()
        p.getString("arquivo", null)?.let { File(it).delete() }
        p.edit().remove("arquivo").remove("url").remove("versao").remove("codigo").remove("reabrir_ate").apply()
        File(ctx.cacheDir, PASTA).listFiles()?.forEach { it.delete() }
        if (!reabrir) return
        val abrir = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        runCatching { ctx.startActivity(abrir) }
        // Se o Android não deixar abrir sozinho, fica a notificação para abrir com um toque
        if (!Alertas.permitido(ctx)) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CANAL, "Atualizações do app", NotificationManager.IMPORTANCE_DEFAULT))
        val pend = PendingIntent.getActivity(ctx, 7102, abrir, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_stat_mercaplant)
            .setContentTitle("MercaPlant atualizado")
            .setContentText("Versão ${Ota.versaoApk(ctx)} instalada. Toque para abrir.")
            .setContentIntent(pend)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n) }
    }
}

/** Resultado da instalação (PackageInstaller). */
class InstalacaoReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = Atualizador.retorno(ctx, intent)
}

/** O Android avisa o próprio app depois que ele foi atualizado. */
class AtualizadoReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) Atualizador.aposAtualizar(ctx)
    }
}

/** Instala o APK baixado um minuto depois que o usuário saiu do app (se ele não voltou). */
class InstalarApkWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        runCatching { Atualizador.instalarAoSair(applicationContext) }
        return Result.success()
    }
}
