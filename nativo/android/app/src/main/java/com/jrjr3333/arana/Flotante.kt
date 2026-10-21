package com.jrjr3333.arana

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.ImageView
import android.widget.Toast
import kotlin.math.abs

/**
 * 0.21.0 (#30): la araña fuera de su app. Flota sobre las demás apps; un toque la abre escuchando,
 * se arrastra a cualquier sitio y, mantenida pulsada, se guarda.
 */
class Flotante : Service() {
    private var wm: WindowManager? = null
    private var vista: ImageView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == GUARDAR) { stopSelf(); return START_NOT_STICKY }
        primerPlano()
        if (vista == null) mostrar()
        return START_STICKY
    }

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
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun mostrar() {
        val w = getSystemService(WINDOW_SERVICE) as WindowManager
        val d = resources.displayMetrics.density
        val lado = (60 * d).toInt()
        val v = ImageView(this)
        v.setImageResource(R.drawable.arana)
        v.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFF0A0D17.toInt()); setStroke((2 * d).toInt(), 0xFFFF4FA3.toInt()) }
        v.clipToOutline = true
        v.contentDescription = "La araña. Toque para hablar."
        val tipo = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val p = WindowManager.LayoutParams(lado, lado, tipo, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT)
        p.gravity = Gravity.TOP or Gravity.START
        p.x = resources.displayMetrics.widthPixels - lado - (12 * d).toInt()
        p.y = resources.displayMetrics.heightPixels / 3
        var x0 = 0f; var y0 = 0f; var px = 0; var py = 0; var t0 = 0L; var movida = false
        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> { x0 = e.rawX; y0 = e.rawY; px = p.x; py = p.y; t0 = e.eventTime; movida = false; true }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(e.rawX - x0) > 12 * d || abs(e.rawY - y0) > 12 * d) movida = true
                    if (movida) { p.x = px + (e.rawX - x0).toInt(); p.y = py + (e.rawY - y0).toInt(); w.updateViewLayout(v, p) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!movida) {
                        if (e.eventTime - t0 > 700) { Toast.makeText(this, "Me guardo. Pídame «flota» para volver.", Toast.LENGTH_SHORT).show(); stopSelf() }
                        else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("arana://escuchar"), this, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                    }
                    true
                }
                else -> false
            }
        }
        w.addView(v, p)
        wm = w; vista = v
    }

    override fun onDestroy() {
        vista?.let { runCatching { wm?.removeView(it) } }
        vista = null
        super.onDestroy()
    }

    companion object {
        const val CANAL = "flotante"
        const val GUARDAR = "guardar"
    }
}
