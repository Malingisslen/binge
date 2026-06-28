# Moderation runbook

Hur man hanterar rapporterat innehåll + missbruk på Binge.nu.

_Version: 1.0 (2026-04-24)_

---

## 1. Hur rapporter kommer in

Användare triggar rapporter via UgcActionsMenu (trepunktsmenyn på recensioner
och kommentarer). Dessa skrivs till `reports/{reportId}` top-level
Firestore-collection.

**Fältformat:**

| Fält | Typ | Värde |
|------|-----|-------|
| `reporterUid` | string | Uid för användaren som rapporterade |
| `targetType` | string | `review` / `comment` / `user` / `list` |
| `targetId` | string | Review-id eller `reviews/{reviewId}/comments/{commentId}` för kommentarer |
| `targetOwnerUid` | string | Uid för ägaren av det rapporterade innehållet |
| `reason` | string | `spam` / `hate` / `harassment` / `illegal` / `pii` / `other` |
| `note` | string \| undefined | Valfri kontext från rapportören (max 500 tecken) |
| `status` | string | `open` (default), `reviewed`, `actioned`, `dismissed` |
| `createdAt` | Timestamp | Serverklocka |

Klienter kan **inte** skriva till `reports` direkt — regeln är
`allow create: if false` (se `firestore.rules` → `match /reports/{reportId}`).
Rapporter skapas enbart via den server-auktoritativa callablen
`submitReport` (`functions/src/submitReport/`), som med Admin SDK kringgår
reglerna och enforce:ar en cooldown per uid (10 s) i en transaktion — ett
anti-abuse-skydd mot rapport-spam/mass-flaggning (BIN-49, ersatte den gamla
batch-baserade rate-limiten i BIN-25). Servern stämplar `createdAt`/
`targetOwnerUid` m.m., inte klienten, så fält kan inte förfalskas.

Läsning är admin-only (`allow read: if isAdmin()`) — vanliga användare kan
aldrig läsa sina egna eller andras rapporter (sekretess mot den rapporterade).
Admin-triage sker via Firebase Console med din ägar-inloggning.

---

## 2. Dagligt triage

**Frekvens:** 1 gång/dag initialt, oftare om rapport-volymen växer.

**Steg:**

1. Öppna https://console.firebase.google.com/project/binge-nu/firestore/databases/-default-/data/~2Freports
2. Sortera efter `createdAt desc` (nyast först)
3. Filter: `status == 'open'`
4. Per rapport: klassificera per nedan

---

## 3. Beslutsträd per `reason`

### `spam`

- **Signal:** länkar, reklam, repetitivt innehåll, shilling
- **Action:**
  - Första rapporten → sätt `status: 'reviewed'` om borderline (en länk i
    annars bra recension), eller actiona direkt om tydligt spam
  - Återkommande spam från samma `targetOwnerUid` → ta bort alla deras
    reviews/comments + inaktivera kontot (manuell delete via console, eller
    kör `deleteAccount`-flödet med admin-rättigheter)

### `hate` / `harassment`

- **Signal:** rasism, homofobi, transfobi, personangrepp, könskränkningar
- **Action:**
  - **Nolltolerans:** ta bort innehållet direkt (även om borderline — vi är en
    liten plattform, False Positives skadar oss mindre än att låta hat stå)
  - Om upprepat: stäng kontot. Skriv till adressen (om e-post finns) att
    kontot brutit community-riktlinjerna (`/community-guidelines`)

### `illegal`

- **Signal:** hot, barnporr, otillåten spridning av personinformation, etc.
- **Action:**
  - **Omedelbar borttagning**
  - **Om barnporr (CSAM):** rapportera till NCMEC CyberTipline
    (https://report.cybertip.org/) — kräver snabb reaktion (lagkrav i USA,
    vilket Firebase-datan lyder under)
  - **Om hot mot specifik person:** överväg polisanmälan, behåll evidence
    via Firebase PITR (7 dagar — snapshot:a rapporten + target-docen innan
    radering)
  - Stäng användarens konto direkt

### `pii`

- **Signal:** delad privat information (hemadress, telefon, obehörig bild,
  identifierande kontaktuppgifter till tredje part)
- **Action:**
  - Ta bort specifika PII-fragment via editera recensionen (eller ta bort
    hela om det mesta är PII)
  - Ingen konto-stängning vid första rapporten — folk postar PII av
    okunnighet ibland, varna
  - Upprepning → stäng konto

### `other`

- **Signal:** Något annat
- **Action:** läs noten, använd omdömet. Dokumentera beslut i status-fältet.

---

## 4. Actioner — hur utför man dem?

Alla dessa kräver direct Firestore-edit via Firebase Console (v1).
Admin-UI är på backlog i FUTURE_ROADMAP.md (Sprint 6 B4 area).

