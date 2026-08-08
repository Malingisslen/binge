---
paths:
  - "src/app/**"
  - "src/components/**"
  - "tasks/todo.md"
---

# Visuella förhandsvisningar

Malin läser inte kod. Hon läser varje bild. Att känna igen vad man vill ha är
mycket lättare än att beskriva det — så en ny skärm börjar med varianter hon kan
reagera på, inte med kod hon inte kan se.

## I planer

En plan som rör en ny eller ombyggd skärm innehåller en ASCII-skiss per skärm,
direkt i planfilen:

```
┌──────────────────────────────────────┐
│ TOPBAR  binge · veckoremsa · sök · ○ │
├──────────────────────────────────────┤
│ SUBNAV  Hem | Bibliotek | Kalender   │
├──────────────────────────────────────┤
│  [kort: titel + affisch + status]    │
│  [panel till höger: 300px]           │
└──────────────────────────────────────┘
```

Använder du AskUserQuestion för att välja mellan layouter: lägg skissen i
`preview`-fältet, ett alternativ per skiss.

## Innan en ny skärm byggs

`.claude/hooks/preview-gate.mjs` blockerar en ny `src/app/**/page.tsx` tills en
riktningsskiss visats. Kör `/preview --directions`, som bygger 3–4 **oförenliga**
varianter från `docs/design/previews/_binge-template.html` till
`tasks/previews/<slug>-directions.html`.

Oförenliga är kravet, inte en stilfråga: tre varianter av samma idé ger inget att
välja mellan. Varje variant säger vad den offrar.

Undantag för en genuint osynlig route (en omdirigering, en OG-bildhanterare) eller
en mekanisk filflytt: `SKIP_PREVIEW_GATE=1`, och säg varför samtidigt.

## Vid ändring av en skärm som finns

Ingen grind, men samma princip: en HTML-sida före implementationen om ändringen är
synlig. Skissen ärver tokens från mallen, som är en kopia av
`src/app/globals.css :root` — hitta aldrig på en färg där.
