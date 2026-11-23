package com.simulagamer.agrooperacoes

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.PublicKey
import java.util.concurrent.Executors

/**
 * Telas atualizadas sem reinstalar: o app confere o site (ota/manifest.txt, assinado com a chave do APK),
 * baixa só os arquivos que mudaram e, ao tocar "Atualizar agora" (ou ao abrir o app), passa a servir as telas
 * novas no mesmo endereço interno — os dados guardados no aparelho continuam os mesmos.
 * A regra toda (assinatura, SHA-256, voltar sozinho se a versão nova não abrir) fica no OtaNucleo.java.
 */
object Ota {
    private val BASES = listOf("https://mercaplant.com.br/ota/", "https://simulagamer-ofc.github.io/AgroOperacoes/ota/")
    private const val INTERVALO = 60 * 60 * 1000L // confere o site no máximo de hora em hora (ou ao pedir)
    private val fila = Executors.newSingleThreadExecutor()

    /** Pasta das telas em uso (null = as que vieram no APK). */
    @Volatile var pasta: File? = null
        private set
    @Volatile private var verificando = false
    @Volatile private var verificadoEm = 0L
    @Volatile private var progresso = -1
    @Volatile private var ultima: OtaNucleo.Resultado? = null

    private fun raiz(ctx: Context) = File(ctx.applicationContext.filesDir, "ota")

    /** Ao abrir o app, antes de carregar a página. */
    fun abrir(ctx: Context): File? {
        pasta = runCatching { OtaNucleo.abrir(raiz(ctx), BuildConfig.CARIMBO) }.getOrNull()
        return pasta
    }

    /** "Atualizar agora": true se havia telas prontas (a página deve ser recarregada). */
    fun aplicarPronta(ctx: Context): Boolean {
        val nova = runCatching { OtaNucleo.aplicarPronta(raiz(ctx), BuildConfig.CARIMBO) }.getOrNull() ?: return false
        pasta = nova
        return true
    }

    fun confirmar(ctx: Context) = OtaNucleo.confirmar(raiz(ctx))

    fun emTeste(ctx: Context) = OtaNucleo.estado(raiz(ctx)).testando > 0

    /** A versão nova não abriu: volta para a anterior. */
    fun reverter(ctx: Context): Boolean {
        val r = raiz(ctx)
        val ok = OtaNucleo.reverter(r)
        val e = OtaNucleo.estado(r)
        pasta = if (e.ativa > 0) OtaNucleo.arquivos(r, e.ativa) else null
        return ok
    }

    fun verificar(ctx: Context, forcar: Boolean, avisar: () -> Unit) {
        val app = ctx.applicationContext
        if (verificando) return
        if (!forcar && System.currentTimeMillis() - verificadoEm < INTERVALO) return
        verificando = true
        progresso = -1
        avisar()
        fila.execute {
            try {
                val assets = app.assets
                val r = OtaNucleo.verificar(
                    raiz(app), BASES, BuildConfig.CARIMBO, Nativo.NIVEL, chaves(app),
                    OtaNucleo.Fonte { c -> runCatching { assets.open("www/$c") }.getOrNull() },
                    OtaNucleo.redePadrao(true),
                    OtaNucleo.Progresso { feito, total ->
                        val pct = if (total > 0) (feito * 100 / total).toInt() else -1
                        if (pct / 10 != progresso / 10) { progresso = pct; avisar() }
                    }
                )
                ultima = r
                verificadoEm = System.currentTimeMillis()
                // Mudou a parte Android: com a instalação silenciosa liberada, já deixa o APK baixado (só no Wi-Fi)
                if (r.situacao == "precisa-apk" && r.apk != null) Atualizador.prepararEmSegundoPlano(app, r.apk, r.versao)
            } catch (e: Throwable) {
                ultima = OtaNucleo.Resultado().apply { erro = e.message ?: "falha ao conferir" }
            } finally {
                verificando = false
                progresso = -1
                avisar()
            }
        }
    }

    /** Situação para a página (faixa "versão nova pronta" e cartão em Ajustes). */
    fun estado(ctx: Context): JSONObject {
        val r = raiz(ctx)
        val e = OtaNucleo.estado(r)
        val u = ultima
        return JSONObject().apply {
            put("suporta", true)
            put("apk", versaoApk(ctx))
            put("nivel", Nativo.NIVEL)
            put("telas", if (e.ativa > 0) OtaNucleo.versaoDe(r, e.ativa) ?: "" else JSONObject.NULL)
            put("emTeste", e.testando > 0)
            put("pronta", if (e.pronta > 0) JSONObject().put("versao", OtaNucleo.versaoDe(r, e.pronta) ?: "") else JSONObject.NULL)
            put("verificando", verificando)
            put("progresso", progresso)
            put("verificadoEm", verificadoEm)
            put("situacao", u?.situacao ?: JSONObject.NULL)
            put("erro", if (u?.situacao == "erro" || u?.situacao == null) u?.erro ?: JSONObject.NULL else JSONObject.NULL)
            put("versaoSite", u?.versao ?: JSONObject.NULL)
            if (u != null && u.situacao == "precisa-apk") put("precisaApk", JSONObject().put("versao", u.versao ?: "").put("url", u.apk ?: ""))
            put("apkBaixado", Atualizador.baixadoVersao(ctx) ?: JSONObject.NULL)
            put("silencioso", Atualizador.podeSilencioso(ctx))
        }
    }

    fun versaoApk(ctx: Context): String =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" }.getOrDefault("")

    @Suppress("DEPRECATION")
    private fun chaves(ctx: Context): List<PublicKey> {
        val pm = ctx.packageManager
        val certs: List<ByteArray> = if (Build.VERSION.SDK_INT >= 28) {
            val si = pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
            val lista = when {
                si == null -> null
                si.hasMultipleSigners() -> si.apkContentsSigners
                else -> si.signingCertificateHistory
            }
            lista?.map { it.toByteArray() } ?: emptyList()
        } else {
            pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures?.map { it.toByteArray() } ?: emptyList()
        }
        return OtaNucleo.chavesDosCertificados(certs)
    }

    /** Serve /assets/www/... a partir das telas baixadas; o que não estiver lá vem do APK. */
    class Telas(ctx: Context) : WebViewAssetLoader.PathHandler {
        private val doApk = WebViewAssetLoader.AssetsPathHandler(ctx)

        override fun handle(path: String): WebResourceResponse? {
            val p = pasta
            if (p != null && path.startsWith("www/")) {
                val rel = path.removePrefix("www/")
                val f = File(p, rel)
                val seguro = runCatching { f.canonicalPath.startsWith(p.canonicalPath + File.separator) }.getOrDefault(false)
                if (seguro && f.isFile) {
                    val tipo = tipo(rel)
                    val texto = tipo.startsWith("text/") || tipo.endsWith("json") || tipo.endsWith("+xml")
                    runCatching { return WebResourceResponse(tipo, if (texto) "utf-8" else null, FileInputStream(f)) }
                }
            }
            return doApk.handle(path)
        }

        private fun tipo(nome: String) = when (nome.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "ico" -> "image/x-icon"
            "wasm" -> "application/wasm"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "pdf" -> "application/pdf"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
