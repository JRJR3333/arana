package com.jrjr3333.arana

import android.content.Context
import android.provider.ContactsContract
import java.text.Normalizer

/** 0.45.0 (#47): busca a alguien en los contactos del móvil por su nombre, para escribirle por WhatsApp. */
object Contactos {
    data class Contacto(val nombre: String, val tel: String)

    private fun limpio(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9 ]"), " ").replace(Regex(" +"), " ").trim()

    /** El contacto que mejor encaja con lo que dijo usted: el nombre exacto, luego el que empieza así, luego el que lo contiene. */
    fun buscar(ctx: Context, quien: String): Contacto? {
        val q = limpio(quien).removePrefix("mi ").trim()
        if (q.isEmpty()) return null
        var mejor: Contacto? = null
        var nota = 0
        val cols = arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER)
        ctx.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val nombre = c.getString(0) ?: continue
                val tel = c.getString(1) ?: continue
                val n = limpio(nombre)
                val p = when {
                    n == q -> 4
                    n.startsWith("$q ") -> 3
                    n.split(" ").contains(q) -> 2
                    n.contains(q) -> 1
                    else -> 0
                }
                if (p > nota) { nota = p; mejor = Contacto(nombre, tel) }
            }
        }
        return mejor
    }

    /** El número como lo quiere WhatsApp: con prefijo de país y sin signos (9 cifras = España). */
    fun internacional(tel: String): String {
        val t = tel.trim()
        var d = t.filter { it.isDigit() }
        if (t.startsWith("00")) d = d.removePrefix("00")
        else if (!t.startsWith("+") && d.length == 9) d = "34$d"
        return d
    }
}
