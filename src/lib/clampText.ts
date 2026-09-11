/**
 * Klampa en strang till ett tak som `firestore.rules` bokstavligen kan mata.
 *
 * VARFOR EN EGEN FUNKTION OCH INTE `.slice()`. Firestores `size()` raknar
 * UTF-16-kodenheter, precis som JS `.length` — det ar UPPMATT mot emulatorn, inte
 * antaget, och det ar varfor talet i regeln och talet har ar samma storhet.
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
 *   awk '/match .users.{uid} {/,/^    }/' firestore.rules | grep -n displayName
 */
export function clampToCodeUnits(value: string, max: number): string {
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
 * flera stallen, och inget band dem ihop. Flyttas taket i regeln flyttas det har.
 */
export const MAX_DISPLAY_NAME = 80;

/** Taket `firestore.rules` satter pa `users/{uid}.bio`, samma sak. */
export const MAX_BIO = 160;
