package com.jrjr3333.arana

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.Locale
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * La araña para Android: abre la misma araña de la web dentro de su propia app
 * y hace en nativo lo que Android sí permite: temporizadores, alarmas, abrir apps, oír, hablar y flotar.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var tts: TextToSpeech? = null
    private var ttsLista = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean = abrir(req.url)
        }
        // 0.21.0 (#31): la web pide oír y hablar al móvil (el WebView no trae micrófono ni voz).
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
        if (requestCode != OIR || resultCode != RESULT_OK) return
        val dicho = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return
        web.evaluateJavascript("window.__aranaOir&&window.__aranaOir(" + JSONObject.quote(dicho) + ")", null)
    }

    /** #30: la araña sale de su app y flota sobre las demás. */
    private fun flotar() {
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Active «Mostrar sobre otras apps» para la Araña y vuelva a pedírmelo.", Toast.LENGTH_LONG).show()
            try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (e: ActivityNotFoundException) {}
            return
        }
        val s = Intent(this, Flotante::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(s) else startService(s)
        moveTaskToBack(true)
    }

    /** #31: abre la app por su paquete o por su nombre; si no está, prueba su enlace. */
    private fun abrirApp(u: Uri) {
        val nombre = u.getQueryParameter("app")
        val i = Apps.buscar(this, u.getQueryParameter("id"), nombre)
        if (i != null) { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
        val url = u.getQueryParameter("url").orEmpty()
        if (url.isNotEmpty() && !url.startsWith("arana:")) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))); return } catch (e: Exception) {}
        }
        Toast.makeText(this, "No encuentro ${nombre ?: "esa app"} en este móvil.", Toast.LENGTH_SHORT).show()
    }

    /** true si lo ha resuelto fuera del WebView. */
    private fun abrir(u: Uri): Boolean {
        if (u.scheme == "https" && u.host == HOST) return false
        if (u.scheme == "arana") return orden(u)
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, u)); true
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No tengo con qué abrir eso.", Toast.LENGTH_SHORT).show(); true
        }
    }

    /** arana://temporizador?min=5&seg=30&texto=Pasta · arana://alarma?hora=7&min=30 · arana://salir
     *  arana://abrir?app=WhatsApp&id=whatsapp · arana://flotar · arana://escuchar */
    private fun orden(u: Uri): Boolean {
        when (u.host) {
            "salir" -> { finishAndRemoveTask(); return true }
            "abrir" -> { abrirApp(u); return true }
            "flotar" -> { flotar(); return true }
            "escuchar" -> { escuchar(); return true }
        }
        val texto = u.getQueryParameter("texto") ?: "Araña"
        val segs = (u.getQueryParameter("min")?.toIntOrNull() ?: 0) * 60 + (u.getQueryParameter("seg")?.toIntOrNull() ?: 0)
        val i = when (u.host) {
            "temporizador" -> Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, if (segs > 0) segs else 60)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                .putExtra(AlarmClock.EXTRA_MESSAGE, texto)
            "alarma" -> Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, u.getQueryParameter("hora")?.toIntOrNull() ?: 8)
                .putExtra(AlarmClock.EXTRA_MINUTES, u.getQueryParameter("min")?.toIntOrNull() ?: 0)
                .putExtra(AlarmClock.EXTRA_MESSAGE, texto)
            else -> null
        }
        try { if (i != null) startActivity(i) } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Este móvil no tiene reloj con alarmas.", Toast.LENGTH_SHORT).show()
        }
        return true
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
        const val HOST = "jrjr3333.github.io"
        const val SITE = "https://jrjr3333.github.io/arana/?app=android"
    }
}
