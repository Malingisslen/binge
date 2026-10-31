package nu.binge.tv

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface PairingState {
    data object Loading : PairingState
    data class ShowCode(val userCode: String, val qrUrl: String) : PairingState
    data object Paired : PairingState
    /** Koderna har gått ut utan att någon godkänt: väntar på knapptryck så servergränsen (10 koder/timme) inte tar slut. */
    data object Paused : PairingState
    data class Failed(val message: String, val appCheckToken: String?) : PairingState
}

class PairingViewModel(app: Application) : AndroidViewModel(app) {
    private val api = TvApi()
    private val _state = MutableStateFlow<PairingState>(
        if (api.isSignedIn) PairingState.Paired else PairingState.Loading,
    )
    val state: StateFlow<PairingState> = _state
    private var job: Job? = null

    init {
        if (!api.isSignedIn) begin()
    }

    fun begin() {
        job?.cancel()
        _state.value = PairingState.Loading
        job = viewModelScope.launch { runPairing() }
    }

    fun signOut() {
        api.signOut()
        begin()
    }

    // Koden gäller en minut: hämta en ny när den gått ut så skärmen aldrig visar en död kod.
    private suspend fun runPairing() {
        var expiredCodes = 0
        while (true) {
            if (expiredCodes >= MAX_AUTO_CODES) {
                _state.value = PairingState.Paused
                return
            }
            try {
                val code = api.start()
                _state.value = PairingState.ShowCode(code.userCode, code.qrUrl)
                val deadline = System.currentTimeMillis() + code.expiresInSeconds * 1000L
                while (System.currentTimeMillis() < deadline) {
                    delay(POLL_INTERVAL_MS)
                    when (val r = api.poll(code)) {
                        is PollResult.Approved -> {
                            signInWithRetry(r.token)
                            _state.value = PairingState.Paired
                            return
                        }
                        PollResult.Expired -> break
                        PollResult.Pending -> Unit
                    }
                }
                expiredCodes++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val denied = TvApi.isAppCheckDenied(e)
                val throttled = TvApi.isRateLimited(e)
                _state.value = PairingState.Failed(
                    message = when {
                        denied -> "Binge godkänner inte den här appen än."
                        throttled -> "För många försök. Vänta en stund."
                        else -> "Kunde inte nå Binge. Kontrollera nätverket."
                    },
                    appCheckToken = if (denied) AppCheckSetup.debugToken(getApplication()) else null,
                )
                delay(if (throttled) THROTTLED_DELAY_MS else RETRY_DELAY_MS)
            }
        }
    }

    // Servern har redan raderat kopplingen när den svarar approved, så ett misslyckat inloggningsförsök får inte kasta bort token.
    private suspend fun signInWithRetry(token: String) {
        repeat(SIGN_IN_ATTEMPTS - 1) {
            try {
                api.signIn(token)
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                delay(2_000L)
            }
        }
        api.signIn(token)
    }

    private companion object {
        const val MAX_AUTO_CODES = 3
        const val SIGN_IN_ATTEMPTS = 3
        const val THROTTLED_DELAY_MS = 5 * 60_000L
        // Servern nekar tätare frågor än var fjärde sekund.
        const val POLL_INTERVAL_MS = 5_000L
        const val RETRY_DELAY_MS = 15_000L
    }
}
