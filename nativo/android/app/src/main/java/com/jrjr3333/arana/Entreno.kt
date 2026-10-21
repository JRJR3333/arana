package com.jrjr3333.arana

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * 0.30.0: el ajedrez sigue entrenando con la pantalla apagada o en otra app.
 * Servicio en primer plano con una notificación fija que dice cómo va (la sala la actualiza en cada generación)
 * y un bloqueo parcial para que la CPU no se duerma. Se para al pausar el entrenamiento.
 */
class Entreno : Service() {
    private var bloqueo: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == PARAR) { stopSelf(); return START_NOT_STICKY }
        val texto = intent?.getStringExtra(TEXTO) ?: "Mis arañas están jugando."
        val n = aviso(this, texto)
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, n)
        if (bloqueo == null) {
            bloqueo = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "arana:ajedrez").apply { setReferenceCounted(false); acquire(12 * 60 * 60 * 1000L) }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        bloqueo?.let { if (it.isHeld) it.release() }; bloqueo = null
        super.onDestroy()
    }

    companion object {
        const val ID = 3
        const val CANAL = "ajedrez"
        const val TEXTO = "texto"
        const val PARAR = "parar"

        fun aviso(c: Context, texto: String): Notification {
            val nm = c.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CANAL, "Ajedrez: cómo va el entrenamiento", NotificationManager.IMPORTANCE_LOW))
            val abrir = PendingIntent.getActivity(c, 3, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
            val parar = PendingIntent.getService(c, 4, Intent(c, Entreno::class.java).setAction(PARAR), PendingIntent.FLAG_IMMUTABLE)
            val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CANAL) else @Suppress("DEPRECATION") Notification.Builder(c)
            return b.setSmallIcon(R.drawable.arana)
                .setContentTitle("Araña · ajedrez")
                .setContentText(texto)
                .setStyle(Notification.BigTextStyle().bigText(texto))
                .setOngoing(true).setOnlyAlertOnce(true)
                .setContentIntent(abrir)
                .addAction(Notification.Action.Builder(null, "Dejar de avisar", parar).build())
                .build()
        }

        /** Cambia el texto de la notificación fija sin reiniciar el servicio. */
        fun actualizar(c: Context, texto: String) {
            c.getSystemService(NotificationManager::class.java).notify(ID, aviso(c, texto))
        }
    }
}
