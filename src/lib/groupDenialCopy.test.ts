import { describe, it, expect } from 'vitest';
import {
  inviteAcceptToast,
  inviteRowNotice,
  inviteBlocksRetry,
  joinLinkMessage,
  joinAttemptFailed,
  blockedReason,
  inviteStamp,
} from './groupDenialCopy';

// BIN-1166. Flera ytor valde var for sig vad en anvandare far lasa nar ett
// gruppmedlemskap nekas, utan testfil — vilket ar samma tystnad
// biljetten finns for att stanga: ett textval gar att byta tillbaka utan att nagot
// faller. Valet ar nu en ren modul, och det har ar dess prov.
//
// Det som provas ar SKILLNADERNA, inte lydelserna: att tva utfall med olika atgard
// aldrig far samma text, och att inget utfall dar ett omforsok kan lyckas laser
// knappen. Testerna hanger darfor inte pa exakta strangar mer an de maste.

describe('inviteAcceptToast', () => {
  it('sager ingenting nar det gick bra', () => {
    expect(inviteAcceptToast({ ok: true })).toBeNull();
  });

  it('ger tre OLIKA texter for tre utfall', () => {
    const transient = inviteAcceptToast({ ok: false, reason: 'transient' });
    const invalid = inviteAcceptToast({ ok: false, reason: 'invite_invalid' });
    const refused = inviteAcceptToast({ ok: false, reason: 'refused' });
    expect(new Set([transient, invalid, refused]).size).toBe(3);
    for (const t of [transient, invalid, refused]) expect(t).toBeTruthy();
  });

  // De tva nekandena har olika atgard: en inbjudan som inte haller lagas av en ny
  // inbjudan och av ingenting annat, medan ett schemanekande mycket val kan ga over
  // vid en omladdning. Att ge dem samma rad ar felskyllningen biljetten tar bort.
  it('skickar bara den ogiltiga inbjudan till agaren, och bara nekandet till en omladdning', () => {
    expect(inviteAcceptToast({ ok: false, reason: 'invite_invalid' })).toContain('ägaren');
    expect(inviteAcceptToast({ ok: false, reason: 'invite_invalid' })).not.toContain('Ladda om');
    expect(inviteAcceptToast({ ok: false, reason: 'refused' })).toContain('Ladda om');
  });

  // Ingen text far peka ut en ORSAK: servern sager inte vilken klausul som fallde.
  it('gissar aldrig pa en orsak', () => {
    for (const reason of ['transient', 'invite_invalid', 'refused'] as const) {
      const t = inviteAcceptToast({ ok: false, reason })!;
      expect(t.toLowerCase()).not.toContain('namn');
      expect(t.toLowerCase()).not.toContain('uppkoppling');
      expect(t.toLowerCase()).not.toContain('behörighet');
    }
  });
});

describe('inviteBlocksRetry', () => {
  // Det avgorande: ett tillfalligt fel far INTE lasa knappen, for det ar just dar ett
  // omforsok kan lyckas. De andra tva ar deterministiska och ska lamna ett spar.
  it('laser inte raden for ett tillfalligt fel', () => {
    expect(inviteBlocksRetry({ ok: false, reason: 'transient' })).toBeNull();
    expect(inviteBlocksRetry({ ok: true })).toBeNull();
  });

  it('laser raden for bada de deterministiska nekandena, och bar ORSAKEN vidare', () => {
    expect(inviteBlocksRetry({ ok: false, reason: 'invite_invalid' })).toBe('invite_invalid');
    expect(inviteBlocksRetry({ ok: false, reason: 'refused' })).toBe('refused');
  });
});

describe('inviteRowNotice', () => {
  it('ger ingen notis pa en orord rad', () => {
    expect(inviteRowNotice(null)).toBeNull();
  });

  it('ger olika kvarstaende text for de tva nekandena', () => {
    const invalid = inviteRowNotice('invite_invalid');
    const refused = inviteRowNotice('refused');
    expect(invalid).toBeTruthy();
    expect(refused).toBeTruthy();
    expect(invalid).not.toBe(refused);
  });

  // Den kvarstaende raden far inte saga emot toasten fran samma klick. Det var ett
  // blockerande fynd i granskningen: en gemensam text rekommenderade en omladdning
  // aven for en inbjudan som inte langre finns.
  it('rader inte till omladdning for en inbjudan som inte langre haller', () => {
    expect(inviteRowNotice('invite_invalid')).not.toContain('Ladda om');
    expect(inviteRowNotice('refused')).toContain('Ladda om');
  });
});

