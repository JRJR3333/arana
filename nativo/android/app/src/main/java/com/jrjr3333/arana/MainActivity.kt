package com.jrjr3333.arana

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject
import java.util.Locale

/**
 * La araña para Android: la misma pantalla que la app de iPhone (la web, dentro de su propia app)
 * y, en nativo, todo lo que Android deja hacer: abrir apps, ajustes, temporizadores, alarmas, música,
 * citas, llamadas y mensajes, oír, hablar y flotar.
 *
 * La web manda las órdenes con AranaAndroid.orden(id, "arana://…") y recibe la respuesta en
 * window.__aranaRes(id, {ok, msg, fuera}). Los enlaces arana:// sueltos siguen funcionando.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var tts: TextToSpeech? = null
    private var ttsLista = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(FONDO)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean = abrir(req.url)
        }
        web.addJavascriptInterface(Puente(), "AranaAndroid")
        tts = TextToSpeech(this) { ok ->
            ttsLista = ok == TextToSpeech.SUCCESS
            if (ttsLista) tts?.language = Locale("es", "ES")
        }
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(SITE)
        if (intent?.data?.host == "escuchar") escuchar()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.data?.host == "escuchar") escuchar()
    }

    inner class Puente {
        @JavascriptInterface fun escuchar() { runOnUiThread { this@MainActivity.escuchar() } }
        @JavascriptInterface fun hablar(texto: String) { runOnUiThread { decir(texto) } }
        @JavascriptInterface fun callar() { runOnUiThread { tts?.stop() } }
        @JavascriptInterface fun puedeHablar(): Boolean = ttsLista
        /** 0.22.0: una orden arana:// con respuesta para la web. */
        @JavascriptInterface fun orden(id: Int, url: String) {
            runOnUiThread {
                val r = try { ejecutar(Uri.parse(url)) } catch (e: Exception) { Res(false, "No he podido hacerlo.") }
                web.evaluateJavascript("window.__aranaRes&&window.__aranaRes($id," + JSONObject.quote(r.json()) + ")", null)
            }
        }
        @JavascriptInterface fun capacidades(): String = CAPACIDADES
    }

    private fun decir(texto: String) {
        if (!ttsLista) return
        tts?.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "arana")
    }

    /** El micrófono del propio Android: escucha en español y le pasa la frase a la araña. */
    private fun escuchar() {
        tts?.stop()
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Le escucho")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            @Suppress("DEPRECATION") startActivityForResult(i, OIR)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Este móvil no tiene reconocimiento de voz. Use el micro del teclado.", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Resultado del micrófono")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != OIR) return
        val dicho = if (resultCode == RESULT_OK) data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
        web.evaluateJavascript("window.__aranaOir&&window.__aranaOir(" + JSONObject.quote(dicho ?: "") + ")", null)
    }

    /** #30: la araña sale de su app y flota sobre las demás. */
    private fun flotar(): Res {
        if (!Settings.canDrawOverlays(this)) {
            try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (e: ActivityNotFoundException) {}
            return Res(false, "Active «Mostrar sobre otras apps» para la Araña y vuelva a pedírmelo.", true)
        }
        val s = Intent(this, Flotante::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(s) else startService(s)
        moveTaskToBack(true)
        return Res(true, "", true)
    }

    /** #31: abre la app por su paquete o por su nombre; si no está, prueba su enlace. */
    private fun abrirApp(u: Uri): Res {
        val nombre = u.getQueryParameter("app")
        val i = Apps.buscar(this, u.getQueryParameter("id"), nombre)
        if (i != null) { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return Res(true, "", true) }
        val url = u.getQueryParameter("url").orEmpty()
        if (url.isNotEmpty() && !url.startsWith("arana:")) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))); return Res(true, "", true) } catch (e: Exception) {}
        }
        return Res(false, "No encuentro ${nombre ?: "esa app"} en este móvil.")
    }

    /** 0.22.0: play, pausa, siguiente y anterior para la app de música que esté sonando. Sin permisos. */
    private fun musica(accion: String): Res {
        val am = getSystemService(AudioManager::class.java)
        val tecla = when (accion) {
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> KeyEvent.KEYCODE_MEDIA_PLAY
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, tecla))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, tecla))
        return Res(true, when (accion) { "pause" -> "Música en pausa."; "next" -> "Siguiente."; "previous" -> "La anterior."; else -> "Música." })
    }

    private fun lanzar(i: Intent, falta: String): Res = try {
        startActivity(i); Res(true, "", true)
    } catch (e: ActivityNotFoundException) {
        Res(false, falta)
    }

    /** true si lo ha resuelto fuera del WebView. */
    private fun abrir(u: Uri): Boolean {
        if (u.scheme == "https" && u.host == HOST) return false
        if (u.scheme == "arana") {
            val r = ejecutar(u)
            if (r.msg.isNotEmpty()) Toast.makeText(this, r.msg, Toast.LENGTH_SHORT).show()
            return true
        }
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, u)); true
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No tengo con qué abrir eso.", Toast.LENGTH_SHORT).show(); true
        }
    }

    /**
     * Las órdenes nativas:
     * arana://abrir?app=WhatsApp&id=whatsapp · arana://ajuste?id=linterna&v=on · arana://temporizador?min=5&seg=30&texto=Pasta
     * arana://alarma?hora=7&min=30 · arana://musica?accion=pause · arana://evento?titulo=Médico&inicio=<ms>&min=30
     * arana://llamar?tel=600… · arana://mensaje?tel=600…&texto=… · arana://flotar · arana://escuchar · arana://salir
     */
    private fun ejecutar(u: Uri): Res {
        val q = { k: String -> u.getQueryParameter(k).orEmpty() }
        val texto = q("texto").ifEmpty { "Araña" }
        return when (u.host) {
            "salir" -> { web.postDelayed({ finishAndRemoveTask() }, 300); Res(true, "", true) }
            "abrir" -> abrirApp(u)
            "flotar" -> flotar()
            "escuchar" -> { escuchar(); Res(true) }
            "ajuste" -> Ajustes.aplicar(this, q("id"), q("v"))
            "musica" -> musica(q("accion"))
            "temporizador" -> {
                val segs = (q("min").toIntOrNull() ?: 0) * 60 + (q("seg").toIntOrNull() ?: 0)
                lanzar(Intent(AlarmClock.ACTION_SET_TIMER)
                    .putExtra(AlarmClock.EXTRA_LENGTH, if (segs > 0) segs else 60)
                    .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, texto), "Este móvil no tiene reloj con temporizador.")
            }
            "alarma" -> lanzar(Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, q("hora").toIntOrNull() ?: 8)
                .putExtra(AlarmClock.EXTRA_MINUTES, q("min").toIntOrNull() ?: 0)
                .putExtra(AlarmClock.EXTRA_MESSAGE, texto), "Este móvil no tiene reloj con alarmas.")
            "evento" -> {
                val ini = q("inicio").toLongOrNull() ?: System.currentTimeMillis()
                val dura = (q("min").toLongOrNull() ?: 60L).coerceAtLeast(5L)
                lanzar(Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.Events.TITLE, q("titulo").ifEmpty { "Cita" })
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, ini)
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, ini + dura * 60_000L), "No encuentro un calendario en este móvil.")
            }
            "llamar" -> lanzar(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + q("tel"))), "Este móvil no puede llamar.")
            "mensaje" -> lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + q("tel"))).putExtra("sms_body", q("texto")),
                "No encuentro la app de mensajes.")
            else -> Res(false, "Aún no sé hacer eso en Android.")
        }
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Atrás vuelve dentro de la araña")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        const val OIR = 7
        const val FONDO = 0xFF090A14.toInt()
        const val HOST = "jrjr3333.github.io"
        const val SITE = "https://jrjr3333.github.io/arana/?app=android"
        const val CAPACIDADES = "abrir,ajuste,temporizador,alarma,musica,evento,llamar,mensaje,flotar,salir,escuchar"
    }
}
