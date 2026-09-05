---
name: commit
description: Commit, push, deploy och purga Cloudflare-cachen för binge.nu i ett svep. Använd när användaren säger /commit, "commit it", "deploya", "släpp", eller "commit + deploy + purge". Hanterar pull/rebase om main har gått framåt på origin.
---

# /commit — commit + deploy + purge

Ett svep för att få lokala ändringar live på binge.nu. Pushar till `main` (vilket triggar GitHub Actions-deploy) och purgar sedan Cloudflare-cachen så besökare ser nya bygget direkt.

## Flöde

### 1. Sanity-check — finns det något att shippa?

```bash
git status --short
git log --oneline origin/main..HEAD 2>/dev/null
```

- Om både working tree är rent OCH inga olokala commits ligger på HEAD: ingenting att göra. Säg det och stoppa.
- Om bara olokala commits finns (ingen unstaged diff): hoppa till steg 4 (push).
- Annars: fortsätt till commit.

### 2. Stega upp + commita lokala ändringar

Kör i parallell för att förstå diffen:
```bash
git status
git diff --stat
git diff
git log --oneline -5
```

Drafta ett commit-meddelande baserat på diffen. Följ projektets stil (conventional commits-aktigt, blandat svenska/engelska — t.ex. `feat(lists): ...`, `chore(docs): ...`, `fix(advisor): ...`). Håll det kort och beskriv *varför*, inte *vad*.

Stega specifika filer (aldrig `git add -A` eller `git add .` — kan dra in `.env.local` eller annat skräp). Commit med HEREDOC och Co-Authored-By:

```bash
git commit -m "$(cat <<'EOF'
<message here>

Co-Authored-By: Codex Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Visa det draftade meddelandet för användaren innan commit. Om hooks failar — fixa root cause och gör en *ny* commit (aldrig `--amend`, aldrig `--no-verify`).

### 3. Pull --rebase om origin/main gått framåt

```bash
git fetch origin main
git rev-list --count HEAD..origin/main
```

- Om count = 0: hoppa till push.
- Om count > 0: `git pull --rebase origin main`.
  - Vid konflikt: stoppa, visa konfliktfilerna, be användaren lösa. Kör inte `--abort` eller `--skip` utan att fråga.

### 4. Push till main

```bash
git push origin main
```

Push till `main` triggar `.github/workflows/deploy.yml`. Du behöver alltså inte deploya lokalt.

### 5. Vänta in GitHub Actions-deployen

```bash
gh run list --workflow=deploy.yml --branch=main --limit=1 --json databaseId,status,conclusion,headSha,createdAt
```

Hitta runet som matchar den nyss pushade commiten (`headSha` ska börja med `git rev-parse HEAD`). Pollla status med `gh run view <id> --json status,conclusion` tills `status` = `completed`.

- `conclusion` = `success`: gå vidare till purge.
- `conclusion` = `failure`/`cancelled`: stoppa, visa `gh run view <id> --log-failed` och be användaren titta. Purga **inte** cachen om deployen failar — då skulle besökare få den gamla versionen serverad utan cache-skydd.

Polla med ~30s mellan checks. Bygget tar typiskt 3–5 min.

### 6. Purga Cloudflare-cachen

Anropa `/purge`-skillen (eller kör den inline):

```bash
source .env.local && curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Verifiera `"success": true` i svaret.

### 7. Rapportera

Kort summering till användaren:
- Commit-SHA + meddelande
- Länk till GH Actions-runet
- Bekräftelse på cache-purge

## Gotchas

- **Aldrig push --force till main.** Om push avvisas pga non-fast-forward: kör `git pull --rebase` (steg 3) igen, lös eventuella konflikter, försök igen.
- **Aldrig --no-verify.** Om pre-commit-hook failar: fixa felet och gör om committen.
- **Skippa inte deploy-väntan.** Att purga cachen innan deployen är klar tjänar ingenting — den gamla buildet ligger fortfarande på Firebase Hosting tills GH Actions är klart.
- **Om `.env.local` saknar `CF_*`:** purgen kan inte köras. Säg till användaren att lägga in `CF_ZONE_ID` och `CF_API_TOKEN`.
- **Quality gates körs i workflow, inte här.** Om du är osäker på om koden är grön kan du köra `npm run lint && npm run typecheck` lokalt innan steg 4 — men det är inte ett krav. Workflow-en är auktoritativ.
