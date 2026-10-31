package nu.binge.tv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface HomeState {
    data object Loading : HomeState
    data class Ready(val picks: List<Title>, val upcoming: List<Title>, val index: Int) : HomeState {
        val current: Title? get() = picks.getOrNull(index)
    }
    data class Failed(val message: String) : HomeState
    /** Koppla bort slog igenom: reglerna nekar TV:n, så den ska tillbaka till kodskärmen. */
    data object Revoked : HomeState
}

class HomeViewModel : ViewModel() {
    private val repo = WatchlistRepo()
    private val _state = MutableStateFlow<HomeState>(HomeState.Loading)
    val state: StateFlow<HomeState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = HomeState.Loading
        viewModelScope.launch {
            _state.value = try {
                val all = repo.load()
                HomeState.Ready(TonightPicker.picks(all), TonightPicker.upcoming(all), 0)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (isPermissionDenied(e)) HomeState.Revoked
                else HomeState.Failed("Kunde inte hämta din lista. Kontrollera nätverket.")
            }
        }
    }

    fun nextSuggestion() {
        val s = _state.value as? HomeState.Ready ?: return
        if (s.picks.isEmpty()) return
        _state.value = s.copy(index = (s.index + 1) % s.picks.size)
    }

    fun markWatched() {
        val s = _state.value as? HomeState.Ready ?: return
        val title = s.current ?: return
        viewModelScope.launch {
            try {
                repo.markWatched(title)
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = HomeState.Failed("Kunde inte spara. Försök igen.")
            }
        }
    }

    private fun isPermissionDenied(e: Exception) =
        e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
}
