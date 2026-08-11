# Plan 2026-08-11 — kryssrutan ska spegla registreringen, inte en lapp

## Problemet

`NotificationsSection.tsx:55` → `pushEnabled && hasDeviceToken`, där `hasDeviceToken` bara
frågar om nyckeln `binge:fcm:tokenId:{uid}` finns i localStorage. Den nyckeln är en
**pekare till** registreringen, inte registreringen. Tre vägar raderar dokumentet utan att
röra pekaren:

1. **FCM:s självläkning** — `functions/src/push.ts:116-120` raderar token-dokumentet på
   `registration-token-not-registered` / `invalid-registration-token`. Helt normalt när en
   webbläsare rensat sajtdata eller avregistrerat sin service worker.
2. **BIN-848:s svep** — raderar tokens för konton Auth inte längre erkänner.
3. **En avbruten utloggning** — `disablePushForUser` raderar dokumentet och tar sedan bort
   pekaren, men sidan laddas om direkt efter `firebaseSignOut`.

Efter någon av dem visar rutan ikryssat över en enhet som inte får något. Det är exakt den
lögn BIN-844 byggdes för att stoppa, en dörr längre in — och ingen får veta att pushen dog.

## Router

`node docs/org/route.mjs` på de tre filerna → `tier: "medium"`, `panel: [19]`, inga
high-stakes. Alltså EN blind kritik från #19 Customer Support / Success före bygget.

## Vad som byggs

**`hasLivePushToken(uid)`** i `messaging.ts` — asynkron, ersätter `hasLocalPushToken` som
kryssrutans källa:

| Läge | Svar |
|---|---|
| pekare saknas | `false` — definitivt oregistrerad här, ingen läsning görs |
| dokumentet finns | `true` |
| dokumentet saknas, svar från servern | rensa pekaren (självläkning), `false` |
| dokumentet saknas, svar ur cachen | `true` — frånvaro i cache bevisar ingenting |
| läsningen kastar | `true` — "kunde inte kolla" är inte "borta" |

**Riktningen är hela poängen.** Rutan får bara gå från ikryssad till tom när servern
uttryckligen svarat att dokumentet inte finns (`snap.metadata.fromCache === false`). Ett
nätverksavbrott, en offline-session eller en kastande läsning behåller det gamla svaret.
Annars byter vi en ruta som ljuger åt ena hållet mot en som ljuger åt andra — och den
varianten får folk att kryssa i push igen på en enhet som redan fungerar, vilket lämnar
ett andra token-dokument efter sig.

**Kryssrutans effekt** sätter först det synkrona pekar-svaret (samma första målning som
i dag, ingen blinkning) och förfinar sedan med serversvaret. Avbrottsvakt så ett gammalt
svar inte skriver över ett nyare — effekten kör om på `busyKeys`.

**En rad under rutan** när kontot vill ha push men enheten inte är registrerad:
"Push är avstängd på den här enheten — kryssa i rutan för att slå på den igen."
Utan den syns bara en tom ruta, och det var läget ingen fick veta om.

## Kostnad

En `getDoc` per laddning av Inställningar, och bara när en pekare finns. Inställningar är
ingen fan-out-yta. Försumbart mot 25 SEK/mån-taket.

## Acceptans (bindande)

- [ ] Pekare finns + dokument finns → ikryssad.
- [ ] Pekare finns + servern säger att dokumentet saknas → tom ruta OCH pekaren rensad.
- [ ] Pekare finns + svaret kom ur cachen → **ikryssad**, pekaren orörd.
- [ ] Pekare finns + läsningen kastar → **ikryssad**, pekaren orörd.
- [ ] Ingen pekare → tom ruta, ingen läsning alls.
- [ ] `pushEnabled: false` → tom ruta oavsett dokument.
- [ ] Ett gammalt svar som landar efter ett nyare skriver inte över det.
- [ ] Raden syns bara när kontot vill ha push och enheten saknar registrering.

## Ärvt från BIN-848 (kvar, oberoende av det här)

Svepet är deployat och rättigheten kontrollerad (körtidskontot har `roles/editor`, som
innehåller `firebaseauth.users.get`). Tvångskörningen 2026-08-10 gav `checkedUids: 0`
eftersom det inte fanns ett enda `fcmTokens`-dokument. **Nu finns det ett** — kör svepet
en gång till och bekräfta `checkedUids > 0` med `skippedAuthBatches: 0`, så är även den
kedjan prövad. Regeln själv bor i `docs/analysis/EXTERNAL_ACTIONS.md`, inte här.
