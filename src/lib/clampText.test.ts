// BIN-1134. `firestore.rules` kapar `users/{uid}.displayName` vid ett tak, och
// producenterna maste klampa innan de skriver — annars nekas hela profilwriten och
// ett nyss skapat konto star utan profil.
//
// Det som gor filen vard att ha, och inte bara ett `.slice()`, mattes mot en riktig
// emulator under granskningen: Firestores `size()` raknar UTF-16-kodenheter precis
// som JS `.length`, sa talet i regeln och talet har ar samma storhet — MEN ett bart
// `.slice()` skar mellan kodenheter, inte mellan tecken. Landar snittet mitt i ett
// surrogatpar accepterar regeln skrivningen och Firestore lagrar en ensam surrogat
// som laser tillbaka som U+FFFD. Namnet blir trasigt i stallet for kortat.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  clampToCodeUnits, MAX_DISPLAY_NAME, MAX_BIO, MAX_SESSION_DISPLAY_NAME, MAX_FCM_USER_AGENT,
} from './clampText';

describe('clampToCodeUnits', () => {
  it('lamnar en strang under taket orord', () => {
    expect(clampToCodeUnits('Malin', 80)).toBe('Malin');
  });

  // LIKVARDIG MUTANT, provad och nedskriven i stallet for bortforklarad: att vanda
  // `value.length <= max` till `<` haller alla fall har grona. Det ar inte en lucka
  // i testet utan en egenskap hos koden — ar strangen exakt `max` lang blir `cut`
  // identisk med `value`, och dess sista kodenhet kan omojligt vara en HOG surrogat
  // for valformad indata (ett komplett par slutar pa en LAG). Bada grenarna ger
  // alltsa samma svar. Skillnaden finns bara for en redan trasig strang, och att
  // asserta pa den vore att pinna ett beteende ingen producent kan framkalla.
  it('lamnar en strang EXAKT pa taket orord', () => {
    const atLimit = 'x'.repeat(80);
    expect(clampToCodeUnits(atLimit, 80)).toBe(atLimit);
  });

  it('kortar en strang over taket till taket', () => {
    expect(clampToCodeUnits('x'.repeat(200), 80)).toBe('x'.repeat(80));
  });

  it('en tom strang gar igenom', () => {
    expect(clampToCodeUnits('', 80)).toBe('');
  });

  // DET HAR ar skalet funktionen finns. Ett `.slice(0, 80)` pa samma indata ger en
  // ensam hog surrogat sist; Firestore tar emot den och laser tillbaka U+FFFD.
  it('klyver ALDRIG ett surrogatpar — tecknet slapps i stallet', () => {
    const input = 'x' + '\u{1F600}'.repeat(40); // 1 + 80 kodenheter
    const naive = input.slice(0, 80);
    const clamped = clampToCodeUnits(input, 80);

    // Kontrollprovet: det bara `.slice()` GOR fel, sa testet kan inte vara gront
    // for att indatan rakade vara ofarlig.
    const lastNaive = naive.charCodeAt(naive.length - 1);
    expect(lastNaive).toBeGreaterThanOrEqual(0xd800);
    expect(lastNaive).toBeLessThanOrEqual(0xdbff);

    // Och det vi faktiskt gor ar valformat och ryms.
    expect(clamped.length).toBe(79);
    expect(clamped).toBe('x' + '\u{1F600}'.repeat(39));
    expect([...clamped].every(ch => ch.codePointAt(0) !== 0xfffd)).toBe(true);
  });

  it('slapper inte ett tecken i onodan nar snittet gar rent', () => {
    // En lag surrogat sist ar ett KOMPLETT par — det far inte kortas bort.
    const input = '\u{1F600}'.repeat(41); // 82 kodenheter, snitt vid 80 = helt par
    const clamped = clampToCodeUnits(input, 80);
    expect(clamped.length).toBe(80);
    expect(clamped).toBe('\u{1F600}'.repeat(40));
  });
});

describe('taken', () => {
  // Pinnade pa deklarationen, inte pa vardet: ett test som bara letar efter talet
  // uppfylls av vilken kommentar som helst i filen som namner det.
  it('displayName och bio bar de tal regelfilen anvander', () => {
    expect(MAX_DISPLAY_NAME).toBe(80);
    expect(MAX_BIO).toBe(160);
  });
});

// BIN-1177. Regelspraket kan inte importera en TypeScript-konstant, sa talet star i
// firestore.rules som bokstavlig siffra pa flera klausuler. Har lases de ur regelfilen
// som text och jamfors en i taget mot konstanten klampningen anvander.
//
// Ankrat pa blocken, inte pa indrag och inte pa ett filbrett svep: profilens
// `displayName`, gruppmedlemmens och inbjudans `fromDisplayName` bar samma siffra i dag
// men ar andra storheter, och far inte paverka utfallet.
// Radkommentarerna bort forst: de publicerar kommandon med klammerparenteser som annars
// stanger ett block i fortid.
const RULES = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8').replace(/(^|\s)\/\/[^\n]*/g, '$1');
const SESSIONS_MATCH = 'match /sessions/{sessionId} {';
const PARTICIPANTS_MATCH = 'match /participants/{pid} {';

