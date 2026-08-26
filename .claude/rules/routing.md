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
- Firebase Hosting rewrite: `**` → `/index.html` så alla URLs landar i SPA:n
- Metadata för dynamiska routes sätts klient-sidigt via `usePageMeta`-hook
  (uppdaterar `document.title` + `<meta>`-taggar i DOM)

Lägg **inte** till en ny dynamisk route utan att uppdatera både
DynamicRouter.tsx + firebase.json rewrite.

Titelsidorna (`/movie/[id]`, `/tv/[id]`, `/person/[id]`) har egna `generateStaticParams`
för SEO-pre-rendering vid byggtid — se `.claude/rules/deployment.md` innan du ändrar
antalet pre-renderade titlar eller byggtids-TMDB-anrop.