### Ta bort en review

1. Console → Firestore → `reviews/{reviewId}`
2. Radera dokumentet (delete-knapp uppe till höger)
3. Glöm inte subcollections — `reviews/{id}/likes/*` + `comments/*` ska
   också bort. Firebase Console raderar automatiskt subcollections om
   användaren bekräftar.
4. Uppdatera rapporten: `status: 'actioned'`, lägg till `actionedAt: <now>`,
   `actionedBy: 'malin@binge.nu'` (eller vem som tog actionen)

### Ta bort en kommentar

1. Console → Firestore → navigera till `reviews/{reviewId}/comments/{commentId}`
2. Radera
3. Uppdatera rapporten som ovan

### Stäng ett konto

1. Console → Authentication → sök efter `targetOwnerUid`
2. Disable eller delete user
3. Kör `deleteAccount`-cascaden via att inloggning-impersonera är INTE
   möjligt — antingen be användaren göra det själv, eller gör det manuellt
   via Admin SDK (kräver skript, ej byggt än)
4. Vid critical (barnporr etc.) — kontakta Firebase Support för emergency
   account termination

### Dismiss en rapport

Oftast om det är falsk flagga eller borderline-innehåll som inte bryter
riktlinjerna:
- `status: 'dismissed'`, lägg till `dismissedAt` + `dismissedReason`

---

## 5. Rate-limiting / spam-protection

**Nuvarande:**
- Client-side 1-sekunds cooldown mellan rapporter (hindrar knapp-spam)
- Firestore-regel begränsar note-length (500 tecken)
- **Ingen** hård rate-limit per timme/dag — lita på att reporterUid kan
  spåras

**När ska vi lägga till hårdare limits?**
- Om 1 användare står för > 50% av alla rapporter på en vecka → sannolikt
  false-flag-spam, overväg att blocklista från att rapportera
- Om samma target rapporteras > 10 gånger från olika reporters på en dag
  (mass-reporting) → triage prioriteras, notera om det är koordinerat

**Implementera när relevant:** `reports/{uid}_rate/` subcollection
med rolling window, eller Cloud Function som räknar rapporter/tidsfönster.

---

## 6. Block-funktionen (klient-side)

Användare kan också blockera andra användare via UgcActionsMenu. Det skriver
till `users/{uid}/blocked/{targetUid}`. **Detta är inte moderation** — det
är en självhjälpsfunktion. Ägaren själv kontrollerar sina blocks.

Filter sker klient-sidigt i:
- `ReviewList` (filter på `!isBlocked(review.uid)`)
- `ReviewComments` (filter på `!isBlocked(comment.uid)`)
- `FeedPage` (filter på `!isBlocked(item.uid)`)

Admin behöver inte vidta åtgärd på blocks — de är symmetriska själv-
kontrollverktyg.

---

## 7. Loggning + evidens-backup

**Innan du raderar något,** ta en screenshot + kopiera JSON-representationen
av rapport + target-doc till en lokal säker fil. Behövs för:
- Eventuell polisanmälan (§3 illegal-beslutsträdet)
- Revision vid tvist ("varför togs mitt innehåll bort?")
- GDPR-dokumentation (art. 5.1(e) — om vi anonymiserar/behåller vs raderar)

**PITR räcker INTE som evidens-policy** — fönstret är bara 7 dagar (och
kräver Blaze-plan som vi inte har aktiverat än). Ta lokala kopior vid
allvarliga beslut.

---

## 8. Community-riktlinjer-referens

Länka till `/community-guidelines/` (live på binge.nu) när du kommunicerar
med användare om borttagningar. Det är vår "TOS för innehåll" och backar
beslut med offentlig policy.

---

## 9. Framtida automatisering

Sprint 6 (FUTURE_ROADMAP.md) inkluderar ett admin-UI för rapports-
modereringen. När det finns:

- Lista rapporter med filtrera/sortera
- Action-knappar som kör delete-cascade automatiskt
- Audit log med `actionedBy` (om flera admins)

Tills dess: Firebase Console + denna runbook + manuella actions.

---

## 10. Escalation

Saker som går utanför din kompetens som privatperson-drivare:

- **Lagligt** (hot, CSAM, GDPR-klagomål från myndighet): IMY.se + eventuellt
  polis
- **Plattformsmissbruk** (DDoS, bot-nets): Firebase Support + Cloudflare
  abuse-report
- **Copyright-claim** på TMDB-metadata: TMDB har tydliga terms — oftast
  inte ditt problem eftersom du bara cache:ar deras data

---

_Runbooken är levande. När nytt moderationsmönster dyker upp, uppdatera
beslutsträdet._
