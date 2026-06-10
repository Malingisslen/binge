# QA-fixrunda — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Källor:
> `docs/analysis/QA_AUDIT_2026-06-09.md` (fynden) + `docs/analysis/qa_verified.json`
> (verifierade rotorsaker med fil:rad — LÄS din WP:s entries innan du kodar).

**Goal:** Åtgärda samtliga fynd från QA-auditen 2026-06-09/10 (utom works-as-designed: P2, B15, H2 — dokumenteras).

**Architecture:** 9 sekventiella work packages grupperade per subsystem (inte severity) så agenter inte krockar i filer. Varje WP: implementera → verifiera (`typecheck && lint && test`) → commit. Full gate + build vid slutet. Branch `qa-fixes`.

**Regler för alla WP:**
- Grunda i qa_verified.json-entryn — rotorsaken är redan identifierad, hitta inte på en annan.
- TDD för ren logik; typecheck/lint-verifiering för UI-wiring.
- Designsystemet gäller: LoadingView/EmptyState/NotFound, danger-tokens, svenska, inga råa "Laddar…".
- Ingen scope-creep utanför WP:ns fynd-IDn.

---

## WP1 — Provider-dedup + namn (X3, T1, SÖ2, M2, A3, T5)
Rotorsak (verifierad): `canonicalProviderId` mappar bara hårdkodade alias — Amazon-Channel-variant-ids passerar omappade, OCH render-ytorna dedupar aldrig på kanoniskt id. Fix: (a) lägg Amazon-Channel-alias i SWEDISH_PROVIDERS (Apple TV+ AC, HBO Max/Max AC, m.fl. — slå upp verkliga TMDB-ids via discover/titel-payload eller dokumenterade listor; om ett id inte kan verifieras: heuristik på namn-suffix " Amazon Channel" i extraktionen), (b) deduppa på canonicalProviderId i extraktions-/render-lagret (providers.ts-hjälpare som ytorna delar — TVShowPageClient:87-91, MoviePageClient:74-78, search/page:60-66, TitleCard), (c) A3: enhetligt visningsnamn (shortName vs name) i advisor-ytor, (d) T5: bakgrunds-placeholder (--placeholder-fill) på provider-logotyper. Tester för dedup-hjälparen.

## WP2 — Loading-gates X1-familjen (X1, A1, A2, B13, P1, R1, R3, X2, G6, H4)
Rotorsak: ytor konsumerar partiella query-resultat utan "allt laddat?"-gate. Fix per yta enligt JSON: advisor-gaten i savings/page:160 (vänta tills relevanta queries är klara — inte providers.length), WatchlistPage läser inte `loading` från WatchlistContext (B13), UserProfilePageClient gear bara på profil-loading (P1), useRecommendationsCascade sorterar om rader under laddning (R1 — lås ordningen tills allt löst), RecRow:116 bar "Laddar…" → LoadingView (R3), AuthGuard:19 + DynamicRouter:16 bare-text → LoadingView (X2/G6), HemFocal bild-skeleton (H4).

## WP3 — Biblioteket (B1, B2, B5, B6, B7→T2, B8, B9, B10, B14; B15 = WAD-kommentar)
Kärnfix (B7/T2/B2): `showsByTmdbId` i WatchlistPage är permanent tom → tvSubState faller till heuristik. **Constraint: INGEN 194-query fan-out** — använd persisterade fält (tmdbStatus + lastWatched* som uppdateras lazy via updateTmdbStatus) för substate-derivering; om det kräver mer data, derivera 'ikapp' när lastWatched == senast kända aired (acceptera lazy-färskhet). Övrigt: B1 räknare med scope-etikett eller en källa; B5 pluralisering ("1 titel"); B6 sektionering konsekvent över vyer (eller räknare flyttad/märkt); B8 enhetlig obetygsatt-visning; B9 legend/tooltip för statusprickar; B10 dölj TYP-kolumn på enmedia-vyer; B14 enhetlig verktygsrad; B15 lämna men kommentera WAD i koden.

