---
paths:
  - "src/app/**"
  - "src/components/pages/DynamicRouter.tsx"
  - "firebase.json"
---

# Static-export routing: dynamic routes via catch-all

Dynamiska routes (`/movie/:id`, `/tv/:id`, `/person/:id`, `/user/:username`,
`/grupper/:id`, `/tillsammans/:id`) kan inte pre-renderas utan ett
`generateStaticParams`, och vi vill inte lista alla TMDB-ids vid build. Lösningen:

- `src/app/[...path]/page.tsx` renderar `CatchAllClient` som dispatchar till rätt
  client-komponent via URL-segment
- `src/components/pages/DynamicRouter.tsx` är dispatch-punkten — `src/components/pages/`
  som helhet håller de client-komponenter routern dispatchar till
- Firebase Hosting har ingen `**`-omskrivning: en adress som varken är en fil eller fångas
  av en prefix-omskrivning får `out/404.html` med status 404. Varje sort i `resolveRoute`
  behöver därför en omskrivning, och `src/components/pages/routeRewrites.test.ts` fäller en
  sort utan. De delningsbara prefixen i `src/lib/seo/shareShells.ts` skrivs om till ett eget
  skal med egen länkförhandsvisning; listan och `firebase.json` hålls ihop av
  `shareShells.test.ts`
- Metadata för dynamiska routes sätts klient-sidigt via `usePageMeta`-hook
  (uppdaterar `document.title` + `<meta>`-taggar i DOM)

Lägg **inte** till en ny dynamisk route utan att uppdatera både
DynamicRouter.tsx + firebase.json rewrite.

Titelsidorna (`/movie/[id]`, `/tv/[id]`) och `/person/[id]` har egna `generateStaticParams`
för SEO-pre-rendering vid byggtid — se `.claude/rules/deployment.md` innan du ändrar
antalet pre-renderade titlar eller byggtids-TMDB-anrop.
