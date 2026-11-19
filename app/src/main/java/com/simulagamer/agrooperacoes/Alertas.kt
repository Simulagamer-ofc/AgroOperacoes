package com.simulagamer.agrooperacoes

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.view.View
import android.widget.RemoteViews
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
import java.util.Calendar
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

/**
 * Alertas da fazenda: a página calcula e manda a lista; o Android agenda e mostra, mesmo com o app fechado.
 * Visual MercaPlant: cartão escuro, hexágono colorido por área, número em destaque, gráfico da chuva hora a hora,
 * quadros (vento, trovoada…), faixa do impacto na fazenda e botões de ação. Cada área tem seu canal,
 * para o agricultor silenciar só o que não quer.
 */
object Alertas {
    private const val TAG = "alerta"
    const val TAG_ADIADO = "alerta-adiado"
    private const val GRUPO = "mercaplant-alertas"
    private const val SUMARIO_ID = 7_000_001
    private const val CANAL_ANTIGO = "alertas"
    private const val GRUPO_CANAIS = "alertas-fazenda"
    private val VERDE = Color.parseColor("#18A66A")
    private val NAVY = Color.parseColor("#08182B")
    private val SUAVE = Color.parseColor("#A0C4D0")

    private class Canal(val id: String, val nome: String, val desc: String, val importancia: Int)