## WP4 — Routes/nav/titlar (B11, B12, X5: B3, B16, S2)
B11: /my/vill-se 404 — rename/redirect så dokumenterade URL:en funkar (page + DynamicRouter + ev. firebase.json-redirect för gamla /my/want-to-watch; minns: nya dynamiska routes kräver DynamicRouter + firebase.json). B12: biblioteks-undervyer nåbara — sub-tabbar/länkar i WatchlistPage (Följer/Vill se/Filmer/Avbrutna/Alla) för desktop. X5: unika dokumenttitlar via usePageMeta på my-vyerna, settings, grupp/tillsammans, Vänner-suffix.

## WP5 — Kalender + WeekStrip (K1, K2, K3, K4; H2 = WAD)
K2 (verifierad): buildHeadline dubbelräknar premiärer som extra term — gör kategorierna disjunkta eller copyn additiv-korrekt. K1 ("likely" = X1-klass): samma array för count + kort — gate:a render tills entries stabila. K3: WeekStrip query/staleTime-divergens mellan Hem och /calendar — säkerställ samma queryKey+staleTime (TMDB_STALE) och datakälla. K4: avgör + implementera medvetet val (visa passerade dagar eller märk "passerad"), dokumentera. H2: WAD — lägg "+N till"-indikator om billigt, annars lämna med kommentar.

## WP6 — Sök + topbar (SÖ1, H1, SÖ3, S1, G7)
SÖ1: ingen kbd-handler finns alls — lägg global Cmd/Ctrl+K-listener (metaKey || ctrlKey) som fokuserar söket. H1: plattformsdetekterad hint (⌘K på Mac, Ctrl+K annars). SÖ3: spellCheck={false} på sök- och filterinputs. S1: avatar → dropdown-meny (Min profil /user/{username}, Inställningar, ev. Logga ut) — popover-mönstret från notispanelen. G7: sessions-badgen visar antal sessioner (eller prick), inte kvarvarande svep.

## WP7 — Grupper/Tillsammans (G1, G2, G3, G4, G5, G8)
G1: window.confirm → designad modal med .btn-danger (mönster: befintliga modaler). G2: count och innehåll samma logik (union-minus-intersect ELLER etikett "utöver gemensamma"). G3: hostName ska vara deltagarens namn, inte gruppnamnet (GroupPageClient:157). G4: generateCandidates exkluderar (eller märker) titlar som deltagarna redan har i bibliotek. G5: copy utan jargong ("Alla har" / "Någon har" utan parentes-enum). G8: deleteGroup städar/markerar gruppens aktiva sessioner (sessions where groupId == … → avsluta eller märk föräldralös; respektera rules).

## WP8 — Detalj/person/rek/hem-polish (M1, T3, T4, R2, R4, PE1, PE2, PE3, X4/B4, H3)
M1: trailer-embed felhantering — dölj sektionen när thumbnail/embed saknas/failar. T3: "Markera alla sedda" döljs när 0 avsnitt sänts. T4: en avsnittsangivelse ("S3E1 · 2 jul 2026"). R2: seed-titel i radrubriken; R4: begriplig copy. PE1: översätt TMDB-department ("ACTING"→"Skådespelare" osv.). PE2: "Biografi på engelska"-markering vid fallback. PE3: separera/filtrera Self-credits. X4/B4: poster-placeholder (bg --placeholder-fill) under lazy-load. H3: konsekvent metarad (provider med när den finns).

## WP9 — Utredningar (X6/T7, T6)
T7/X6: profilera säsongsexpansionen på en stor serie (React DevTools-resonemang i koden: leta tunga re-renders/synkrona loopar i SeasonList/EpisodeRow); fixa om orsaken är tydlig + billig, annars dokumentera fynd i docs/analysis/. T6: förklara 8-förslag-vs-5 (dolda/not-interested-filtrering?) — fixa countern eller lägg förklaring.

---

**Per WP:** commit med beskrivande meddelande som listar fynd-IDn. **Slutligen:** full gate (`typecheck && lint && test && build`), uppdatera QA-auditen med ✅-markeringar per åtgärdat fynd, slutgranskning av hela grenen.
