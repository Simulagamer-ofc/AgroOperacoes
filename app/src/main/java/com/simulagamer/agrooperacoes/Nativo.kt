package com.simulagamer.agrooperacoes

/**
 * Nível da parte Android do app (Kotlin/Java e AndroidManifest).
 *
 * As telas novas chegam sem reinstalar (ver Ota.kt), mas só entram num APK com nível igual ou maior que o do
 * pacote publicado. SUBA 1 sempre que mudar algo em app/src/main/java ou no AndroidManifest.xml: assim quem está
 * com o APK antigo recebe o aviso para atualizar o app em vez de telas que dependem do Android novo.
 * O build de PR (android.yml) falha se a parte Android mudar sem subir este número; o pages.yml lê daqui.
 */
object Nativo {
    const val NIVEL = 1
}
