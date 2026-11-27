package com.simulagamer.agrooperacoes

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Microfone do Edy: reconhecimento de voz do próprio Android, dentro do app (sem abrir a janela do Google).
 * O reconhecimento da página (webkitSpeechRecognition) não funciona dentro da WebView, por isso a voz passa por aqui.
 * Tudo roda na thread principal (exigência do SpeechRecognizer).
 *
 * aviso(etapa, texto, nivel): etapa = "ouvindo" | "parcial" | "nivel" | "fim" | "erro"
 */
class Voz(private val ctx: Context, private val aviso: (String, String, Int) -> Unit) {
    private var sr: SpeechRecognizer? = null

    fun disponivel(): Boolean = SpeechRecognizer.isRecognitionAvailable(ctx)

    fun ouvir() {
        cancelar()
        if (!disponivel()) { aviso("erro", "sem-servico", 0); return }
        val r = runCatching { SpeechRecognizer.createSpeechRecognizer(ctx) }.getOrNull()
        if (r == null) { aviso("erro", "sem-servico", 0); return }
        sr = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = aviso("ouvindo", "", 0)
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {
                // -2..10 dB → 0..100 (só para animar o botão)
                aviso("nivel", "", (((rmsdB + 2f) / 12f) * 100f).toInt().coerceIn(0, 100))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                val motivo = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "nada"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permissao"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "rede"
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "ocupado"
                    SpeechRecognizer.ERROR_CLIENT -> "cancelado"
                    else -> "falha"
                }
                liberar()
                aviso("erro", motivo, 0)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (t.isNotBlank()) aviso("parcial", t, 0)
            }
            override fun onResults(results: Bundle?) {
                val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                liberar()
                if (t.isBlank()) aviso("erro", "nada", 0) else aviso("fim", t, 0)
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
            // Dá tempo de a pessoa pensar no meio da frase
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
        }
        runCatching { r.startListening(intent) }.onFailure { liberar(); aviso("erro", "falha", 0) }
    }

    /** Toque de novo no microfone: encerra e entrega o que já ouviu. */
    fun parar() {
        sr?.let { runCatching { it.stopListening() } }
    }

    fun cancelar() {
        sr?.let { runCatching { it.cancel() } }
        liberar()
    }

    private fun liberar() {
        sr?.let { runCatching { it.destroy() } }
        sr = null
    }
}
