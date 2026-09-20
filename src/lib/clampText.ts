/**
 * Klampa en strang till ett tak som `firestore.rules` bokstavligen kan mata.
 *
 * VARFOR EN EGEN FUNKTION OCH INTE `.slice()`. Firestores `size()` raknar
 * UTF-16-kodenheter, precis som JS `.length` — det ar varfor talet i regeln och talet
 * har ar samma storhet. Ett test driver det mot emulatorn med ett svenskt namn (a/a/o:
 * en kodenhet, TVA UTF-8-byte per tecken), sa ett `size()` som raknade byte hade fallt
 * det. Testet heter "size() counts UTF-16 code units, not UTF-8 bytes" (BIN-1164) och
 * ligger i `src/test/rules/firestore-rules.test.ts`. Kor sviten i stallet for att lita
 * pa den har meningen:
 *   npm run test:rules
 * Ar emulatorporten upptagen ar det ett HART fel med `--port <n>` som utvag — se
 * portpolicyn i `scripts/run-rules-tests.mjs`. LAS utdatan: en upptagen port kan ge en
 * korning som inte provat nagonting.
 *
 * Men ett bart `.slice()` skar mellan kodenheter, inte mellan TECKEN. Landar
 * snittet mitt i ett surrogatpar — ett emoji, vissa sallsynta CJK-tecken —
 * accepterar regeln skrivningen (storleken ar fortfarande under taket) och
 * Firestore lagrar en ensam surrogat som laser tillbaka som U+FFFD. Namnet blir
 * alltsa inte kortat utan TRASIGT, och den som drabbas ser ett ersattningstecken
 * dar slutet pa deras namn skulle sta.
 *
 * Funktionen slapper darfor det avslutande tecknet nar snittet skulle klyva ett
 * par. Resultatet ar hogst `max` kodenheter och alltid valformat.
 *
 * VAR TAKEN BOR. Talen star dar de bokstavligen ar — i `firestore.rules`.
 * Harled klausulerna for profilens falt med:
 *   awk '/match .users.{uid} {/,/^    }/' firestore.rules | grep -nE 'displayName|bio'
 */
export function clampToCodeUnits(value: string, max: number): string {
  // BIN-1164, MATT 2026-09-20 — den tidiga returen ar inte en lucka.
  //
  // FRAGAN som stallts flera granskningsvarv i rad: faltens `maxLength` kapar en
  // inklistring fore den har funktionen ser strangen. Klipper WEBBLASAREN mitt i ett
  // surrogatpar kommer en ensam halva hit som en strang som redan ryms, den tidiga
  // returen slapper den orord, och Firestore lagrar det som laser tillbaka U+FFFD.
  //
  // SVARET: nej, den klyver inte. Chrome slapper HELA tecknet i stallet for att behalla
  // halva det — samma val funktionen nedan gor. Ingen ensam surrogat natt fram, i
  // varken `input` eller `textarea`.
  //
  // DE TVA STYCKENA NEDAN AR EN DATERAD OBSERVATION, inte nagot repot kan harleda.
  // Ingen kommandorad i det har tradet kan falla dem; det narmaste som finns ar att
  // gora om matningen. Recept, sa att nasta granskningsvarv kan det utan att gissa:
  //
  //   1. En sida med <input maxlength=80> och <textarea maxlength=160>, plus ett
  //      falt UTAN maxlength som kalla.
  //   2. Fyll kallan med `'a'.repeat(max - 1) + '\u{1F600}' + 'zzz'`, sa att kodenhet
  //      [max-1] ar en HOG surrogat (0xd83d) och [max] dess laga halva (0xde00).
  //   3. Markera och kopiera kallan, och klistra in i malfaltet, med RIKTIGA
  //      tangenttryck. En skriptad tilldelning av `value` gar forbi `maxLength` helt
  //      och kan inte svara pa fragan.
  //   4. Las `value.length` och sista kodenheten i malfaltet.
  //
  // UTFALLET, Chrome 153 pa Windows 11, 2026-09-20:
  //   <input maxlength=80>     -> 80 kodenheter in, 79 kvar, sista enhet 0x61, inget U+FFFD
  //   <textarea maxlength=160> -> 160 kodenheter in, 159 kvar, sista enhet 0x61, inget U+FFFD
  //
  // VAD OBSERVATIONEN INTE SAGER: ingenting om andra motorer, andra versioner, eller
  // en inklistring gjord pa nagot annat satt. Den stanger fragan for den motor och den
  // gest som star ovan, och bara den. Den tidiga returen behalls darfor som den ar.
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  // Hog surrogat sist = dess lagre halva lag precis utanfor snittet.
  const splitsAPair = last >= 0xd800 && last <= 0xdbff;
  return splitsAPair ? cut.slice(0, -1) : cut;
}

/**
 * Taket `firestore.rules` satter pa `users/{uid}.displayName`, pa BADA grenarna.
 * Exporterad och delad med flit: fore BIN-1134 bodde talet som en bar literal pa
 * flera stallen, och inget band dem ihop.
 */
export const MAX_DISPLAY_NAME = 80;

/** Taket `firestore.rules` satter pa `users/{uid}.bio`, samma sak. */
export const MAX_BIO = 160;

/**
 * Taket `firestore.rules` satter pa `sessions/{sessionId}.hostName` och pa
 * `sessions/{sessionId}/participants/{pid}.displayName`.
 *
 * EGEN KONSTANT MED FLIT. Talet rakar vara detsamma som MAX_DISPLAY_NAME, men
 * det ar en ANNAN storhet: den ar profilens tak, den har ar Tillsammans-
 * sessionens. Att importera profilens konstant hit hade citerat fel klausul, och
 * en framtida andring av den ena hade tyst flyttat den andra. Klausulerna lases
 * ur regelfilen och jamfors med konstanten:
 *   npx vitest run src/lib/clampText.test.ts -t "sessionsetikettens tak"
 */
export const MAX_SESSION_DISPLAY_NAME = 80;

/**
 * Taket `firestore.rules` satter pa `users/{uid}/fcmTokens/{tokenId}.userAgent`.
 *
 * EGEN KONSTANT, samma skal som ovan: det ar en annan storhet an profilens falt, och
 * den ar ett TAK mot dokumentuppblasning — inte ett matt minsta varde (BIN-1170).
 * `enablePushForUser` skickade `navigator.userAgent` oklippt hit fore BIN-1251; en
 * webblasare med en langre strang hade da fatt hela token-skrivningen nekad, och med
 * den push-aktiveringen. Klausulen lases ur regelfilen och jamfors med konstanten:
 *   npx vitest run src/lib/clampText.test.ts -t "fcmTokens"
 */
export const MAX_FCM_USER_AGENT = 512;
