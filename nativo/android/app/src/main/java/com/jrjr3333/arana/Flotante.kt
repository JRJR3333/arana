package com.jrjr3333.arana

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * 0.21.0 (#30): la araña fuera de su app. Flota sobre las demás apps, se arrastra a cualquier sitio y,
 * mantenida pulsada, se guarda.
 * 0.45.0 (#49): ya no es el icono, es la araña de verdad (patas que se mueven, como en su pantalla) y,
 * con un toque, le escucha ahí mismo sin abrir la app: lo que contesta sale en un bocadillo a su lado.
 * Tocar el bocadillo abre la app. Si falta el permiso de micrófono o la app está cerrada, se abre como antes.
 */
class Flotante : Service() {
    private var wm: WindowManager? = null
    private var vista: AranaVista? = null
    private var params: WindowManager.LayoutParams? = null
    private var bocata: TextView? = null
    private var oido: Oido? = null
    private val h = Handler(Looper.getMainLooper())
    private val quitarBocata = Runnable { cerrarBocata() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == GUARDAR) { stopSelf(); return START_NOT_STICKY }
        primerPlano()
        if (vista == null) mostrar()
        actual = this
        return START_STICKY
    }

    private fun microOk() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun primerPlano() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CANAL, "La araña flotando", NotificationManager.IMPORTANCE_MIN))
        val guardar = PendingIntent.getService(this, 1, Intent(this, Flotante::class.java).setAction(GUARDAR), PendingIntent.FLAG_IMMUTABLE)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CANAL) else @Suppress("DEPRECATION") Notification.Builder(this)
        val n = b.setSmallIcon(R.drawable.arana)
            .setContentTitle("La araña está flotando")
            .setContentText("Tóquela para hablar. Manténgala pulsada para guardarla.")
            .addAction(Notification.Action.Builder(null, "Guardar la araña", guardar).build())
            .build()
        // Con el micrófono, Android exige decirlo al empezar; si no deja (sin permiso o desde segundo plano), flota sin él.
        if (Build.VERSION.SDK_INT >= 34) {
            val conMicro = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            try { if (microOk()) startForeground(1, n, conMicro) else startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) }
            catch (e: Exception) { startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) }
        } else if (Build.VERSION.SDK_INT >= 30 && microOk()) {
            try { startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) } catch (e: Exception) { startForeground(1, n) }
        } else startForeground(1, n)
    }

    private val tipo get() = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    @SuppressLint("ClickableViewAccessibility")
    private fun mostrar() {
        val w = getSystemService(WINDOW_SERVICE) as WindowManager
        val d = resources.displayMetrics.density
        val lado = (92 * d).toInt()
        val v = AranaVista(this)
        v.contentDescription = "La araña. Toque para hablar."
        val p = WindowManager.LayoutParams(lado, lado, tipo, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT)
        p.gravity = Gravity.TOP or Gravity.START
        p.x = resources.displayMetrics.widthPixels - lado - (4 * d).toInt()
        p.y = resources.displayMetrics.heightPixels / 3
        var x0 = 0f; var y0 = 0f; var px = 0; var py = 0; var t0 = 0L; var movida = false
        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { x0 = e.rawX; y0 = e.rawY; px = p.x; py = p.y; t0 = e.eventTime; movida = false; true }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(e.rawX - x0) > 12 * d || abs(e.rawY - y0) > 12 * d) { if (!movida) cerrarBocata(); movida = true }
                    if (movida) { p.x = px + (e.rawX - x0).toInt(); p.y = py + (e.rawY - y0).toInt(); v.andando = true; w.updateViewLayout(v, p) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    v.andando = false
                    if (!movida) {
                        if (e.eventTime - t0 > 700) { Toast.makeText(this, "Me guardo. Pídame «flota» para volver.", Toast.LENGTH_SHORT).show(); stopSelf() }
                        else tocar()
                    }
                    true
                }
                else -> false
            }
        }
        w.addView(v, p)
        wm = w; vista = v; params = p
    }

    /** Un toque: escuchar aquí mismo. Si ya escucha, deja de escuchar. */
    private fun tocar() {
        val o = oido
        if (o != null && o.escuchando) { o.parar(); vista?.oyendo = false; cerrarBocata(); return }
        if (!microOk() || MainActivity.viva == null) { abrirApp(Uri.parse("arana://escuchar")); return }
        MainActivity.viva?.callar()
        val nuevo = o ?: Oido(this, { t -> bocadillo("$t…", 0) }) { t, err ->
            vista?.oyendo = false
            if (!t.isNullOrBlank()) {
                bocadillo("«$t»", 9000)
                vista?.pensando = true
                val ok = MainActivity.viva?.oirFuera(t) == true
                if (!ok) abrirApp(Uri.parse("arana://decir?texto=" + Uri.encode(t)))
                h.postDelayed({ vista?.pensando = false }, 6000)
            } else bocadillo(err ?: "No le he oído.", 2500)
        }.also { oido = it }
        if (nuevo.empezar()) { vista?.oyendo = true; bocadillo("Le escucho…", 0) }
        else abrirApp(Uri.parse("arana://escuchar"))
    }

    private fun abrirApp(u: Uri) {
        cerrarBocata()
        startActivity(Intent(Intent.ACTION_VIEW, u, this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    /** Lo que dice la araña, en un bocadillo junto a ella. ms = 0: hasta que llegue otra cosa. */
    fun bocadillo(texto: String, ms: Long = -1) {
        val w = wm ?: return
        val p = params ?: return
        if (texto.isBlank()) return
        vista?.pensando = false
        val d = resources.displayMetrics.density
        val ancho = resources.displayMetrics.widthPixels
        val tv = bocata ?: TextView(this).apply {
            setTextColor(0xFFEAF6FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding((14 * d).toInt(), (10 * d).toInt(), (14 * d).toInt(), (10 * d).toInt())
            background = GradientDrawable().apply { cornerRadius = 16 * d; setColor(0xF00A0D17.toInt()); setStroke((1.5f * d).toInt(), 0xFF5EE7FF.toInt()) }
            maxWidth = min((280 * d).toInt(), ancho - (24 * d).toInt())
            setOnClickListener { abrirApp(Uri.parse("arana://abrir-app")) }
        }
        tv.text = texto
        tv.measure(View.MeasureSpec.makeMeasureSpec(tv.maxWidth, View.MeasureSpec.AT_MOST), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        val bw = tv.measuredWidth; val bh = tv.measuredHeight
        val lado = p.width
        val bp = (tv.layoutParams as? WindowManager.LayoutParams) ?: WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, tipo,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START }
        bp.x = (p.x + lado / 2 - bw / 2).coerceIn((8 * d).toInt(), max((8 * d).toInt(), ancho - bw - (8 * d).toInt()))
        bp.y = if (p.y > bh + 16 * d) p.y - bh - (4 * d).toInt() else p.y + lado + (4 * d).toInt()
        try { if (bocata == null) { w.addView(tv, bp); bocata = tv } else w.updateViewLayout(tv, bp) } catch (e: Exception) { }
        h.removeCallbacks(quitarBocata)
        val dura = if (ms < 0) (2500L + texto.length * 70L).coerceAtMost(12000L) else ms
        if (dura > 0) h.postDelayed(quitarBocata, dura)
    }

    private fun cerrarBocata() {
        h.removeCallbacks(quitarBocata)
        bocata?.let { runCatching { wm?.removeView(it) } }
        bocata = null
    }

    override fun onDestroy() {
        if (actual === this) actual = null
        oido?.parar(); oido = null
        cerrarBocata()
        vista?.let { it.parar(); runCatching { wm?.removeView(it) } }
        vista = null
        super.onDestroy()
    }

    companion object {
        const val CANAL = "flotante"
        const val GUARDAR = "guardar"
        /** La araña que flota ahora mismo, para que la app le pase lo que dice. */
        @SuppressLint("StaticFieldLeak")
        var actual: Flotante? = null
    }
}

/**
 * 0.45.0 (#49): la araña dibujada como en su pantalla (ANG, REST, L1, L2 y HIPX de index.html):
 * cuerpo, ocho patas con rodilla que se mecen, y un anillo punteado mientras escucha.
 */
class AranaVista(ctx: Context) : View(ctx) {
    var oyendo = false
    var pensando = false
    var andando = false
    private var activa = true
    private val inicio = SystemClock.uptimeMillis()
    private val ang = floatArrayOf(38f, 72f, 110f, 148f)
    private val rest = floatArrayOf(70f, 62f, 60f, 72f)
    private val l1 = floatArrayOf(42f, 38f, 38f, 44f)
    private val l2 = floatArrayOf(46f, 41f, 41f, 48f)
    private val hipx = floatArrayOf(8f, 3f, -3f, -8f)
    private val pata = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = 0xFFFF4FA3.toInt() }
    private val junta = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF3DFF9A.toInt() }
    private val cuerpo = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xFF5EE7FF.toInt() }
    private val relleno = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xD90A0C1C.toInt() }
    private val sombra = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x660A0C1C }
    private val anillo = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xAA5EE7FF.toInt() }

    fun parar() { activa = false }

    override fun onDraw(c: Canvas) {
        super.onDraw(c)
        val t = (SystemClock.uptimeMillis() - inicio) / 1000f
        val cx = width / 2f; val cy = height / 2f
        val z = min(width, height) / 190f
        // un velo oscuro para que se vea sobre cualquier fondo
        c.drawCircle(cx, cy, min(width, height) * 0.36f, sombra)
        if (oyendo || pensando) {
            anillo.strokeWidth = 1.6f * z * 1.5f
            anillo.pathEffect = DashPathEffect(floatArrayOf(4 * z, 8 * z), (t * (if (oyendo) 60 else 25)) * z)
            c.drawCircle(cx, cy, 80 * z, anillo)
        }
        c.save()
        c.translate(cx, cy + sin(t * 3.2f) * 1.8f * z)
        c.rotate(-90f) // la cabeza hacia arriba
        val vel = if (andando) 9f else if (oyendo) 5f else 1.6f
        val amp = if (andando) 10f else if (oyendo) 6f else 3f
        pata.strokeWidth = 2.6f * z
        for (side in intArrayOf(-1, 1)) for (k in 0..3) {
            val fase = (k + (if (side > 0) 1 else 0)) % 2 * Math.PI.toFloat()
            val a = Math.toRadians((side * (ang[k] + sin(t * vel + fase) * amp)).toDouble()).toFloat()
            val r = rest[k] + sin(t * vel + fase + 1f) * amp * 0.4f
            val hx = hipx[k] * z; val hy = side * 5.5f * z
            val fx = cos(a) * r * z; val fy = sin(a) * r * z
            val bend = side * (if (k < 2) -1 else 1)
            val (kx, ky) = rodilla(hx, hy, fx, fy, l1[k] * z, l2[k] * z, bend.toFloat())
            c.drawLine(hx, hy, kx, ky, pata); c.drawLine(kx, ky, fx, fy, pata)
            c.drawCircle(kx, ky, 3.4f * z, junta); c.drawCircle(fx, fy, 3f * z, junta)
        }
        cuerpo.strokeWidth = 2.6f * z
        c.drawRect(-17 * z, -8 * z, 17 * z, 8 * z, relleno)
        c.drawRect(-17 * z, -8 * z, 17 * z, 8 * z, cuerpo)
        junta.alpha = 255
        c.drawCircle(-2 * z, 0f, (3.6f + sin(t * 5) * 0.6f) * z * 1.3f, junta)
        c.drawCircle(13 * z, -3.4f * z, 1.9f * z, junta); c.drawCircle(13 * z, 3.4f * z, 1.9f * z, junta)
        c.restore()
        if (activa) postInvalidateOnAnimation()
    }

    /** La rodilla: el mismo cálculo que ik() de la web. */
    private fun rodilla(hx: Float, hy: Float, fx: Float, fy: Float, a: Float, b: Float, bend: Float): Pair<Float, Float> {
        val dx = fx - hx; val dy = fy - hy
        val d = max(abs(a - b) + 1, min(a + b - 0.5f, hypot(dx, dy)))
        val an = atan2(dy, dx)
        val aa = acos(((a * a + d * d - b * b) / (2 * a * d)).coerceIn(-1f, 1f))
        val k = an + bend * aa
        return Pair(hx + cos(k) * a, hy + sin(k) * a)
    }
}
