package com.jrjr3333.arana

import android.content.Context
import android.content.Intent
import java.text.Normalizer

/** 0.21.0 (#31): abrir apps de verdad en Android, por su paquete o por el nombre que se ve en el móvil. */
object Apps {
    /** Las que la web llama con otro nombre o cuyo nombre en Android no se parece. */
    private val PAQUETES = mapOf(
        "whatsapp" to listOf("com.whatsapp", "com.whatsapp.w4b"),
        "spotify" to listOf("com.spotify.music"),
        "youtube" to listOf("com.google.android.youtube"),
        "instagram" to listOf("com.instagram.android"),
        "telegram" to listOf("org.telegram.messenger"),
        "gmail" to listOf("com.google.android.gm"),
        "correo" to listOf("com.google.android.gm"),
        "chrome" to listOf("com.android.chrome"),
        "safari" to listOf("com.android.chrome"),
        "maps" to listOf("com.google.android.apps.maps"),
        "mapas" to listOf("com.google.android.apps.maps"),
        "tiktok" to listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"),
        "x" to listOf("com.twitter.android"),
        "amazon" to listOf("com.amazon.mShop.android.shopping"),
        "netflix" to listOf("com.netflix.mediaclient"),
        "chatgpt" to listOf("com.openai.chatgpt"),
        "claude" to listOf("com.anthropic.claude"),
        "linkedin" to listOf("com.linkedin.android"),
        "outlook" to listOf("com.microsoft.office.outlook"),
        "teams" to listOf("com.microsoft.teams"),
        "gcal" to listOf("com.google.android.calendar"),
        "calendario" to listOf("com.google.android.calendar", "com.samsung.android.calendar"),
        "fotos" to listOf("com.google.android.apps.photos"),
        "onefootball" to listOf("de.motain.iliga"),
        "bet365" to listOf("com.bet365Wrapper.Bet365_Application"),
    )

    fun norm(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").replace(Regex("[^a-z0-9 ]"), "").trim()

    /** El intent que abre la app, o null si no está en este móvil. */
    fun buscar(ctx: Context, id: String?, nombre: String?): Intent? {
        val pm = ctx.packageManager
        for (p in PAQUETES[id ?: ""].orEmpty() + PAQUETES[norm(nombre ?: "")].orEmpty()) {
            pm.getLaunchIntentForPackage(p)?.let { return it }
        }
        val quiere = norm(nombre ?: id ?: "")
        if (quiere.isEmpty()) return null
        val lanzables = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        val conNombre = lanzables.map { it to norm(it.loadLabel(pm).toString()) }
        val elegida = conNombre.firstOrNull { it.second == quiere }
            ?: conNombre.firstOrNull { it.second.startsWith(quiere) || quiere.startsWith(it.second) && it.second.length >= 3 }
            ?: conNombre.firstOrNull { it.second.contains(quiere) && quiere.length >= 4 }
        return elegida?.first?.activityInfo?.packageName?.let { pm.getLaunchIntentForPackage(it) }
    }
}
