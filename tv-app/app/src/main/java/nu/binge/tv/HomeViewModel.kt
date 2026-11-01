package nu.binge.tv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface HomeState {
    data object Loading : HomeState
    data class Ready(
        val picks: List<Title>,
        val upcoming: List<Title>,
        val index: Int,
        val overview: Overview,
        /** Platserna i soffan. Bara i minnet: närvaro är en uppgift om människor och sparas aldrig. */
        val seated: Set<Int>,
    ) : HomeState {
        val current: Title? get() = picks.getOrNull(index)
    }
    data class Failed(val message: String) : HomeState
    /** Koppla bort slog igenom: reglerna nekar TV:n, så den ska tillbaka till kodskärmen. */
    data object Revoked : HomeState
}

class HomeViewModel : ViewModel() {
    private val repo = WatchlistRepo()
    private val api = TvApi()
    private val _state = MutableStateFlow<HomeState>(HomeState.Loading)
    val state: StateFlow<HomeState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = HomeState.Loading
        viewModelScope.launch {
            _state.value = try {
                val all = repo.load()
                // Översikten är en extra: faller den bort (nät, gräns) fungerar Ikväll ändå.
                val overview = try {
                    api.overview(listOf(0))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (isDenied(e)) throw e
                    Overview.EMPTY
                }
                HomeState.Ready(
                    picks = TonightPicker.picks(all, overview.providers),
                    upcoming = TonightPicker.upcoming(all),
                    index = 0,
                    overview = overview,
                    seated = setOf(0),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (isDenied(e)) HomeState.Revoked
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

    /** Sätt dig i eller res dig ur soffan. Ägaren (plats 0) sitter alltid kvar. Hushållsvyn hämtas om för just dem som sitter. */
    fun toggleSeat(index: Int) {
        val s = _state.value as? HomeState.Ready ?: return
        if (index == 0) return
        val seated = if (index in s.seated) s.seated - index else s.seated + index
        _state.value = s.copy(seated = seated)
        viewModelScope.launch {
            try {
                val overview = api.overview(seated.sorted(), s.overview.household?.roster)
                val now = _state.value as? HomeState.Ready ?: return@launch
                // Ett snabbt andra tryck kan ha hunnit före det här svaret; då gäller det senaste valet.
                if (now.seated != seated) return@launch
                // Hushållet ändrades sedan förra svaret: platserna pekar på andra personer, så soffan nollställs.
                val reset = overview.household?.seatingReset == true
                _state.value = now.copy(overview = overview, seated = if (reset) setOf(0) else seated)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (isDenied(e)) _state.value = HomeState.Revoked
            }
        }
    }

    private fun isDenied(e: Exception) =
        (e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED) ||
            (e is FirebaseFunctionsException && e.code == FirebaseFunctionsException.Code.PERMISSION_DENIED)
}
