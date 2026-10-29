package com.jrjr3333.arana

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * 0.48.0 (#23): el widget de la pantalla de inicio. La araña y «Toque y hable»: un toque abre la app
 * escuchando (arana://escuchar), sin buscarla entre las apps.
 */
class Widget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        val abrir = PendingIntent.getActivity(c, 21,
            Intent(Intent.ACTION_VIEW, Uri.parse("arana://escuchar"), c, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Aviso.pendientes(c)
        for (id in ids) {
            val v = RemoteViews(c.packageName, R.layout.widget)
            v.setTextViewText(R.id.widget_texto, if (n > 0) "Toque y hable · $n aviso" + (if (n > 1) "s" else "") else "Toque y hable")
            v.setOnClickPendingIntent(R.id.widget_raiz, abrir)
            m.updateAppWidget(id, v)
        }
    }

    companion object {
        /** Al poner o sonar un aviso, el widget cuenta los que quedan. */
        fun refrescar(c: Context) {
            val m = AppWidgetManager.getInstance(c)
            val ids = m.getAppWidgetIds(android.content.ComponentName(c, Widget::class.java))
            if (ids.isNotEmpty()) Widget().onUpdate(c, m, ids)
        }
    }
}
