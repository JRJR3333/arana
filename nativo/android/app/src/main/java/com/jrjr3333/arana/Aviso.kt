package com.jrjr3333.arana

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 0.48.0 (#23): avisos con la app cerrada. «Recuérdame a las 18:30 llamar a mamá» programa una alarma del
 * sistema; a esa hora salta una notificación de la araña aunque la app esté cerrada o el móvil reiniciado.
 * Los avisos pendientes se guardan en «arana.avisos» (nunca se borra nada que no haya sonado ya).
 */
class Aviso : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getIntExtra(ID, 0)
        val texto = i.getStringExtra(TEXTO) ?: "Tiene un aviso."
        prefs(c).edit().remove(id.toString()).apply()
        mostrar(c, id, texto)
        Widget.refrescar(c)
    }

    companion object {
        const val CANAL = "avisos"
        const val ID = "id"
        const val TEXTO = "texto"

        private fun prefs(c: Context) = c.getSharedPreferences("arana.avisos", Context.MODE_PRIVATE)

        /** Programa un aviso para el instante [en] (milisegundos). Devuelve false si ya ha pasado. */
        fun poner(c: Context, texto: String, en: Long): Boolean {
            if (en <= System.currentTimeMillis()) return false
            val id = ((en / 1000) % 1_000_000_000L).toInt() xor texto.hashCode().and(0xFFFF)
            prefs(c).edit().putString(id.toString(), "$en|$texto").apply()
            programar(c, id, en, texto)
            Widget.refrescar(c)
            return true
        }

        /** Cuántos avisos quedan por sonar. */
        fun pendientes(c: Context): Int = prefs(c).all.size

        private fun programar(c: Context, id: Int, en: Long, texto: String) {
            val am = c.getSystemService(AlarmManager::class.java) ?: return
            val pi = PendingIntent.getBroadcast(c, id,
                Intent(c, Aviso::class.java).putExtra(ID, id).putExtra(TEXTO, texto),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val exacto = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            try {
                if (exacto) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, en, pi)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, en, pi)
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, en, pi)
            }
        }

        /** Tras reiniciar el móvil o actualizar la app, Android olvida las alarmas: las vuelvo a poner. */
        fun reprogramar(c: Context) {
            val ahora = System.currentTimeMillis()
            for ((k, v) in prefs(c).all) {
                val s = v as? String ?: continue
                val en = s.substringBefore('|').toLongOrNull() ?: continue
                val texto = s.substringAfter('|')
                val id = k.toIntOrNull() ?: continue
                // Si sonaba mientras el móvil estaba apagado, aviso ahora mismo
                if (en <= ahora) { prefs(c).edit().remove(k).apply(); mostrar(c, id, texto) }
                else programar(c, id, en, texto)
            }
        }

        fun mostrar(c: Context, id: Int, texto: String) {
            val nm = c.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CANAL, "Avisos que usted me pide", NotificationManager.IMPORTANCE_HIGH))
            val abrir = PendingIntent.getActivity(c, id,
                Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE)
            val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CANAL) else @Suppress("DEPRECATION") Notification.Builder(c)
            val n = b.setSmallIcon(R.drawable.arana)
                .setContentTitle("Araña le recuerda")
                .setContentText(texto)
                .setStyle(Notification.BigTextStyle().bigText(texto))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(abrir)
                .build()
            try { nm.notify(1000 + (id and 0xFFFFF), n) } catch (e: SecurityException) { }
        }
    }
}

/** Tras reiniciar el móvil o actualizar la app, vuelvo a poner los avisos pendientes. */
class Arranque : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED || i.action == Intent.ACTION_MY_PACKAGE_REPLACED) Aviso.reprogramar(c)
    }
}
