package com.jrjr3333.arana

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * 0.45.0 (#48): el oído de la araña, sin la ventana del micrófono de Google. Escucha dentro de la app
 * (o desde la araña flotante) con SpeechRecognizer, enseña lo que va oyendo y para sola cuando usted
 * se calla. Necesita el permiso de micrófono; sin él, la app vuelve a la ventana de siempre.
 */
class Oido(
    private val ctx: Context,
    private val parcial: (String) -> Unit,
    private val fin: (String?, String?) -> Unit,
) {
    private var sr: SpeechRecognizer? = null
    var escuchando = false
        private set

    /** false si este móvil no tiene reconocimiento de voz para apps. */
    fun empezar(): Boolean {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) return false
        parar()
        val r = try { SpeechRecognizer.createSpeechRecognizer(ctx) } catch (e: Exception) { return false }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
            override fun onPartialResults(p: Bundle?) {
                val t = p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (escuchando && !t.isNullOrBlank()) parcial(t)
            }
            override fun onResults(p: Bundle?) = terminar(p?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull(), null)
            override fun onError(e: Int) = terminar(null, motivo(e))
        })
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
        sr = r
        escuchando = true
        return try { r.startListening(i); true } catch (e: Exception) { parar(); false }
    }

    private fun terminar(t: String?, err: String?) {
        if (!escuchando) return
        escuchando = false
        val r = sr; sr = null
        runCatching { r?.destroy() }
        fin(t, err)
    }

    /** Deja de escuchar sin avisar a nadie. */
    fun parar() {
        escuchando = false
        val r = sr; sr = null
        runCatching { r?.cancel(); r?.destroy() }
    }

    private fun motivo(e: Int) = when (e) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No le he oído."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Me falta el permiso del micrófono."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Sin conexión no le entiendo bien."
        else -> "No le he entendido."
    }
}
