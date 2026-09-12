import type { AcceptInviteResult, JoinViaTokenResult } from '@/lib/firebase/groups';

/**
 * BIN-1166: vilken text en användare får när ett gruppmedlemskap NEKAS.
 *
 * Varför den här modulen finns, och inte bara inbäddade ternärer: flera ytor valde var
 * för sig vad som skulle stå, och valet är hela biljetten. Före BIN-1155 kunde
 * medlemsskrivningen inte nekas på sak, så koden antog att varje sent fel var
 * infrastruktur — invite-vägen sa ingenting alls. Ett textval inbakat i en komponent
 * utan testfil kan bytas tillbaka utan att
 * något faller, och det är precis den tystnad biljetten finns för att stänga. Rena
 * funktioner, testbara utan Firebase — samma utbrytningsmönster som `useX.helpers.ts`
 * och `sessionTiming.ts`.
 *
 * Härled vilka ytor som går genom modulen; räkna dem inte här:
 *   grep -rn "groupDenialCopy" src
 * En ligger med flit UTANFÖR: sidan där man skapar en grupp. Där ÄR användaren ägaren,
 * så modulens "kontakta ägaren" vore nonsens, och `createGroup` returnerar ett värde
 * vid framgång — en resultatunion där hade varit en större ändring än biljetten bad om.
 *
 * REGELN FÖR VAD TEXTEN FÅR SÄGA, och den gäller varje sträng här: servern talar inte
 * om VILKEN klausul som fällde. Texten får därför beskriva vad som hände och vad som
 * är värt att göra härnäst, aldrig varför. Den får inte heller påstå att något är
 * omöjligt — en inaktuell profilkopia i just den här sessionen är EN orsak som ett
 * nekande kan ha, och den hämtas om vid en omladdning.
 */

/** Toasten direkt efter klicket. `null` betyder att inget gick fel. */
export function inviteAcceptToast(res: AcceptInviteResult): string | null {
  if (res.ok) return null;
  if (res.reason === 'transient') return 'Kunde inte acceptera inbjudan just nu. Försök igen om en stund.';
  if (res.reason === 'invite_invalid') return 'Inbjudan gäller inte längre. Be ägaren bjuda in dig på nytt.';
  return 'Det gick inte att gå med i gruppen. Ladda om sidan och prova igen — hjälper det inte, kontakta ägaren.';
}

/** Det som blir kvar på raden när toasten försvunnit. `null` = ingen kvarstående notis. */
export function inviteRowNotice(blocked: 'invite_invalid' | 'refused' | null): string | null {
  if (blocked === 'invite_invalid') return 'Inbjudan gäller inte längre. Avböj den.';
  if (blocked === 'refused') return 'Gick inte att gå med. Ladda om sidan och prova igen.';
  return null;
}

/**
 * Vilka utfall som ska lämna ett BESTÅENDE spår på raden. `transient` gör det inte:
 * det är just det utfall där ett omförsök kan lyckas, så att låsa knappen där hade
 * stängt ute någon som bara råkade ha dålig uppkoppling.
 */
export function inviteBlocksRetry(res: AcceptInviteResult): 'invite_invalid' | 'refused' | null {
  if (res.ok || res.reason === 'transient') return null;
  return res.reason;
}

/** Felrutan på gruppsidan när man gått in via en länk. `null` = ingen ruta. */
export function joinLinkMessage(res: JoinViaTokenResult, attemptsExhausted: boolean): string | null {
  if (res.ok) return null;
  if (res.reason === 'transient') {
    return attemptsExhausted
      ? 'Kunde inte gå med i gruppen. Ladda om sidan och försök igen.'
      : 'Kunde inte gå med i gruppen. Försöker igen…';
  }
  if (res.reason === 'invalid_token') return 'Inbjudningslänken är ogiltig eller har dragits tillbaka.';
  if (res.reason === 'not_found') return 'Gruppen hittades inte.';
  if (res.reason === 'refused') {
    return 'Det gick inte att gå med i gruppen. Ladda om sidan och prova igen — hjälper det inte, kontakta ägaren.';
  }
  return 'Du är redan medlem.';
}

/**
 * Om sidans EGEN rubriktext ska byta från "be ägaren om en länk" till "försöket gick
 * inte igenom". `already_member` är inte ett misslyckande — utan den här skillnaden
 * skulle sidan säga att försöket föll, rakt ovanför en ruta som säger att man redan är
 * medlem.
 */
export function joinAttemptFailed(res: JoinViaTokenResult): boolean {
  return !res.ok && res.reason !== 'already_member';
}

/** Vad en spärr på inbjudningsraden minns: orsaken, och VILKEN inbjudan den gällde. */
export interface InviteBlock {
  reason: 'invite_invalid' | 'refused';
  /** `invitedAt` i millisekunder för just den inbjudan som nekades. */
  at: number;
}

/**
 * Tidpunkten för DEN här inbjudan. En omgjord inbjudan skriver om samma dokument-id
 * med ett nytt `invitedAt`, och det är det enda som skiljer den från den som nekades.
 */
export function inviteStamp(invite: { invitedAt: Date | null }): number {
  return invite.invitedAt?.getTime() ?? 0;
}

/**
 * Spärren gäller den inbjudan som faktiskt nekades, aldrig gruppen för alltid.
 *
 * Utan tidsjämförelsen vore meningen "en ny inbjudan läker det" osann i koden:
 * listkomponenten avmonteras aldrig (den returnerar null när listan är tom), så ett
 * spår som bara kändes på groupId hade låst raden för resten av sessionen — också mot
 * en inbjudan som ägaren just gjort om och som är fullt giltig.
 */
export function blockedReason(
  blocked: Map<string, InviteBlock>,
  invite: { groupId: string; invitedAt: Date | null },
): 'invite_invalid' | 'refused' | null {
  const entry = blocked.get(invite.groupId);
  if (!entry || entry.at !== inviteStamp(invite)) return null;
  return entry.reason;
}
