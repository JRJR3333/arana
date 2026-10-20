package com.jrjr3333.arana

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.AlarmClock
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * La araña para Android: abre la misma araña de la web dentro de su propia app
 * y hace en nativo lo que Android sí permite (por ahora, temporizadores y alarmas con araña://).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView

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
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(SITE)
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

    /** arana://temporizador?min=5&seg=30&texto=Pasta · arana://alarma?hora=7&min=30 · arana://salir */
    private fun orden(u: Uri): Boolean {
        if (u.host == "salir") { finishAndRemoveTask(); return true }
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

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Atrás vuelve dentro de la araña")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        const val HOST = "jrjr3333.github.io"
        const val SITE = "https://jrjr3333.github.io/arana/?app=android"
    }
}
