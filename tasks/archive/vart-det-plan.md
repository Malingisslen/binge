# Värt det i november — hidden template (BIN-1449, package M part 3)

Approved by Malin: plan (2026-10-06 "kör"), sketch https://claude.ai/artifact/UyCA6YvVxNqXCPqFScjRL3 section 3, levels per service and texts (2026-10-07 "allt som rekommenderat"). Published only after the price agent run on 2026-11-03 and Malin's ok.

## Sketch
```
┌──────────────────────────────────────────────────────────────┐
│ eyebrow binge.nu/vart-det/2026-11                             │
│ H1 Värt det i november 2026                                   │
│ ingress: Vad som kommer, vad som blir dyrare och vad som      │
│ försvinner … Priserna kontrollerades den 3 november.          │
├────────┬───────┬─────────────────┬──────────┬──────┬─────────┤
│ Tjänst │ Från  │ Nytt i november │ Pris     │Försv.│ Binges  │
│ Max    │109 kr │ Serie S2 (12/11)│Oförändrat│  6   │Mycket ny│
│ Disney+│ 89 kr │ Film (21/11)    │69 → 89 kr│  2   │Lite nytt│
├────────┴───────┴─────────────────┴──────────┴──────┴─────────┤
│ fine print: the level rule                                    │
│ [Räkna på din egen streaming] [Alla priser]                   │
└──────────────────────────────────────────────────────────────┘
```

## Build
- Static route `src/app/vart-det/[month]/page.tsx`, `generateStaticParams` = ['2026-11'], `dynamicParams=false`, force-static. A static file needs no firebase.json rewrite.
- Hidden: `robots: noindex, nofollow`, not in the sitemap, `/guider/`, footer or nav until Malin's ok. Publishing = flip to index + add sitemap/hub entries.
- Rows: the SEO_PROVIDER_IDS paid services in `providers.ts`.
  - Från: `cheapestEntertainmentTier` price from the catalog (list price, never campaigns).
  - Pris: `PRICE_CHANGES` rows dated in the month ("69 → 89 kr"), else "Oförändrat".
  - Nytt i november: build-time TMDB discover per provider (`with_watch_providers`, new films by primary release date and new series/seasons by air date in the month), through `buildSignal()` with a try/catch fallback like `provider/[id]`. Shows the top title with date and "och N till". TMDB provider data is current availability, so the text says "enligt TMDB".
  - Försvinner: client-side count from the public `streamingLeaving/current` doc (rolling 31 days), only dates inside the month; "–" when the data does not cover the month.
  - Binges räkning: Mycket nytt ≥3, Lite nytt 1–2, Inget nytt 0, rule printed under the table.
- No affiliate or outbound links (#24). CTAs go to /streamingkostnad/ and /streamingpriser/.
- Uses ui parts (cardClass, eyebrowClass, buttonClass, thClass), PageHeader.
- Workflow map: route in `docs/workflow-map-universe.json` + a flow covering it, in its own commit.
- Tests: pure helper `src/lib/seo/vartDet.ts` (level rule, price change text, month window, leaving count in month), page metadata noindex.

## #26 conditions (blind critique 2026-10-07, approve-with-conditions)
1. Robots `{ index: false, follow: true }` (VART_DET_ROBOTS), metadata test; publishing is one named flip with its own test update.
2. Canonical `/vart-det/<month>/`; month parsing and names in `vartDet.ts`; a new month is one entry in `VART_DET_MONTHS`.
3. At publish: a bare `/vart-det/` (redirect or noindex stub to the latest month); decide with Malin whether past months stay indexed as an archive (default yes); each month keeps its own "Priserna kontrollerades den X".
4. Publish checklist below.
5. Försvinner is counted in the browser; the page says so ("Försvinner räknas när sidan öppnas.").

## Publish checklist (after the price agent run 2026-11-03)
- Confirm the price agent ran and `priceVerifiedDate` is 2026-11-03 on the shown services; redeploy so the intro date is true.
- Show Malin the live page; publish only on her ok.
- Flip robots for the month (VART_DET_ROBOTS → per-month) and update the tests.
- Add the month to `src/lib/seo/sitemap.ts` + `sitemap.test.ts`, a section in `src/lib/seo/hubLinks.ts` + `hubLinks.test.ts`, links from /streamingpriser/ and the provider pages; footer only if Malin wants it, never Subnav.
- Bare `/vart-det/` per condition 3.

## Code review 2026-10-07, built
Alias provider ids in discover; a failed read (Firestore or any TMDB lookup) shows "–", never 0 or "Inget nytt"; the leaving count only when the rollup reaches the month end; no check date claimed when a shown service has none; only `effective` price rows count as a change in the month; the premiere cell shows TMDB's most popular; the page states the day TMDB was read; tests pin it out of the sitemap and /guider/.
Raise with Malin at publish: built on 3 Nov, later-month premieres are often not yet listed on the service in TMDB, so levels lean low until a later rebuild; the season lookup reads the 10 most popular running series per service.
Also for Malin at publish: a rollup made on 3 Nov has no titles that left 1–2 Nov, so Försvinner counts from the 3rd; a single failed TMDB season lookup leaves that service at "–".
