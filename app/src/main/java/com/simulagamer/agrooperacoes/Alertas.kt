package com.simulagamer.agrooperacoes

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Alertas da fazenda: a página calcula e manda a lista; o Android agenda e mostra, mesmo com o app fechado. */
object Alertas {
    private const val CANAL = "alertas"
    private const val TAG = "alerta"

    fun permitido(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun criarCanal(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val canal = NotificationChannel(CANAL, "Alertas da fazenda", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Chuva forte, pulverização, revisão de máquinas, estoque e operações atrasadas"
            }
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(canal)
        }
    }

    /** Substitui todo o agendamento anterior pela lista nova (JSON: id, quando em ms, titulo, texto, rota). */
    fun agendar(ctx: Context, json: String) {
        val wm = WorkManager.getInstance(ctx.applicationContext)
        wm.cancelAllWorkByTag(TAG)
        val lista = runCatching { JSONArray(json) }.getOrNull() ?: return
        val agora = System.currentTimeMillis()
        for (i in 0 until lista.length()) {
            val a = lista.optJSONObject(i) ?: continue
            enfileirar(wm, a, (a.optLong("quando") - agora).coerceAtLeast(0L))
        }
    }

    fun testar(ctx: Context, json: String) {
        val a = runCatching { JSONObject(json) }.getOrNull() ?: return
        mostrar(ctx, a.optString("id"), a.optString("titulo"), a.optString("texto"), a.optString("rota"))
    }

    private fun enfileirar(wm: WorkManager, a: JSONObject, atraso: Long) {
        val id = a.optString("id").ifBlank { return }
        val pedido = OneTimeWorkRequestBuilder<AlertaWorker>()
            .setInitialDelay(atraso, TimeUnit.MILLISECONDS)
            .addTag(TAG)
            .setInputData(workDataOf("id" to id, "titulo" to a.optString("titulo"), "texto" to a.optString("texto"), "rota" to a.optString("rota")))
            .build()
        wm.enqueueUniqueWork("alerta-$id", ExistingWorkPolicy.REPLACE, pedido)
    }

    @SuppressLint("MissingPermission")
    fun mostrar(ctx: Context, id: String, titulo: String, texto: String, rota: String) {
        if (!permitido(ctx)) return
        criarCanal(ctx)
        val abrir = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_ROTA, rota)
        }
        val toque = PendingIntent.getActivity(ctx, id.hashCode(), abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_stat_mercaplant)
            .setColor(0xFF18A66A.toInt())
            .setContentTitle(titulo.ifBlank { "MercaPlant" })
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setContentIntent(toque)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(id.hashCode(), n) }
    }
}

class AlertaWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val d = inputData
        Alertas.mostrar(applicationContext, d.getString("id") ?: return Result.success(), d.getString("titulo") ?: "", d.getString("texto") ?: "", d.getString("rota") ?: "")
        return Result.success()
    }
}
