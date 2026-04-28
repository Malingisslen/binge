# Push-notifs setup (Fas 4)

Den här filen samlar alla manuella steg som krävs för att aktivera FCM-baserade
push-notifs på binge.nu. Koden är redan i `main`, men det finns moment som
inte kan automatiseras genom commit + deploy från denna repo.

## Översikt

Vi skickar push när:

1. **Vänskapsförfrågan kommer in** — `users/{uid}/friendRequests/{fromUid}`
   create → notif till `uid`.
2. **Filmkväll loggad i grupp** — `groups/{id}/sessionHistory/{sessionId}`
   create → notif till alla gruppmedlemmar utom skribenten.

Push:en är opt-in per device. Användaren toggle:ar i Inställningar →
Notifikationer. Browsers utan stöd (iOS Safari < 16.4, vissa privacy-modes)
gömmer toggle:n.

## Förkrav

### 1. Uppgradera Firebase-projektet till Blaze-plan

Cloud Functions kräver pay-as-you-go. Förväntad kostnad i denna skala
(≤ 1000 push-events/månad): under 1 USD/månad.

1. Gå till [Firebase Console → Usage and billing](https://console.firebase.google.com/project/binge-nu/usage)
2. **Modify plan** → välj **Blaze (pay as you go)**
3. **Sätt en hård utgiftstak**:
   - Gå till [GCP Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets)
   - Skapa en **Budget** för projektet `binge-nu` med t.ex. **$5/månad**
   - Aktivera **"Cap project usage when budget exceeded"** så
     functions stängs av automatiskt om någon abusar (sällsynt, men
     försäkring).

### 2. Generera VAPID web-push-nyckel

VAPID är public-key-cryptot som webbläsaren använder för att verifiera
push-pakets-källor.

1. Firebase Console → **Project settings** → **Cloud Messaging**-fliken
2. Scrolla till **Web configuration** → **Web Push certificates**
3. Klicka **Generate key pair**
4. Kopiera den genererade publika nyckeln (lång base64-sträng som börjar med `B`)
5. Lägg till i `.env.local` och i Hosting-deploy-env (GitHub Secrets):
   ```
   NEXT_PUBLIC_FCM_VAPID_KEY=<inklistrade nyckeln>
   ```
6. Re-deploya hosting med uppdaterad env. Utan VAPID-key visar
   settings-toggle:n bara "Push är inte konfigurerad".

### 3. Fyll i SW-config

Service worker:n (`public/firebase-messaging-sw.js`) hardcodar Firebase-
config eftersom SW inte kan läsa `process.env`. Tre fält måste ersättas
från `firebase apps:sdkconfig`:

```bash
firebase apps:sdkconfig --project binge-nu WEB
```

Output kommer ge dig något i stil med:
```
{
  "apiKey": "AIzaSy...",
  "authDomain": "binge-nu.firebaseapp.com",
  "messagingSenderId": "1234567890",
  "appId": "1:1234567890:web:abc123",
  ...
}
```

Ersätt placeholder-värdena i `public/firebase-messaging-sw.js`:
- `REPLACE_FIREBASE_API_KEY` → `apiKey`
- `REPLACE_MESSAGING_SENDER_ID` → `messagingSenderId`
- `REPLACE_FIREBASE_APP_ID` → `appId`

(Värdena är publika — de syns redan i den serverade JS-bundeln. Hardcoding
är inte en säkerhetsregression.)

### 4. Deploya Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Första deployen tar ca 2-3 minuter (provisioning av runtime). Två
funktioner ska visas i Firebase Console → Functions:

- `onFriendRequestCreate` (region `europe-west1`)
- `onSessionPickCreate` (region `europe-west1`)

### 5. Deploya updated rules + hosting

```bash
firebase deploy --only firestore:rules,hosting
```

Reglerna lägger till `users/{uid}/fcmTokens/{tokenId}` skrivskydd (owner
only). Hosting deployar med ny CSP som tillåter `gstatic.com/firebasejs/`-
imports inifrån SW:n + `worker-src 'self'`.

## Verifiering

### Manuell smoke test

1. Logga in på binge.nu från en webbläsare som stödjer push (Chrome,
   Firefox, Edge, Safari ≥ 16.4 på macOS/iOS).
2. Settings → **Notifikationer** → toggla **Skicka push-notifs till den här
   enheten**. Browser-permission-dialog ska poppa upp — accept:a.
3. Toast: "Push-notifs aktiverade" + Firestore får ny doc i
   `users/{uid}/fcmTokens/`.
4. Logga in som annan användare i en separat profile/inkognito → skicka
   vänförfrågan till første kontot.
5. Inom ~10 sekunder ska en OS-notif ploppa upp på første enheten:
   "Ny vänförfrågan — {namn} vill bli vän".
6. Klick på notifen → öppnar `/friends/?tab=requests`.

### Test vid app-fokus

Om både din browser-tab är öppen och fokuserad när vänförfrågan kommer in
visas notifen som **in-app toast** istället för OS-notif (FCM:s
foreground-suppression). Det är medvetet — mindre påträngande UX när du
redan är i appen.

### Cleanup-flöde

1. Settings → Notifikationer → toggla AV.
2. Token-doc i `users/{uid}/fcmTokens/` raderas + browser-side
   `deleteToken()` körs.
3. Re-toggle ON skapar nytt token-doc.

### Token-cleanup vid invalid

Cloud Functions raderar automatiskt tokens som FCM rapporterar som
ogiltiga (`messaging/registration-token-not-registered` eller
`messaging/invalid-registration-token`). Du kan se detta i
`firebase functions:log` när det händer.

## Kostnads-monitorering

Budget-alarm + cap är konfigurerat i steg 1. Utöver det:

- [Firebase Console → Usage](https://console.firebase.google.com/project/binge-nu/usage) — daglig översikt
- `firebase functions:log --only onFriendRequestCreate,onSessionPickCreate` — verifiera
  att ingenting går i loop

Realistic baseline för dagens användarbas: 1-10 push:ar/dag → ~$0.01/månad
i Cloud Functions-execution + ~$0.0001/månad i FCM-skick (FCM är gratis).

## Felsökning

### "Push är inte konfigurerad — NEXT_PUBLIC_FCM_VAPID_KEY saknas"

Steg 2 är inte klart. VAPID-key behövs i miljö där `next build` körs
(inkl. CI/CD).

### "Notiser blockerade i webbläsaren"

Användaren har tidigare gjort "Block" i permission-dialogen. Måste
manuellt rensa via webbläsarens site-settings (Chrome: lås-ikonen i
adressraden → Notifications → Allow).

### Push kommer inte fram

1. `firebase functions:log` — finns det error-loggar?
2. Verifiera `users/{uid}/fcmTokens/` har minst ett doc + att
   `notificationSettings.pushEnabled === true` på user-doc:et.
3. CSP-block: öppna DevTools-Console på sajten och leta efter CSP-
   violations vid SW-registrering.
4. SW inte registrerad: DevTools → Application → Service Workers →
   `firebase-messaging-sw.js` ska vara "activated and is running".

### "messaging/registration-token-not-registered" i logs

Det är förväntat — användaren har raderat appen från enheten eller
återställt browser-storage. Functions raderar token-doc:et automatiskt.

## Nästa steg (out of scope för Fas 4)

- **Per-kanal opt-out**: idag är det allt-på eller allt-av. Kan delas i
  framtiden så friend-requests och group-picks toggleas separat.
- **Notif-history-vy**: idag visas push:en bara som OS-toast och loggas
  inte. Vi har redan in-app `notifications`-collection som kan utvidgas.
- **Native push på iOS via PWA**: kräver att användaren installerar sajten
  som hemskärms-app. Settings-UI:n kan promotea det.
