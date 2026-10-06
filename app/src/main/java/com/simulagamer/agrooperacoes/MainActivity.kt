package com.simulagamer.agrooperacoes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
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
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    // Conteúdo aguardando o usuário escolher onde salvar (backup JSON / CSV)
    private var pendingFileContent: String? = null

    // Callback do <input type="file"> (restaurar backup)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val content = pendingFileContent
        pendingFileContent = null
        val uri = result.data?.data
        val ok = if (result.resultCode == Activity.RESULT_OK && uri != null && content != null) {
            runCatching {
                contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) } != null
            }.getOrDefault(false)
        } else {
            false
        }
        webView.evaluateJavascript("window.onNativeFileSaved && window.onNativeFileSaved($ok)", null)
    }

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileChooserCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileChooserCallback = null
    }

    /** Ponte exposta ao JavaScript como `window.AndroidBridge`. */
    inner class AndroidBridge {
        @JavascriptInterface
        fun saveFile(name: String, mime: String, content: String) {
            runOnUiThread {
                pendingFileContent = content
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                createDocument.launch(intent)
            }
        }

        /** Imprime a página atual (relatório de aferição) ou salva como PDF pelo serviço de impressão do Android. */
        @JavascriptInterface
        fun printPage() {
            runOnUiThread {
                val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
                printManager.print(
                    "Relatório Nexus Agro",
                    webView.createPrintDocumentAdapter("relatorio-afericao"),
                    PrintAttributes.Builder().build()
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = filePathCallback
                    return runCatching { pickFile.launch(fileChooserParams.createIntent()) }
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
            }
        }
        setContentView(webView)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }
        if (webView.url == null) {
            webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }
}