describe('joinLinkMessage', () => {
  it('sager ingenting nar man kom in', () => {
    expect(joinLinkMessage({ ok: true }, false)).toBeNull();
    expect(joinLinkMessage({ ok: true }, true)).toBeNull();
  });

  // Bara det tillfalliga utfallet bryr sig om hur manga forsok som ar kvar.
  it('skiljer pa "forsoker igen" och "forsoken ar slut" for ett tillfalligt fel', () => {
    const more = joinLinkMessage({ ok: false, reason: 'transient' }, false);
    const done = joinLinkMessage({ ok: false, reason: 'transient' }, true);
    expect(more).not.toBe(done);
    expect(more).toContain('Försöker igen');
  });

  it('ger fyra olika texter for de fyra terminala utfallen', () => {
    const texts = (['invalid_token', 'not_found', 'refused', 'already_member'] as const)
      .map(reason => joinLinkMessage({ ok: false, reason }, true));
    expect(new Set(texts).size).toBe(4);
  });

  // `refused` far INTE ateranvanda token-texten: den bar en annan och riktig betydelse
  // — en token som roterats eller dragits tillbaka — och skulle skicka anvandaren till
  // agaren for att be om en ny lank, vilket inte ar det som saknas.
  it('ateranvander inte token-texten for ett schemanekande', () => {
    const token = joinLinkMessage({ ok: false, reason: 'invalid_token' }, true)!;
    const refused = joinLinkMessage({ ok: false, reason: 'refused' }, true)!;
    expect(refused).not.toBe(token);
    expect(token).toContain('länken');
    expect(refused).not.toContain('länken');
  });

  // Flaggan ar BARA transientens sak. Ett loop-test som bara kraver att varje cell ar
  // icke-tom sager ingenting om det: en gren som borjar lasa flaggan star kvar gron.
  // Det som pinnar pastaendet ar att JAMFORA de tva cellerna per gren.
  it('bara den tillfalliga grenen laser attemptsExhausted', () => {
    for (const reason of ['invalid_token', 'not_found', 'refused', 'already_member'] as const) {
      const a = joinLinkMessage({ ok: false, reason }, true);
      const b = joinLinkMessage({ ok: false, reason }, false);
      expect(a).toBeTruthy();
      expect(a).toBe(b);
    }
    expect(joinLinkMessage({ ok: false, reason: 'transient' }, true))
      .not.toBe(joinLinkMessage({ ok: false, reason: 'transient' }, false));
  });
});

describe('joinAttemptFailed', () => {
  // Utan den har skillnaden hade sidans rubrik sagt att forsoket foll, rakt ovanfor en
  // ruta som sager att man redan ar medlem.
  it('raknar inte "redan medlem" som ett misslyckande', () => {
    expect(joinAttemptFailed({ ok: false, reason: 'already_member' })).toBe(false);
    expect(joinAttemptFailed({ ok: true })).toBe(false);
  });

  it('raknar varje annat nekande som ett misslyckande', () => {
    for (const reason of ['invalid_token', 'not_found', 'refused', 'transient'] as const) {
      expect(joinAttemptFailed({ ok: false, reason })).toBe(true);
    }
  });
});

describe('blockedReason', () => {
  const at = (ms: number) => new Date(ms);

  it('ger ingen sparr for en grupp som aldrig nekats', () => {
    expect(blockedReason(new Map(), { groupId: 'g1', invitedAt: at(1000) })).toBeNull();
  });

  it('sparrar den inbjudan som faktiskt nekades', () => {
    const blocked = new Map([['g1', { reason: 'refused' as const, at: 1000 }]]);
    expect(blockedReason(blocked, { groupId: 'g1', invitedAt: at(1000) })).toBe('refused');
  });

  // DET BARANDE FALLET, och det koden inte gjorde forst: listkomponenten avmonteras
  // aldrig, sa en sparr som bara kandes pa groupId hade last raden for resten av
  // sessionen — ocksa mot en inbjudan agaren just gjort om och som ar fullt giltig.
  // Kommentaren pastod att en ny inbjudan lakte det; utan det har testet gjorde den inte det.
  it('slapper raden nar agaren bjudit in pa nytt', () => {
    const blocked = new Map([['g1', { reason: 'invite_invalid' as const, at: 1000 }]]);
    expect(blockedReason(blocked, { groupId: 'g1', invitedAt: at(2000) })).toBeNull();
  });

  it('blandar inte ihop tva grupper', () => {
    const blocked = new Map([['g1', { reason: 'refused' as const, at: 1000 }]]);
    expect(blockedReason(blocked, { groupId: 'g2', invitedAt: at(1000) })).toBeNull();
  });

  // Skillnaden mellan `!==` och `<`. Varje annan fixtur har en NYARE inbjudan an den
  // sparrade, och dar svarar de tva operatorerna likadant — sa utan det har fallet
  // gick `!==` att byta mot `<` med hela sviten gron. Kontraktet ar "samma stampel =
  // sparrad", inte "aldre stampel = sparrad".
  it('slapper raden ocksa nar stampeln gatt BAKAT', () => {
    const blocked = new Map([['g1', { reason: 'refused' as const, at: 2000 }]]);
    expect(blockedReason(blocked, { groupId: 'g1', invitedAt: at(1000) })).toBeNull();
  });

  // DOKUMENTERAR EN FORSVARSGREN, inte ett fall som gar att na i dag: `GroupInvite`
  // typar `invitedAt` som `Date`, och `toDate()` faller tillbaka pa `new Date()` i
  // stallet for null, sa ingen kod i appen skickar hit ett saknat varde. Testet star
  // for den dag ett dokument skrivet utanfor appen gor det — rakna det inte som bevis
  // for att verkliga inbjudningar utan stampel hanteras.
  it('behandlar en saknad tidsstampel som noll pa bada sidor', () => {
    expect(inviteStamp({ invitedAt: null })).toBe(0);
    const blocked = new Map([['g1', { reason: 'refused' as const, at: 0 }]]);
    expect(blockedReason(blocked, { groupId: 'g1', invitedAt: null })).toBe('refused');
  });
});
