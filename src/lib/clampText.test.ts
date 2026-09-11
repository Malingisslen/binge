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

import { describe, it, expect } from 'vitest';
import { clampToCodeUnits, MAX_DISPLAY_NAME, MAX_BIO } from './clampText';

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
