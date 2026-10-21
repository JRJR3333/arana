package com.jrjr3333.arana

import android.app.Activity
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/** Lo que devuelve una orden nativa a la web: si salió, qué decir y si se fue a otra app (para preguntar «¿Lo hice bien?» al volver). */
data class Res(val ok: Boolean, val msg: String = "", val fuera: Boolean = false) {
    fun json(): String = JSONObject().put("ok", ok).put("msg", msg).put("fuera", fuera).toString()
}

/**
 * 0.22.0: los ajustes del móvil, en nativo. Lo que Android deja hacer a una app lo hago yo
 * (linterna, brillo, no molestar, Wi-Fi en Android 9 o menos); lo demás abre su panel para que usted toque.
 */
object Ajustes {
    fun aplicar(act: Activity, id: String, v: String): Res {
        val on = v == "on"
        return when (id) {
            "linterna" -> linterna(act, on)
            "brillo" -> brillo(act, v.toIntOrNull() ?: 50)
            "nomolestar" -> noMolestar(act, on)
            "wifi" -> wifi(act, on)
            "datos" -> panel(act, if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_WIRELESS_SETTINGS,
                "Toque los datos móviles para ${if (on) "activarlos" else "apagarlos"}: Android no me deja hacerlo a mí.")
            "bluetooth" -> panel(act, Settings.ACTION_BLUETOOTH_SETTINGS,
                "Toque el Bluetooth para ${if (on) "activarlo" else "apagarlo"}.")
            "oscuro" -> panel(act, Settings.ACTION_DISPLAY_SETTINGS, "Elija el tema ${if (on) "oscuro" else "claro"} en Pantalla.")
            "bajoconsumo" -> panel(act, Settings.ACTION_BATTERY_SAVER_SETTINGS,
                "${if (on) "Active" else "Desactive"} aquí el ahorro de batería.")
            else -> Res(false, "Ese ajuste no lo conozco.")
        }
    }

    private fun linterna(act: Activity, on: Boolean): Res = try {
        val cm = act.getSystemService(CameraManager::class.java)
        val cam = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        if (cam == null) Res(false, "Este móvil no tiene linterna.")
        else { cm.setTorchMode(cam, on); Res(true, if (on) "Linterna encendida." else "Linterna apagada.") }
    } catch (e: Exception) {
        Res(false, "La cámara está ocupada; no puedo encender la linterna.")
    }

    private fun brillo(act: Activity, valor: Int): Res {
        val n = valor.coerceIn(1, 100)
        if (Settings.System.canWrite(act)) {
            val cr = act.contentResolver
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, (n * 255 / 100).coerceIn(1, 255))
            return Res(true, "Brillo al $n %.")
        }
        // Mientras no haya permiso, al menos cambia en mi pantalla.
        act.window.attributes = act.window.attributes.apply { screenBrightness = n / 100f }
        return try {
            act.startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + act.packageName)))
            Res(false, "Para cambiar el brillo de todo el móvil, active «Modificar ajustes del sistema» para la Araña y vuelva a pedírmelo.", true)
        } catch (e: ActivityNotFoundException) {
            Res(true, "Brillo al $n % en mi pantalla.")
        }
    }

    private fun noMolestar(act: Activity, on: Boolean): Res {
        val nm = act.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) {
            return try {
                act.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
                Res(false, "Dele permiso a la Araña en «No molestar» y vuelva a pedírmelo.", true)
            } catch (e: ActivityNotFoundException) {
                Res(false, "Este móvil no me deja tocar «No molestar».")
            }
        }
        nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
        return Res(true, if (on) "No molestar activado." else "No molestar desactivado.")
    }

    private fun wifi(act: Activity, on: Boolean): Res {
        if (Build.VERSION.SDK_INT < 29) {
            val wm = act.applicationContext.getSystemService(WifiManager::class.java)
            @Suppress("DEPRECATION")
            if (wm != null && wm.setWifiEnabled(on)) return Res(true, if (on) "Wi-Fi activado." else "Wi-Fi apagado.")
        }
        return panel(act, if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS,
            "Toque el Wi-Fi para ${if (on) "activarlo" else "apagarlo"}: Android no me deja hacerlo a mí.")
    }

    /** Los paneles salen encima de mi app: pregunto «¿Lo hice bien?» sin esperar a que vuelva. */
    private fun panel(act: Activity, accion: String, msg: String): Res = try {
        act.startActivity(Intent(accion))
        Res(true, msg, false)
    } catch (e: ActivityNotFoundException) {
        Res(false, "No encuentro ese ajuste en este móvil.")
    }
}
