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
import android.speech.tts.Voice
import android.content.pm.PackageManager
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
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
    // 0.28.0: el ajedrez importa y guarda copias de sus arañas
    private var archivoCb: ValueCallback<Array<Uri>>? = null
    private var porGuardar: String? = null
    // 0.45.0: el oído propio (#48), lo que llega de la araña flotante (#49) y el WhatsApp que espera permiso (#47)
    private var oido: Oido? = null
    private var pidioMicro = false
    private var paginaLista = false
    private var porDecir: String? = null
    private var waPendiente: Uri? = null
    private var delante = false

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
            override fun onPageFinished(view: WebView, url: String) {
                paginaLista = true
                porDecir?.let { porDecir = null; view.postDelayed({ oirFuera(it) }, 600) }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // Elegir un archivo (importar arañas de otro aparato)
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                archivoCb?.onReceiveValue(null); archivoCb = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                return try { @Suppress("DEPRECATION") startActivityForResult(i, ABRIR); true } catch (e: ActivityNotFoundException) { archivoCb = null; false }
            }
        }
        web.addJavascriptInterface(Puente(), "AranaAndroid")
        // 0.30.0: que la página no se frene cuando la app pasa a segundo plano (entrenar al ajedrez)
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        tts = TextToSpeech(this) { ok ->
            ttsLista = ok == TextToSpeech.SUCCESS
            if (ttsLista) mejorVoz()
            // 0.46.0 (#52): aviso a la web cuando termino de hablar, para seguir la conversación de viva voz
            tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { runOnUiThread { if (delante && paginaLista) web.evaluateJavascript("window.__aranaCalla&&window.__aranaCalla()", null) } }
                @Deprecated("Deprecated in Java") override fun onError(id: String?) {}
            })
        }
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(SITE)
        viva = this
        porIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        porIntent(intent)
    }

    private fun porIntent(i: Intent?) {
        val u = i?.data ?: return
        if (u.scheme != "arana") return
        when (u.host) {
            "escuchar" -> escuchar()
            // 0.45.0 (#49): una frase oída por la araña flotante cuando la app estaba cerrada
            "decir" -> u.getQueryParameter("texto")?.takeIf { it.isNotBlank() }?.let { if (paginaLista) oirFuera(it) else porDecir = it }
        }
    }

    override fun onResume() { super.onResume(); delante = true }
    override fun onPause() { super.onPause(); delante = false }

    /** 0.45.0 (#49): la araña flotante oyó algo; la app lo piensa sin salir a la pantalla. */
    fun oirFuera(texto: String): Boolean {
        if (!paginaLista) { porDecir = texto; return true }
        web.evaluateJavascript("window.__aranaOir&&window.__aranaOir(" + JSONObject.quote(texto) + ")", null)
        return true
    }

    fun callar() { tts?.stop() }

    inner class Puente {
        @JavascriptInterface fun escuchar() { runOnUiThread { this@MainActivity.escuchar() } }
        @JavascriptInterface fun hablar(texto: String) { runOnUiThread { decir(texto) } }
        @JavascriptInterface fun callar() { runOnUiThread { tts?.stop() } }
        /** 0.45.0 (#48): dejar de escuchar desde el botón del micro. */
        @JavascriptInterface fun pararOido() { runOnUiThread { oido?.parar() } }
        /** 0.45.0 (#49): lo que dice la araña, también en el bocadillo de la araña flotante si la app no está delante. */
        @JavascriptInterface fun bocadillo(texto: String) { runOnUiThread { if (!delante) Flotante.actual?.bocadillo(texto) } }
        /** 0.45.0 (#50): qué voz tiene ahora. */
        @JavascriptInterface fun vozNombre(): String = vozActual()
        @JavascriptInterface fun puedeHablar(): Boolean = ttsLista
        /** 0.22.0: una orden arana:// con respuesta para la web. */
        @JavascriptInterface fun orden(id: Int, url: String) {
            runOnUiThread {
                val r = try { ejecutar(Uri.parse(url)) } catch (e: Exception) { Res(false, "No he podido hacerlo.") }
                web.evaluateJavascript("window.__aranaRes&&window.__aranaRes($id," + JSONObject.quote(r.json()) + ")", null)
            }
        }
        @JavascriptInterface fun capacidades(): String = CAPACIDADES
        /** 0.42.0: la web sabe qué app de Android tiene usted y le avisa si hay una más nueva. */
        @JavascriptInterface fun version(): String = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
        /** 0.31.0 (#36): las apps instaladas, para que la araña las conozca por su nombre. */
        @JavascriptInterface fun apps(): String = try { Apps.lista(this@MainActivity) } catch (e: Exception) { "[]" }
        /** 0.28.0: guardar la copia de las arañas donde diga usted (Descargas, Drive…). */
        @JavascriptInterface fun guardarArchivo(nombre: String, texto: String) {
            runOnUiThread {
                porGuardar = texto
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, nombre)
                try { @Suppress("DEPRECATION") startActivityForResult(i, GUARDAR) } catch (e: ActivityNotFoundException) { porGuardar = null; Toast.makeText(this@MainActivity, "Este móvil no deja elegir dónde guardar.", Toast.LENGTH_LONG).show() }
            }
        }
        /** 0.30.0: seguir entrenando en segundo plano, con una notificación que dice cómo va. */
        @JavascriptInterface fun entreno(on: Boolean) {
            runOnUiThread {
                if (on) {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 10)
                    val i = Intent(this@MainActivity, Entreno::class.java).putExtra(Entreno.TEXTO, "Mis arañas están jugando. Puede apagar la pantalla.")
                    try { if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i) } catch (e: Exception) { }
                } else stopService(Intent(this@MainActivity, Entreno::class.java))
            }
        }
        @JavascriptInterface fun progreso(texto: String) { runOnUiThread { try { Entreno.actualizar(this@MainActivity, texto) } catch (e: Exception) { } } }
        /** 0.28.0: mientras entrena al ajedrez, la pantalla no se apaga. */
        @JavascriptInterface fun pantalla(encendida: Boolean) {
            runOnUiThread { if (encendida) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        }
    }

    private fun decir(texto: String) {
        if (!ttsLista) return
        tts?.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "arana")
    }

    /**
     * 0.45.0 (#50): «que tu voz no sea tan robótica». Elige la voz en español más natural que tenga el
     * móvil (más calidad, de España, instalada y sin internet) o la que usted eligió con «otra voz».
     */
    private fun vocesEs(): List<Voice> = try {
        (tts?.voices ?: emptySet<Voice>())
            .filter { it.locale.language == "es" && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
            .sortedWith(compareByDescending<Voice> { it.quality }
                .thenByDescending { it.locale.country == "ES" }
                .thenBy { it.isNetworkConnectionRequired }
                .thenBy { it.name })
    } catch (e: Exception) { emptyList() }

    private fun mejorVoz() {
        val t = tts ?: return
        val elegida = getSharedPreferences("arana", MODE_PRIVATE).getString("voz", null)
        val vs = vocesEs()
        val v = vs.firstOrNull { it.name == elegida } ?: vs.firstOrNull()
        if (v == null || runCatching { t.voice = v }.isFailure) t.language = Locale("es", "ES")
        t.setSpeechRate(1.0f)
        t.setPitch(1.0f)
    }

    private fun vozActual(): String {
        val v = runCatching { tts?.voice }.getOrNull() ?: return ""
        val vs = vocesEs()
        val n = vs.indexOfFirst { it.name == v.name } + 1
        val calidad = if (v.quality >= Voice.QUALITY_VERY_HIGH) "muy natural" else if (v.quality >= Voice.QUALITY_HIGH) "natural" else "sencilla"
        val de = if (v.locale.country == "ES") "de España" else "en español"
        return if (n > 0) "la voz $n de ${vs.size}, $de, $calidad" else "una voz $de"
    }

    /** «otra voz»: la siguiente voz en español del móvil, y se queda con ella. */
    private fun voz(accion: String): Res {
        if (!ttsLista) return Res(false, "Este móvil no me deja hablar todavía.")
        val vs = vocesEs()
        if (accion == "siguiente") {
            if (vs.size < 2) {
                try { startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) {}
                return Res(true, "Solo tengo una voz en español. Descargue otra más natural ahí, en la voz de Google, y la usaré sola.", true)
            }
            val i = vs.indexOfFirst { it.name == tts?.voice?.name }
            val v = vs[(i + 1) % vs.size]
            getSharedPreferences("arana", MODE_PRIVATE).edit().putString("voz", v.name).apply()
            mejorVoz()
            return Res(true, "Ahora hablo con ${vozActual()}. ¿Mejor así? Diga «otra voz» para cambiar.")
        }
        return Res(true, "Hablo con ${vozActual()}.")
    }

    private fun tienePermiso(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    /**
     * 0.45.0 (#48): el micrófono de la araña, sin la ventana de Google: escucha dentro de la app y le pasa
     * la frase. La primera vez pide el permiso de micrófono; si usted no lo da, usa la ventana de siempre.
     */
    private fun escuchar() {
        tts?.stop()
        if (!tienePermiso(android.Manifest.permission.RECORD_AUDIO)) {
            if (!pidioMicro) { pidioMicro = true; requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), PERMISO_MICRO); return }
            escucharGoogle(); return
        }
        val o = oido ?: Oido(this, { t ->
            web.evaluateJavascript("window.__aranaParcial&&window.__aranaParcial(" + JSONObject.quote(t) + ")", null)
        }) { t, err ->
            if (t.isNullOrBlank() && err != null) Toast.makeText(this, err, Toast.LENGTH_SHORT).show()
            web.evaluateJavascript("window.__aranaOir&&window.__aranaOir(" + JSONObject.quote(t ?: "") + ")", null)
        }.also { oido = it }
        if (o.empezar()) web.evaluateJavascript("window.__aranaParcial&&window.__aranaParcial('')", null)
        else escucharGoogle()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val si = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        when (requestCode) {
            PERMISO_MICRO -> if (si) escuchar() else escucharGoogle()
            PERMISO_CONTACTOS -> {
                val u = waPendiente; waPendiente = null
                if (u != null) {
                    val r = when {
                        u.host == "whatsapp" -> if (si) whatsapp(u) else whatsappSinContacto(u.getQueryParameter("texto").orEmpty(), "Sin permiso no veo sus contactos. Elija usted a quién.")
                        si -> aContacto(u)
                        else -> Res(false, "Sin permiso no veo sus contactos. Dígame el número.")
                    }
                    if (r.msg.isNotEmpty()) { Toast.makeText(this, r.msg, Toast.LENGTH_LONG).show(); decir(r.msg) }
                }
            }
        }
    }

    /**
     * 0.45.0 (#47): «manda un WhatsApp a Pedro diciendo que llego tarde». Busca a Pedro en sus contactos y abre
     * su chat de WhatsApp con el mensaje escrito: usted solo pulsa enviar (WhatsApp no deja que nadie más lo pulse).
     */
    private fun whatsapp(u: Uri): Res {
        val quien = u.getQueryParameter("a").orEmpty().trim()
        val texto = u.getQueryParameter("texto").orEmpty()
        if (quien.isEmpty()) return whatsappSinContacto(texto, "Elija el contacto. Enviar lo pulsa usted.")
        if (!tienePermiso(android.Manifest.permission.READ_CONTACTS)) {
            waPendiente = u
            requestPermissions(arrayOf(android.Manifest.permission.READ_CONTACTS), PERMISO_CONTACTOS)
            return Res(true, "Deme permiso para ver sus contactos y se lo preparo.")
        }
        val c = try { Contactos.buscar(this, quien) } catch (e: Exception) { null }
            ?: return whatsappSinContacto(texto, "No encuentro a $quien en sus contactos. Elíjalo usted; el mensaje ya va escrito.")
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=" + Contactos.internacional(c.tel) + "&text=" + Uri.encode(texto)))
        paqueteWhatsApp()?.let { i.setPackage(it) }
        return try {
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            Res(true, "Le dejo el mensaje para ${c.nombre} escrito. Pulse enviar.", true)
        } catch (e: ActivityNotFoundException) { Res(false, "No encuentro WhatsApp en este móvil.") }
    }

    /**
     * 0.46.0 (#51): «manda un mensaje a Pedro diciendo que llego tarde», «llama a mamá». Busco el número en sus
     * contactos y abro Mensajes con el texto escrito (usted pulsa enviar) o el teléfono con el número marcado.
     */
    private fun aContacto(u: Uri): Res {
        val quien = u.getQueryParameter("a").orEmpty().trim()
        if (!tienePermiso(android.Manifest.permission.READ_CONTACTS)) {
            waPendiente = u
            requestPermissions(arrayOf(android.Manifest.permission.READ_CONTACTS), PERMISO_CONTACTOS)
            return Res(true, "Deme permiso para ver sus contactos y se lo preparo.")
        }
        val c = try { Contactos.buscar(this, quien) } catch (e: Exception) { null }
        if (c == null) {
            return if (u.host == "mensaje") {
                val r = lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", u.getQueryParameter("texto").orEmpty()), "No encuentro la app de mensajes.")
                if (r.ok) Res(true, "No encuentro a $quien en sus contactos. Elíjalo usted; el mensaje ya va escrito.", true) else r
            } else Res(false, "No encuentro a $quien en sus contactos.")
        }
        val tel = c.tel.filter { it.isDigit() || it == '+' }
        return if (u.host == "llamar") {
            val r = lanzar(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(tel))), "Este móvil no puede llamar.")
            if (r.ok) Res(true, "Le marco a ${c.nombre}. Pulse llamar.", true) else r
        } else {
            val r = lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(tel))).putExtra("sms_body", u.getQueryParameter("texto").orEmpty()), "No encuentro la app de mensajes.")
            if (r.ok) Res(true, "Le dejo el mensaje para ${c.nombre} escrito. Pulse enviar.", true) else r
        }
    }

    private fun paqueteWhatsApp(): String? = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull {
        try { packageManager.getPackageInfo(it, 0); true } catch (e: Exception) { false }
    }

    private fun whatsappSinContacto(texto: String, msg: String): Res {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, texto)
        paqueteWhatsApp()?.let { i.setPackage(it) }
        return try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); Res(true, msg, true) }
        catch (e: ActivityNotFoundException) { Res(false, "No encuentro WhatsApp en este móvil.") }
    }

    /** La ventana del micrófono de Google, para móviles sin reconocimiento para apps o sin permiso. */
    private fun escucharGoogle() {
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
        if (requestCode == ABRIR) {
            val u = if (resultCode == RESULT_OK) data?.data else null
            archivoCb?.onReceiveValue(if (u != null) arrayOf(u) else null); archivoCb = null
            return
        }
        if (requestCode == GUARDAR) {
            val u = if (resultCode == RESULT_OK) data?.data else null
            val t = porGuardar; porGuardar = null
            if (u != null && t != null) {
                val ok = try { contentResolver.openOutputStream(u)?.use { it.write(t.toByteArray(Charsets.UTF_8)) } != null } catch (e: Exception) { false }
                Toast.makeText(this, if (ok) "Copia de las arañas guardada." else "No he podido guardar la copia.", Toast.LENGTH_SHORT).show()
            }
            return
        }
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
     * arana://voz?accion=siguiente · arana://whatsapp?a=Pedro&texto=…
     */
    private fun ejecutar(u: Uri): Res {
        val q = { k: String -> u.getQueryParameter(k).orEmpty() }
        val texto = q("texto").ifEmpty { "Araña" }
        return when (u.host) {
            "salir" -> { web.postDelayed({ finishAndRemoveTask() }, 300); Res(true, "", true) }
            "abrir" -> abrirApp(u)
            "flotar" -> flotar()
            "escuchar" -> { escuchar(); Res(true) }
            "voz" -> voz(q("accion"))
            "whatsapp" -> whatsapp(u)
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
            "llamar", "mensaje" -> if (q("a").isNotBlank() && q("tel").isBlank()) aContacto(u) else ejecutarTel(u)
            else -> Res(false, "Aún no sé hacer eso en Android.")
        }
    }

    private fun ejecutarTel(u: Uri): Res {
        val q = { k: String -> u.getQueryParameter(k).orEmpty() }
        return when (u.host) {
            "llamar" -> lanzar(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + q("tel"))), "Este móvil no puede llamar.")
            "mensaje" -> lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + q("tel"))).putExtra("sms_body", q("texto")),
                "No encuentro la app de mensajes.")
            else -> Res(false, "Aún no sé hacer eso en Android.")
        }
    }

    override fun onDestroy() {
        if (viva === this) viva = null
        oido?.parar()
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
        const val ABRIR = 8
        const val GUARDAR = 9
        const val PERMISO_MICRO = 11
        const val PERMISO_CONTACTOS = 12
        /** 0.45.0 (#49): la app abierta (aunque esté detrás), para que la araña flotante le pase lo que oye. */
        @SuppressLint("StaticFieldLeak")
        var viva: MainActivity? = null
        const val FONDO = 0xFF090A14.toInt()
        const val HOST = "jrjr3333.github.io"
        const val SITE = "https://jrjr3333.github.io/arana/?app=android"
        const val CAPACIDADES = "abrir,ajuste,temporizador,alarma,musica,evento,llamar,mensaje,flotar,salir,escuchar,apps,voz,whatsapp,oido,contacto,seguir"
    }
}