    private val CANAIS = listOf(
        Canal("clima", "Clima", "Chuva forte e geada", NotificationManager.IMPORTANCE_HIGH),
        Canal("pulverizacao", "Pulverização", "Boas horas (ou falta delas) para pulverizar", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("maquinas", "Máquinas", "Revisão, checklist e aferição", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("estoque", "Estoque", "Estoque baixo, acabando e lotes vencendo", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("silos", "Silos", "Temperatura subindo e boa hora para aerar", NotificationManager.IMPORTANCE_HIGH),
        Canal("aplicacoes", "Aplicações", "Carência cumprida (colheita liberada)", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("operacoes", "Operações", "Operações atrasadas", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("financeiro", "Financeiro", "Contas vencidas e a vencer", NotificationManager.IMPORTANCE_DEFAULT),
        Canal("compras", "Compras", "Pedidos de compra aguardando aprovação", NotificationManager.IMPORTANCE_DEFAULT)
    )

    private val ICONES = mapOf(
        "chuva" to R.drawable.ic_al_chuva, "geada" to R.drawable.ic_al_geada, "gota" to R.drawable.ic_al_gota,
        "trator" to R.drawable.ic_al_trator, "checklist" to R.drawable.ic_al_checklist, "pacote" to R.drawable.ic_al_pacote,
        "calendario" to R.drawable.ic_al_calendario, "termometro" to R.drawable.ic_al_termometro, "vento" to R.drawable.ic_al_vento,
        "escudo" to R.drawable.ic_al_escudo, "relogio" to R.drawable.ic_al_relogio, "recibo" to R.drawable.ic_al_recibo,
        "carrinho" to R.drawable.ic_al_carrinho
    )

    fun permitido(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun criarCanais(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannelGroup(NotificationChannelGroup(GRUPO_CANAIS, "Alertas da fazenda"))
        CANAIS.forEach { c ->
            nm.createNotificationChannel(NotificationChannel(c.id, c.nome, c.importancia).apply {
                description = c.desc
                group = GRUPO_CANAIS
                lightColor = VERDE
                enableLights(true)
            })
        }
        // O canal único antigo foi dividido por área
        if (nm.getNotificationChannel(CANAL_ANTIGO) != null) nm.deleteNotificationChannel(CANAL_ANTIGO)
    }

    /** Substitui todo o agendamento anterior pela lista nova (JSON: id, quando em ms, titulo, texto, rota e os dados do cartão). */
    fun agendar(ctx: Context, json: String) {
        val wm = WorkManager.getInstance(ctx.applicationContext)
        wm.cancelAllWorkByTag(TAG)
        val lista = runCatching { JSONArray(json) }.getOrNull() ?: return
        val agora = System.currentTimeMillis()
        for (i in 0 until lista.length()) {
            val a = lista.optJSONObject(i) ?: continue
            enfileirar(wm, a, (a.optLong("quando") - agora).coerceAtLeast(0L), TAG)
        }
    }

    fun testar(ctx: Context, json: String) {
        val a = runCatching { JSONObject(json) }.getOrNull() ?: return
        mostrar(ctx, a)
    }

    fun enfileirar(wm: WorkManager, a: JSONObject, atraso: Long, tag: String) {
        val id = a.optString("id").ifBlank { return }
        // O WorkManager guarda até 10 KB por tarefa: se passar, o cartão vai sem o gráfico e os quadros
        var texto = a.toString()
        if (texto.length > 9000) { a.remove("barras"); a.remove("quadros"); texto = a.toString() }
        val pedido = OneTimeWorkRequestBuilder<AlertaWorker>()
            .setInitialDelay(atraso, TimeUnit.MILLISECONDS)
            .addTag(tag)
            .setInputData(workDataOf("json" to texto))
            .build()
        wm.enqueueUniqueWork("$tag-$id", ExistingWorkPolicy.REPLACE, pedido)
    }

    private fun cor(texto: String?, padrao: Int): Int =
        if (texto.isNullOrBlank()) padrao else runCatching { Color.parseColor(texto) }.getOrDefault(padrao)

    private fun Context.dp(v: Float) = v * resources.displayMetrics.density

    /** Hexágono colorido (mesmo estilo dos ícones do menu) com o desenho da área em azul-escuro por cima. */
    private fun iconeHex(ctx: Context, corHex: Int, icone: String, tamanhoDp: Float): Bitmap {
        val s = ctx.dp(tamanhoDp).toInt().coerceAtLeast(24)
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val w = s.toFloat()
        val hex = Path().apply {
            moveTo(w * .25f, w * .04f); lineTo(w * .75f, w * .04f); lineTo(w, w * .5f)
            lineTo(w * .75f, w * .96f); lineTo(w * .25f, w * .96f); lineTo(0f, w * .5f); close()
        }
        c.drawPath(hex, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = corHex; style = Paint.Style.FILL })
        ContextCompat.getDrawable(ctx, ICONES[icone] ?: R.drawable.ic_stat_mercaplant)?.mutate()?.let { d ->
            d.setTint(NAVY)
            val m = (w * .24f).toInt()
            d.setBounds(m, m, s - m, s - m)
            d.draw(c)
        }
        return bmp
    }

    /** Gráfico da chuva hora a hora: barra mais alta = hora mais forte; cor sobe com a intensidade (mm/h). */
    private fun graficoBarras(ctx: Context, barras: JSONArray): Bitmap? {
        val n = barras.length(); if (n == 0) return null
        val dm = ctx.resources.displayMetrics
        val larg = (dm.widthPixels - ctx.dp(84f)).coerceIn(ctx.dp(220f), ctx.dp(440f)).toInt()
        val alt = ctx.dp(58f).toInt()
        val bmp = Bitmap.createBitmap(larg, alt, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val rotulo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SUAVE; textSize = ctx.dp(10f); textAlign = Paint.Align.CENTER }
        val areaRot = ctx.dp(14f)
        val areaBarra = alt - areaRot - ctx.dp(2f)
        var maior = 1.0
        for (i in 0 until n) maior = max(maior, barras.optJSONObject(i)?.optDouble("v", 0.0) ?: 0.0)
        val gap = ctx.dp(4f)
        val lb = (larg - gap * (n - 1)) / n
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val raio = ctx.dp(3f)
        for (i in 0 until n) {
            val b = barras.optJSONObject(i) ?: continue
            val v = b.optDouble("v", 0.0)
            p.color = when {
                v < 1 -> Color.parseColor("#245673")
                v < 5 -> Color.parseColor("#3D9BE9")
                v < 10 -> Color.parseColor("#F59E0B")
                else -> Color.parseColor("#E05A5A")
            }
            val h = max(ctx.dp(3f), (v / maior * areaBarra).toFloat())
            val x = i * (lb + gap)
            c.drawRoundRect(RectF(x, areaBarra - h, x + lb, areaBarra + raio), raio, raio, p)
            // apara o arredondado de baixo
            c.drawRect(x, areaBarra - min(h, raio), x + lb, areaBarra, p)
            if (n <= 8 || i % 2 == 0) c.drawText(b.optString("h"), x + lb / 2, alt - ctx.dp(2f), rotulo)
        }
        return bmp
    }

    private fun intentRota(ctx: Context, rota: String, codigo: Int): PendingIntent {
        val abrir = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_ROTA, rota)
        }
        return PendingIntent.getActivity(ctx, codigo, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @SuppressLint("MissingPermission")
    fun mostrar(ctx: Context, a: JSONObject) {
        if (!permitido(ctx)) return
        criarCanais(ctx)
        val id = a.optString("id").ifBlank { "alerta-${System.currentTimeMillis()}" }
        val nid = id.hashCode()
        val titulo = a.optString("titulo").ifBlank { "MercaPlant" }
        val texto = a.optString("texto")
        val rota = a.optString("rota")
        val canal = a.optString("canal").takeIf { c -> CANAIS.any { it.id == c } } ?: "clima"
        val corArea = cor(a.optString("cor"), VERDE)
        val icone = a.optString("icone", "chuva")
        val curto = a.optString("curto").ifBlank { titulo }
        val sub = a.optString("sub").ifBlank { texto }
        val valor = a.optString("valor")
        val unid = a.optString("unid")
        val rotulo = a.optString("rotulo")
        val fazenda = a.optString("fazenda")

        // ----- fechada -----
        val pequena = RemoteViews(ctx.packageName, R.layout.notif_alerta).apply {
            setImageViewBitmap(R.id.n_icone, iconeHex(ctx, corArea, icone, 34f))
            setTextViewText(R.id.n_titulo, curto)
            setTextViewText(R.id.n_sub, sub)
            if (valor.isBlank()) setViewVisibility(R.id.n_numero, View.GONE)
            else { setTextViewText(R.id.n_valor, valor); setTextViewText(R.id.n_unid, unid) }
        }

        // ----- aberta -----
        val barras = a.optJSONArray("barras") ?: JSONArray()
        val quadros = a.optJSONArray("quadros") ?: JSONArray()
        val grande = RemoteViews(ctx.packageName, R.layout.notif_alerta_grande).apply {
            setTextViewText(R.id.g_selo, a.optString("selo").ifBlank { rotulo.uppercase() })
            setTextColor(R.id.g_selo, corArea)
            setTextViewText(R.id.g_dia, a.optString("dia"))
            setImageViewBitmap(R.id.g_icone, iconeHex(ctx, corArea, icone, 46f))
            if (valor.isBlank()) setViewVisibility(R.id.g_numero, View.GONE)
            else { setTextViewText(R.id.g_valor, valor); setTextViewText(R.id.g_unid, unid) }
            setTextViewText(R.id.g_titulo, curto)
            // Com gráfico (chuva) o detalhe curto basta; nos outros avisos vai o texto completo
            val detalhe = if (barras.length() > 0) a.optString("detalhe").ifBlank { sub } else texto
            if (detalhe.isBlank()) setViewVisibility(R.id.g_texto, View.GONE) else setTextViewText(R.id.g_texto, detalhe)
            val grafico = graficoBarras(ctx, barras)
            if (grafico == null) setViewVisibility(R.id.g_barras, View.GONE) else setImageViewBitmap(R.id.g_barras, grafico)
            val q = listOf(Triple(R.id.g_q1, R.id.g_q1r, R.id.g_q1v), Triple(R.id.g_q2, R.id.g_q2r, R.id.g_q2v), Triple(R.id.g_q3, R.id.g_q3r, R.id.g_q3v))
            if (quadros.length() == 0) setViewVisibility(R.id.g_quadros, View.GONE)
            q.forEachIndexed { i, (caixa, r, v) ->
                val item = quadros.optJSONArray(i)
                if (item == null) setViewVisibility(caixa, View.INVISIBLE)
                else {
                    setTextViewText(r, item.optString(0))
                    setTextViewText(v, item.optString(1))
                    setTextColor(v, if (item.optBoolean(2)) Color.parseColor("#F59E0B") else Color.WHITE)
                }
            }
            val aviso = a.optString("aviso")
            if (aviso.isBlank()) setViewVisibility(R.id.g_aviso, View.GONE) else setTextViewText(R.id.g_aviso, "⚠  $aviso")
        }

        val b = NotificationCompat.Builder(ctx, canal)
            .setSmallIcon(R.drawable.ic_stat_mercaplant)
            .setColor(corArea)
            .setSubText(listOf(rotulo, fazenda).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { null })
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(pequena)
            .setCustomBigContentView(grande)
            .setContentIntent(intentRota(ctx, rota, nid))
            .setAutoCancel(true)
            .setGroup(GRUPO)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (canal == "clima" || canal == "silos") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)

        // Botões: abrir a tela certa ou lembrar amanhã (até 3)
        val acoes = a.optJSONArray("acoes") ?: JSONArray()
        for (i in 0 until min(3, acoes.length())) {
            val ac = acoes.optJSONObject(i) ?: continue
            val nome = ac.optString("t")
            if (nome.isBlank()) continue
            val pi = if (ac.optString("tipo") == "adiar") {
                val adiar = Intent(ctx, AlertaAcaoReceiver::class.java).apply {
                    action = AlertaAcaoReceiver.ADIAR
                    putExtra("json", a.toString())
                    putExtra("nid", nid)
                }
                PendingIntent.getBroadcast(ctx, nid + 31 * (i + 1), adiar, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            } else intentRota(ctx, ac.optString("rota").ifBlank { rota }, nid + 31 * (i + 1))
            b.addAction(NotificationCompat.Action(0, nome, pi))
        }

        runCatching {
            NotificationManagerCompat.from(ctx).notify(nid, b.build())
            resumo(ctx, canal)
        }
    }

    /** Vários alertas juntos: o Android agrupa em "MercaPlant · N alertas" em vez de encher a tela. */
    @SuppressLint("MissingPermission")
    private fun resumo(ctx: Context, canal: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val ativos = nm.activeNotifications.filter { it.notification.group == GRUPO && it.id != SUMARIO_ID }
        if (ativos.size < 2) return
        val caixa = NotificationCompat.InboxStyle().setSummaryText("${ativos.size} alertas")
        ativos.take(6).forEach { caixa.addLine(it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE) ?: "") }
        val s = NotificationCompat.Builder(ctx, canal)
            .setSmallIcon(R.drawable.ic_stat_mercaplant)
            .setColor(VERDE)
            .setContentTitle("MercaPlant · ${ativos.size} alertas")
            .setStyle(caixa)
            .setGroup(GRUPO)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setContentIntent(intentRota(ctx, "inicio", SUMARIO_ID))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(SUMARIO_ID, s)
    }

    /** Alertas agendados antes desta versão (só título, texto e rota) continuam funcionando. */
    fun deDados(json: String?, id: String?, titulo: String?, texto: String?, rota: String?): JSONObject? {
        json?.let { j -> runCatching { JSONObject(j) }.getOrNull()?.let { return it } }
        if (id.isNullOrBlank()) return null
        return JSONObject().put("id", id).put("titulo", titulo ?: "").put("texto", texto ?: "").put("rota", rota ?: "")
            .put("canal", "clima").put("cor", "#18A66A").put("icone", "chuva")
    }

    /** Próximas 7h (amanhã, se já passou das 7h de hoje). */
    fun atrasoAteAmanha7h(): Long {
        val c = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 7); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        return (c.timeInMillis - System.currentTimeMillis()).coerceAtLeast(60_000L)
    }
}

class AlertaWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val d = inputData
        val a = Alertas.deDados(d.getString("json"), d.getString("id"), d.getString("titulo"), d.getString("texto"), d.getString("rota"))
            ?: return Result.success()
        Alertas.mostrar(applicationContext, a)
        return Result.success()
    }
}

/** Botão "Lembrar amanhã": some agora e volta às 7h do dia seguinte (fora do reagendamento da página). */
class AlertaAcaoReceiver : BroadcastReceiver() {
    companion object { const val ADIAR = "com.simulagamer.agrooperacoes.ALERTA_ADIAR" }

    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ADIAR) return
        NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("nid", 0))
        val a = runCatching { JSONObject(intent.getStringExtra("json") ?: return) }.getOrNull() ?: return
        Alertas.enfileirar(WorkManager.getInstance(ctx.applicationContext), a, Alertas.atrasoAteAmanha7h(), Alertas.TAG_ADIADO)
    }
}
