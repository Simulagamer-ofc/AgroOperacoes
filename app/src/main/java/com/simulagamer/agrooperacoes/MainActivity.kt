package com.simulagamer.agrooperacoes

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import android.provider.MediaStore
import java.io.File
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_ROTA = "rota"
        private val ROTA_SEGURA = Regex("^[a-z0-9/_-]{1,60}$")
        private const val URL_INICIO = "https://appassets.androidplatform.net/assets/www/index.html"

        /** App na tela (para não instalar a atualização com a pessoa usando). */
        @Volatile var visivel = false
            private set
    }

    private val principal = Handler(Looper.getMainLooper())

    // Telas novas em teste: se a página não confirmar que abriu em 30 s, volta para a versão anterior
    private val vigia = Runnable {
        if (Ota.emTeste(this) && Ota.reverter(this)) recarregar()
    }
    private val conferirSite = Runnable { Ota.verificar(this, false, ::avisarOta) }
    private val ouvinteAtualizacao: (String, Int, String) -> Unit = { etapa, pct, msg -> avisarAtualizacao(etapa, pct, msg) }

    private lateinit var webView: WebView

    // Autorização de notificações (Android 13+), pedida quando o usuário liga os alertas
    private val requestNotif = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        webView.evaluateJavascript("window.onNotificacoesPermitidas && onNotificacoesPermitidas($ok)", null)
    }

    // Conteúdo aguardando o usuário escolher onde salvar (backup JSON / CSV)
    private var pendingFileContent: ByteArray? = null

    // Callback do <input type="file"> (restaurar backup)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val content = pendingFileContent
        pendingFileContent = null
        val uri = result.data?.data
        val ok = if (result.resultCode == Activity.RESULT_OK && uri != null && content != null) {
            runCatching {
                contentResolver.openOutputStream(uri)?.use { it.write(content) } != null
            }.getOrDefault(false)
        } else {
            false
        }
        webView.evaluateJavascript("window.onNativeFileSaved && window.onNativeFileSaved($ok)", null)
    }

    // Foto da câmera aguardando (o app de câmera grava neste arquivo e não devolve dados)
    private var cameraUri: Uri? = null
    private var cameraFile: File? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val escolhido = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        val daCamera = cameraUri?.takeIf { result.resultCode == Activity.RESULT_OK && escolhido == null && (cameraFile?.length() ?: 0L) > 0L }
        fileChooserCallback?.onReceiveValue(escolhido ?: daCamera?.let { arrayOf(it) })
        fileChooserCallback = null
        cameraUri = null
        cameraFile = null
    }

    // Fotos dos registros: oferece a câmera junto com a galeria
    private fun intentComCamera(galeria: Intent): Intent {
        val pasta = File(cacheDir, "fotos").apply { mkdirs() }
        pasta.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000L }?.forEach { it.delete() }
        val arquivo = File(pasta, "foto_${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.fotos", arquivo)
        cameraFile = arquivo
        cameraUri = uri
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(galeria, "Foto do registro").putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
    }

    // Localização (contorno do talhão por GPS): pede a permissão do Android só quando a página solicita
    private var geoOrigin: String? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private val requestLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = result.values.any { it }
        geoCallback?.invoke(geoOrigin, granted, false)
        geoCallback = null
        geoOrigin = null
    }

    /** Ponte exposta ao JavaScript como `window.AndroidBridge`. */
    inner class AndroidBridge {
        @JavascriptInterface
        fun saveFile(name: String, mime: String, content: String) {
            runOnUiThread {
                pendingFileContent = content.toByteArray(Charsets.UTF_8)
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                createDocument.launch(intent)
            }
        }

        /** PDF binário: base64 evita corromper os bytes com a conversão UTF-8. */
        @JavascriptInterface
        fun savePdf(name: String, base64: String) {
            val bytes = runCatching { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) }.getOrNull() ?: return
            runOnUiThread {
                pendingFileContent = bytes
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                createDocument.launch(intent)
            }
        }

        /** Envia o PDF por WhatsApp, e-mail etc.: grava no cache e abre o "Compartilhar" do Android. */
        @JavascriptInterface
        fun sharePdf(name: String, base64: String, texto: String) {
            val bytes = runCatching { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) }.getOrNull() ?: return
            runOnUiThread {
                runCatching {
                    val pasta = File(cacheDir, "compartilhar").apply { mkdirs() }
                    pasta.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000L }?.forEach { it.delete() }
                    val seguro = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val arquivo = File(pasta, seguro).apply { writeBytes(bytes) }
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fotos", arquivo)
                    val envio = Intent(Intent.ACTION_SEND).apply {
                        type = "application/pdf"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_SUBJECT, name)
                        if (texto.isNotBlank()) putExtra(Intent.EXTRA_TEXT, texto)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(envio, "Enviar relatório"))
                }.onFailure {
                    webView.evaluateJavascript("window.showToast && showToast('Não foi possível abrir o envio do PDF.', true)", null)
                }
            }
        }

        /** Alertas da fazenda: agenda a lista calculada pela página (substitui o agendamento anterior). */
        @JavascriptInterface
        fun agendarAlertas(json: String) { Alertas.agendar(applicationContext, json) }

        @JavascriptInterface
        fun testarAlerta(json: String) { Alertas.testar(applicationContext, json) }

        @JavascriptInterface
        fun notificacoesPermitidas(): Boolean = Alertas.permitido(this@MainActivity)

        @JavascriptInterface
        fun pedirNotificacoes() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33) requestNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
                else webView.evaluateJavascript("window.onNotificacoesPermitidas && onNotificacoesPermitidas(${Alertas.permitido(this@MainActivity)})", null)
            }
        }

        /** Atualização dentro do app: baixa o APK da versão nova e instala por cima (sem perguntar, quando o Android deixa). */
        @JavascriptInterface
        fun atualizarApp(url: String) { Atualizador.baixar(this@MainActivity, url, this@MainActivity::avisarAtualizacao) }

        /** APK já baixado em segundo plano: instala agora. */
        @JavascriptInterface
        fun apkInstalarAgora() { Atualizador.instalarBaixado(this@MainActivity, this@MainActivity::avisarAtualizacao) }

        /** Telas atualizadas sem reinstalar: situação (JSON) para a página. */
        @JavascriptInterface
        fun otaEstado(): String = Ota.estado(this@MainActivity).toString()

        /** "Procurar atualização" em Ajustes. */
        @JavascriptInterface
        fun otaVerificar() { Ota.verificar(this@MainActivity, true, this@MainActivity::avisarOta) }

        /** "Atualizar agora": passa a usar as telas novas já baixadas e recarrega na mesma tela. */
        @JavascriptInterface
        fun otaAplicar() {
            runOnUiThread { if (Ota.aplicarPronta(this@MainActivity)) { recarregar(); vigiar() } }
        }

        /** A página abriu direitinho (confirma a versão nova das telas). */
        @JavascriptInterface
        fun otaOk() {
            principal.removeCallbacks(vigia)
            Ota.confirmar(this@MainActivity)
        }

        /** Versão instalada do APK (para avisar quando houver uma mais nova). */
        @JavascriptInterface
        fun appVersion(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")

        /** Imprime a página atual (relatório de aferição) ou salva como PDF pelo serviço de impressão do Android. */
        @JavascriptInterface
        fun printPage() {
            runOnUiThread {
                val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
                printManager.print(
                    "Relatório MercaPlant",
                    webView.createPrintDocumentAdapter("relatorio-afericao"),
                    PrintAttributes.Builder().build()
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Atualizador.ouvinte = ouvinteAtualizacao
        runCatching { NotificationManagerCompat.from(this).cancel(Atualizador.NOTIF_ID) }

        // Telas: as baixadas pela atualização sem reinstalar (se houver) ou as que vieram no APK
        Ota.abrir(this)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", Ota.Telas(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            // Não carrega URLs content:// (o <input type="file"> funciona sem isso)
            settings.allowContentAccess = false
            settings.setGeolocationEnabled(true)
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    // Só a página do próprio app (assets) pode usar a localização
                    if (!origin.startsWith("https://appassets.androidplatform.net")) {
                        callback.invoke(origin, false, false)
                        return
                    }
                    val fine = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION)
                    if (fine == PackageManager.PERMISSION_GRANTED) {
                        callback.invoke(origin, true, false)
                    } else {
                        geoOrigin = origin
                        geoCallback = callback
                        requestLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                }

                override fun onShowFileChooser(
                    view: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = filePathCallback
                    // Backup/sincronização (.json): mostra todos os arquivos — o Android costuma não reconhecer o tipo JSON
                    // (arquivos do WhatsApp chegam como application/octet-stream). O conteúdo é validado no JavaScript.
                    var intent = fileChooserParams.createIntent()
                    if (fileChooserParams.acceptTypes.all { it.isBlank() || it.contains("json") }) intent.type = "*/*"
                    else if (fileChooserParams.acceptTypes.any { it.startsWith("image") }) intent = runCatching { intentComCamera(intent) }.getOrDefault(intent)
                    return runCatching { pickFile.launch(intent) }
                        .onFailure {
                            fileChooserCallback = null
                            filePathCallback.onReceiveValue(null)
                        }
                        .isSuccess
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    assetLoader.shouldInterceptRequest(request.url)

                // Links externos (site do fabricante, mapas, e-mail) abrem no navegador/app do sistema
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.host == "appassets.androidplatform.net") return false
                    if (url.scheme !in listOf("http", "https", "mailto", "tel")) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
            }
        }
        setContentView(webView)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }
        if (webView.url == null) {
            // Aberto pelo toque num alerta: já entra na tela do aviso
            val rota = intent?.getStringExtra(EXTRA_ROTA)?.takeIf { ROTA_SEGURA.matches(it) }
            webView.loadUrl(URL_INICIO + (rota?.let { "#/$it" } ?: ""))
        }
        if (Ota.emTeste(this)) vigiar()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Primeiro a página fecha o que estiver aberto (formulário, menu); só depois volta a tela ou sai
                webView.evaluateJavascript("window.voltarApp ? voltarApp() : false") { tratado ->
                    if (tratado != "true") {
                        if (webView.canGoBack()) webView.goBack() else finish()
                    }
                }
            }
        })
    }

    /** Andamento da atualização para a página (faixa "Nova versão"). */
    private fun avisarAtualizacao(etapa: String, pct: Int, msg: String) {
        val js = "window.onAtualizacao && onAtualizacao(${org.json.JSONObject().put("etapa", etapa).put("pct", pct).put("msg", msg)})"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    /** Situação da atualização das telas para a página. */
    private fun avisarOta() {
        val js = "window.onOta && onOta(${Ota.estado(this)})"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    private fun vigiar() {
        principal.removeCallbacks(vigia)
        principal.postDelayed(vigia, 30_000)
    }

    /** Recarrega na mesma tela (mesmo endereço, mesmos dados), já com as telas em uso agora. */
    private fun recarregar() {
        webView.clearCache(false)
        webView.reload()
    }

    // Quando saiu do app (para a página aplicar as telas novas ao voltar depois de um tempo)
    private var foraDesde = 0L

    override fun onStart() {
        super.onStart()
        visivel = true
        Atualizador.cancelarAoSair(this)
        if (foraDesde > 0L) {
            val ms = System.currentTimeMillis() - foraDesde
            foraDesde = 0L
            webView.evaluateJavascript("window.onVoltouAoApp && onVoltouAoApp($ms)", null)
        }
    }

    override fun onStop() {
        super.onStop()
        visivel = false
        if (isChangingConfigurations) return
        foraDesde = System.currentTimeMillis()
        // APK novo baixado e instalação silenciosa liberada: instala se a pessoa não voltar em 1 minuto,
        // a não ser que algo esteja em andamento (câmera, arquivo, formulário aberto)
        if (fileChooserCallback != null || pendingFileContent != null || geoCallback != null || Atualizador.pendente != null) return
        webView.evaluateJavascript("!!document.querySelector('.modal.open')") { ocupado ->
            if (ocupado != "true" && !visivel) Atualizador.agendarAoSair(applicationContext)
        }
    }

    override fun onResume() {
        super.onResume()
        // Voltou da tela "instalar apps desconhecidos": segue com a instalação
        if (Atualizador.pendente != null) Atualizador.continuar(this, ::avisarAtualizacao)
        // Confere o site alguns segundos depois de abrir/voltar (sem disputar a internet com a sincronização)
        principal.removeCallbacks(conferirSite)
        principal.postDelayed(conferirSite, 8_000)
    }

    override fun onDestroy() {
        principal.removeCallbacksAndMessages(null)
        if (Atualizador.ouvinte === ouvinteAtualizacao) Atualizador.ouvinte = null
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val rota = intent.getStringExtra(EXTRA_ROTA)?.takeIf { ROTA_SEGURA.matches(it) } ?: return
        webView.evaluateJavascript("window.go && go('$rota')", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }
}