/** Index for den `}` som stanger blocket vars `{` star pa `open`, eller -1. */
function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Blockets egen kropp, med varje nastlat `match`-block bortklippt. Tom om ankaret saknas. */
function ownBody(text: string, matchLine: string): string {
  const start = text.indexOf(matchLine);
  if (start < 0) return '';
  const open = start + matchLine.length - 1;
  const end = blockEnd(text, open);
  if (end < 0) return '';
  let body = text.slice(open + 1, end);
  for (let nested = body.search(/\bmatch\s+\//); nested >= 0; nested = body.search(/\bmatch\s+\//)) {
    const lineEnd = body.indexOf('\n', nested);
    const nestedOpen = body.lastIndexOf('{', lineEnd < 0 ? body.length : lineEnd);
    const nestedEnd = blockEnd(body, nestedOpen);
    if (nestedOpen < nested || nestedEnd < 0) return '';
    body = body.slice(0, nested) + body.slice(nestedEnd + 1);
  }
  return body;
}

function caps(body: string, field: string): number[] {
  return [...body.matchAll(new RegExp(`${field}\\.size\\(\\)\\s*<=\\s*(\\d+)`, 'g'))].map((m) => Number(m[1]));
}

/** The whole `match /sessions/{sessionId}` block, nested blocks included. Empty if absent. */
function sessionsBlock(text: string): string {
  const start = text.indexOf(SESSIONS_MATCH);
  if (start < 0) return '';
  const end = blockEnd(text, start + SESSIONS_MATCH.length - 1);
  return end < 0 ? '' : text.slice(start, end + 1);
}

function sessionLabelCaps(text: string) {
  const sessions = sessionsBlock(text);
  return {
    hostName: caps(ownBody(sessions, SESSIONS_MATCH), 'hostName'),
    participantDisplayName: caps(ownBody(sessions, PARTICIPANTS_MATCH), 'displayName'),
  };
}

describe('sessionsetikettens tak i firestore.rules', () => {
  const found = sessionLabelCaps(RULES);

  // Utanfor varje loop: en extraktion som hittar noll klausuler far inte bli gron.
  it('hittar hostName-klausulerna och deltagarradens displayName', () => {
    expect(found.hostName, 'hostName.size() i sessionsblockets egen kropp').toHaveLength(2);
    expect(found.participantDisplayName, 'displayName.size() i participants-blockets egen kropp').toHaveLength(1);
  });

  it.each([
    ['sessionsdokumentets forsta hostName-klausul', () => found.hostName[0]],
    ['sessionsdokumentets andra hostName-klausul', () => found.hostName[1]],
    ['deltagarradens displayName-klausul', () => found.participantDisplayName[0]],
  ])('%s ar MAX_SESSION_DISPLAY_NAME', (_label, value) => {
    expect(value()).toBe(MAX_SESSION_DISPLAY_NAME);
  });

  it('profilens, gruppmedlemmens och inbjudans tak paverkar inte utfallet', () => {
    const block = sessionsBlock(RULES);
    const start = RULES.indexOf(block);
    expect(block).not.toBe('');
    const plant = (s: string) => s.replaceAll('.size() <= 80', '.size() <= 81');
    const planted = plant(RULES.slice(0, start)) + block + plant(RULES.slice(start + block.length));
    // Kontrollprovet: planteringen traffade faktiskt nagot utanfor sessionsblocket.
    expect(planted).not.toBe(RULES);
    expect(sessionLabelCaps(planted)).toEqual(found);
  });
});

// BIN-1251. `enablePushForUser` klampar nu `userAgent` innan den skriver, och talet
// den klampar till maste vara talet regeln bokstavligen bar. Samma extraktion som
// sessionsblocket ovan, ankrad pa fcmTokens-blockets EGNA kropp.
const FCM_TOKENS_MATCH = 'match /users/{uid}/fcmTokens/{tokenId} {';

function fcmUserAgentCaps(text: string): number[] {
  return caps(ownBody(text, FCM_TOKENS_MATCH), 'userAgent');
}

describe('fcmTokens userAgent-tak i firestore.rules', () => {
  const found = fcmUserAgentCaps(RULES);

  // Utanfor varje loop: en extraktion som hittar noll klausuler far inte bli gron.
  it('hittar userAgent-klausulen i fcmTokens-blockets egen kropp', () => {
    expect(found, 'userAgent.size() i fcmTokens-blocket').toHaveLength(1);
  });

  it('klausulen ar MAX_FCM_USER_AGENT', () => {
    expect(found[0]).toBe(MAX_FCM_USER_AGENT);
  });

  it('en userAgent over taket klampas till taket', () => {
    const long = 'Mozilla/5.0 '.repeat(200);
    expect(long.length).toBeGreaterThan(MAX_FCM_USER_AGENT);
    expect(clampToCodeUnits(long, MAX_FCM_USER_AGENT).length).toBe(MAX_FCM_USER_AGENT);
  });

  it('en userAgent EXAKT pa taket lamnas orord', () => {
    const atLimit = 'u'.repeat(MAX_FCM_USER_AGENT);
    expect(clampToCodeUnits(atLimit, MAX_FCM_USER_AGENT)).toBe(atLimit);
  });

  // Det bara `.slice()` gor fel, pa just den langd regeln bar.
  it('klyver inte ett surrogatpar vid taket', () => {
    const input = 'u'.repeat(MAX_FCM_USER_AGENT - 1) + '\u{1F600}';
    const naive = input.slice(0, MAX_FCM_USER_AGENT);
    const lastNaive = naive.charCodeAt(naive.length - 1);
    expect(lastNaive).toBeGreaterThanOrEqual(0xd800);
    expect(lastNaive).toBeLessThanOrEqual(0xdbff);

    const clamped = clampToCodeUnits(input, MAX_FCM_USER_AGENT);
    expect(clamped.length).toBe(MAX_FCM_USER_AGENT - 1);
    expect([...clamped].every(ch => ch.codePointAt(0) !== 0xfffd)).toBe(true);
  });
});
