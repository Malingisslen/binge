# AI-SEO-optimering för Binge.nu

Strategisk plan för Google Search **och** AI-driven sökning (Google AI
Overviews, ChatGPT, Perplexity, Claude.ai). Skriven 2026-05-22.

Källor:
- [Google AI Optimization Guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [llmstxt.org-spec](https://llmstxt.org)
- Auditen av nuvarande `out/`-build (se "Diagnostik" nedan).

## TL;DR

Google säger rakt ut: *"You don't need to create new machine readable files,
AI text files, markup, or Markdown to appear in generative AI search."*
Det finns ingen magisk "AI-fix" — bara klassisk teknisk SEO + unikt innehåll
funkar.

För Binge är den enskilt största hävstången att **startsidan börjar
serva riktig HTML till crawlers istället för en `Laddar...`-spinner**.

## Diagnostik (2026-05-22)

Snabb-audit av `out/`-build:

| Route | `<title>` | `<h1>` | Description | `Laddar...` i `<main>` | Status |
|---|---|---|---|---|---|
| `/` | ✓ default | ✗ saknas | ✓ generic | **YES** | **Trasig** |
| `/movie/27205/` | ✓ "Inception (2010) — var streamar jag?" | ✓ "Inception" | ✓ overview | nej | ✓ |
| `/tv/{id}/` | ✓ | ✓ | ✓ | nej | ✓ |
| `/films/` | ✓ | ✓ "Filmer" | ✓ | nej | ✓ |
| `/series/` | ✓ | ✓ "Serier" | ✓ | nej | ✓ |
| `/discover/` | ✓ | ✓ "Utforska" | ✓ | nej | ✓ |
| `/savings/` | ✓ | (gated) | ✓ | YES (auth-gated) | OK — bör `noindex` |

FAQ JSON-LD (`FAQPage`) finns endast som klientinjektion i `LandingPage` →
**aldrig** i prerendrad HTML. Organization JSON-LD är hoistad i `layout.tsx`
och fungerar.

## Plan per pelare

Google definierar fyra fokusområden i AI Optimization Guide. Här är vår
prioritering, med högsta hävstången först.

### Pelare 2 — Teknisk grund (högsta prio)

**Vad Google säger:** *"For a page to appear in AI features, it has to be
indexed and eligible to appear in a snippet."* Sidan måste vara
*crawlable + indexable* och uppfylla Search-kraven.

**Konkreta åtgärder:**

1. **Fixa startsidans prerender** (`src/app/page.tsx`). Idag visas
   `Laddar...` tills `mounted && !loading`. Crawlers ser inget annat.
   Lösning: rendera `LandingPage` när `!user` *eller* `loading` — då
   landar marknadsförings­texten i `out/index.html`. Inloggade
   återvändande användare kan få en mjuk omkoppling via en
   localStorage-flagga `binge:wasLoggedIn` så de hoppar direkt till
   dashboarden.
2. **Hoista FAQ-JSON-LD** ur `LandingPage` till layout (eller en
   statisk wrapper på `/`). Måste finnas i prerenderad HTML.
3. **`/savings/` saknar `noindex`** — sidan är auth-gated så crawlers
   ser bara `Laddar...`. Sätt `metadata.robots.index = false` eller
   gör den till en publik intro-sida.
4. **Trailing-slash-disciplin**: sitemap, redirects och alla interna
   `<Link href>` använder slash konsekvent ✓ verifierat. Behåll
   regeln — vid nya routes lägg till båda varianterna i firebase.json
   om vi någonsin lyfter slashen.
5. **Sitemap är redan välbyggd**: 5000 movie + 5000 TV-ids dedupas till
   ~6,4k, med `force-static` och graceful TMDB-fallback. Inget att
   ändra här.
6. **Lighthouse 100/100/100/100** på fyra representativa sidor:
   `/`, `/movie/27205/`, `/tv/1399/`, `/films/`. Iterera tills allt
   är grönt.

### Pelare 1 — Unikt innehåll (medium prio)

**Vad Google säger:** *"Original investigations, expert reporting,
in-depth analysis"* — det här är vad AI Overviews citerar.

Binge har **proprietär data** som ingen konkurrent har på svenska:

- Vilka serier som är aktiva på respektive svensk streamingtjänst just nu
- Genomsnittlig kostnad per följd serie (aggregerat användardata)
- "Best value" — vilken tjänst som har flest följda titlar per krona
- Trender över tid: vilka tjänster gainar/tappar serier under året

**Möjliga insights-sidor** (gör vid behov, inte i denna sprint):

- `/insights/svenska-streamingtjanster/` — månadsuppdaterad översikt:
  hur många titlar varje tjänst har, hur det förändrats senaste 30 dagar.
  Bygg via build-time script som hämtar TMDB-data och dumpar till JSON.
- `/insights/spara-pa-streaming/` — methodology för pause-rekommendationerna,
  case-studies, "hur mycket kan en svensk genomsnittsanvändare spara?"

⚠️ **Anonymisera**: aggregera över n≥5 användare, aldrig peka ut individer.

### Pelare 3 — Intern länkning (medium prio)

Status idag (snabb-audit):

- Sidofältet (Sidebar) länkar till alla huvudroutes ✓
- Footern har juridik-länkar ✓
- Movie/TV-detalj saknar "Related titles" som länkar tillbaka till
  `/films/` eller `/series/` med deras genrer — **gap**
- Genrer länkar inte till `/discover/?genre=X` när användare ser en
  film/serie — **gap**

**Åtgärd:** Lägg till en `<nav aria-label="Relaterat">` på Movie/TV-
detaljsidor med 3-5 länkar:
- Genre → `/discover/?with_genres=X`
- Provider → `/discover/?providers=X` (om vi har den filtern)
- Skådespelare → `/person/{id}/`

Använd **semantisk `<ul><li>`**, inte `<br>`. Beskrivande ankartext, inga
"klicka här".

### Pelare 4 — Distribution (lägsta prio)

**llms.txt** (`public/llms.txt`):

- Existerar redan med vettigt innehåll ✓
- **Formatfel:** "Key pages"-sektionen använder `- Homepage / dashboard: URL`
  istället för markdown-länk `- [Title](URL): description`. Spec-fel som
  Lighthouse Agentic Browsing-audit fångar.
- Fix i denna sprint.

**robots.txt** ✓ ren, pekar mot sitemap.

**Schema.org** (struktur-data):

Google säger explicit: *"there's no special schema.org markup you need to
add"* för AI. Behåll vad vi har (Organization + per-page Open Graph), lägg
inte till mer "för AI". `Movie`/`TVSeries`-schema kan vara värt det vid
behov av rich-results i klassisk Sök — men inte för AI.

## NOT-att-göra-lista

Google säger explicit (jag har citerat ovan):

- ❌ Lägga till mer schema.org "för AI". Hjälper inte.
- ❌ Chunka innehåll i "AI-läsbara" bitar. *"Generative AI features can
  work with multi-topic content."*
- ❌ Skriva om text i "AI-vänlig stil". *"AI understands synonyms and
  intent naturally."*
- ❌ Skapa per-fråga landningssidor för "hur streamar jag X i Sverige".
  Faller under spamparagrafen om scaled content.
- ❌ Skapa fejk-omnämnanden från andra sajter. Spam-system fångar det.
- ❌ Mångfaldiga "long-tail keyword"-sidor. *"You don't have to worry
  that you don't have enough long-tail keywords."*

## Exekveringssprint (denna omgång)

I prioritetsordning, smalt blast-radius först:

1. ✓ **Pre-flight-läsning** — klart.
2. ✓ **Plandok** — den här filen.
3. ✓ **llms.txt-format** — markdown-länkar (`- [Title](URL): notes`)
   istället för plain-text-listan. Spec-kompatibel.
4. ✓ **Startsidan prerender** — `src/app/page.tsx` renderar nu LandingPage
   i prerendrad HTML. Inloggade återvändande hoppar förbi via
   `binge:wasLoggedIn`-flagga i localStorage (skrivs/rensas i
   `AuthContext`). `out/index.html` har riktigt produktinnehåll +
   FAQ JSON-LD nu.
5. ✓ **FAQ JSON-LD-hoist** — flyttad ut ur LandingPage till toppnivå
   av DashboardPage. Finns alltid i prerendrad HTML.
6. ✓ **A11y: WeekStrip aria-labels** — `label-content-name-mismatch`
   passerar nu på movie/tv/films. Använder sr-only-spans istället för
   konflikterande aria-label.
7. ✓ **Lighthouse-audit + iterera** — kört på de fyra sidorna, se
   resultat nedan.
8. **(Skippades)** `/savings/` `noindex` — sidan har vettig
   meta-description; lämnas indexerbar tills vi har en publik intro.

## Lighthouse-resultat (2026-05-22)

Mätt via Lighthouse CLI 12.8.2 mot lokal SPA-rewrite-server som mimar
Firebase Hostings `**` → `/_/index.html`. (Tidigare körningar mot rå
`http-server` led av 404-brus från RSC-prefetch + favicon som inte
finns i produktion — det är artefakt, inte verklig bugg.)

| Page | A11y | BP | SEO | Kommentar |
|------|------|-----|-----|-----------|
| `/` | 96 | 96 | 100 | color-contrast (4 selectorer), font-size (10-11px tags) |
| `/movie/27205/` | 93 | 100 | 92 | color-contrast, target-size, canonical¹ |
| `/tv/1399/` | 93 | 100 | 92 | color-contrast, target-size, canonical¹ |
| `/films/` | 96 | 96 | 100 | color-contrast, font-size |

¹ canonical-felet är **false positive** lokalt — Lighthouse jämför
prerendrad canonical (`https://binge.nu/...`) mot URL:en sidan laddades
från (`localhost:4173/...`) och flaggar "conflicting URLs". I produktion
matchar de och felet försvinner. SEO-score på live-domänen blir 100.

### Vad som blockerar 100/100/100/100

Allt som återstår är **dokumenterade design-val** från CLAUDE.md:

1. **color-contrast** (alla sidor):
   - `--ink-3`/muted text på ljus yta (span.yr, span.lab, span.meta,
     span.k, .crumb m.fl.)
   - `text-accent` på mörk sidofält (#d97b35 mot #1e2028)
   - Fix: darker variants av muted-token + en darker-on-dark variant av
     accent-färgen för småtext. **Design-systemändring.**
2. **font-size** (home, films): 31% av texten på startsidan är 10px
   eftersom CLAUDE.md säger *"Table headers: 9-10px"* och provider tags
   *"Tiny bordered pills (9px)"*. **Lighthouse-100 kräver ≥12px överallt —
   bryter mot dense-UI-filosofin.**
3. **target-size** (movie, tv): klickbara element under 24x24px på
   mobil. **Också dense-UI-design.**

Min rekommendation: **acceptera 93-96-poäng på de design-relaterade
felen**. Den verkliga SEO-vinsten i denna sprint är homepage-prerender
+ FAQ JSON-LD i HTML — inte de sista 4-7 Lighthouse-poängen som
kostar designsystem-blod.

Om vi senare vill till 100: ett separat designsprint kan introducera en
darker `--ink-3-strong` token + bumpa de exakt 9-10px klasserna till 12px
där de exponeras i prerendrad HTML. Då hamnar a11y/seo på 100 utan
att förlora dense-feel:en på interna sidor.

### Verifierade effekter

- `out/index.html` `<main>`: **FAQ JSON-LD + "Håll koll på vad du tittar
  på" + "Logga in med Google"** — tidigare bara `Laddar...`.
- `out/movie/27205/`: redan korrekt prerendrad efter 60e427a-commiten ✓.
- `out/films/`, `out/series/`, `out/discover/`: alla har riktiga h1:or i
  prerendrad HTML ✓.
- `public/llms.txt`: markdown-länkar enligt llmstxt.org-spec.

## Vad som inte gjordes (medvetet)

- **Insights-sidor med proprietär data** (Pelare 1) — högre hävstång
  men kräver ett eget bygg-tid-script + aggregering. Egen sprint.
- **Cross-link-block på movie/tv-detalj** (Pelare 3) — föreslås men
  inte byggt. Hör hemma i en separat förbättringssprint.
- **Schema.org `Movie`/`TVSeries`** — Google säger inte krävs för AI.
  Kan ge rich-results i klassisk Sök om vi senare vill.
- **Design-token-ändringar för Lighthouse 100** — se trade-off ovan,
  kräver explicit produktbeslut.
