import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planIncrements, allPossiblePaths, buildIncrementPayload, EVENT_VOCABULARY, COUNTED_EVENT_NAMES,
  MAX_EVENTS_PER_CALL, type Increment,
} from './logic';

const asMap = (incs: Increment[]) => new Map(incs.map((i) => [i.path.join('/'), i.delta]));

describe('planIncrements — godkända händelser blir summerade ökningar', () => {
  it('räknar namnet och varje tillåten egenskap', () => {
    const m = asMap(planIncrements({
      events: [
        { name: 'share_clicked', props: { surface: 'title', method: 'native' } },
        { name: 'share_clicked', props: { surface: 'title', method: 'copy' } },
        { name: 'provider_clicked', props: { providerId: 8, offerType: 'rent', mediaType: 'movie' } },
      ],
    }));
    expect(m.get('counts/share_clicked')).toBe(2);
    expect(m.get('props/share_clicked/surface/title')).toBe(2);
    expect(m.get('props/share_clicked/method/native')).toBe(1);
    expect(m.get('props/share_clicked/method/copy')).toBe(1);
    expect(m.get('counts/provider_clicked')).toBe(1);
    expect(m.get('props/provider_clicked/offerType/rent')).toBe(1);
    // providerId och mediaType hör inte till ordförrådet för provider_clicked.
    expect([...m.keys()].some((k) => k.includes('providerId') || k.includes('mediaType'))).toBe(false);
  });

  it('step_reached blir nyckeln för heltalet 1–5 och inget annat', () => {
    const m = asMap(planIncrements({
      events: [1, 5, 0, 6, 2.5, '3', -1].map((step) => ({ name: 'onboarding_completed', props: { step_reached: step } })),
    }));
    expect(m.get('counts/onboarding_completed')).toBe(7);
    expect(m.get('props/onboarding_completed/step_reached/1')).toBe(1);
    expect(m.get('props/onboarding_completed/step_reached/5')).toBe(1);
    const stepKeys = [...m.keys()].filter((k) => k.startsWith('props/onboarding_completed/'));
    expect(stepKeys.sort()).toEqual([
      'props/onboarding_completed/step_reached/1',
      'props/onboarding_completed/step_reached/5',
    ]);
  });

  it('en händelse utan egenskaper i ordförrådet räknas bara som antal', () => {
    const m = asMap(planIncrements({ events: [{ name: 'title_added_watchlist', props: { mediaType: 'tv', status: 'mina' } }] }));
    expect([...m.entries()]).toEqual([['counts/title_added_watchlist', 1]]);
  });

  it('läser högst MAX_EVENTS_PER_CALL händelser ur ett anrop', () => {
    const events = Array.from({ length: MAX_EVENTS_PER_CALL + 25 }, () => ({ name: 'signed_up' }));
    expect(asMap(planIncrements({ events })).get('counts/signed_up')).toBe(MAX_EVENTS_PER_CALL);
  });

  it('ger tom plan när inget överlever, så att index.ts inte skriver', () => {
    expect(planIncrements(null)).toEqual([]);
    expect(planIncrements('x')).toEqual([]);
    expect(planIncrements({})).toEqual([]);
    expect(planIncrements({ events: 'nope' })).toEqual([]);
    expect(planIncrements({ events: [{ name: 'search_submitted', props: { resultCount: 3 } }] })).toEqual([]);
  });
});

describe('planIncrements — fientlig last kan inte skapa nycklar utanför ordförrådet', () => {
  const allowed = new Set(allPossiblePaths().map((p) => p.join('/')));
  const long = 'x'.repeat(41);

  const hostile = {
    uid: 'attacker-uid',
    events: [
      { name: '__proto__', props: { polluted: 'yes' } },
      { name: 'constructor' },
      { name: 'toString' },
      { name: 'signed_in.method' },
      { name: 'counts' },
      { name: long },
      { name: 42 },
      null,
      'signed_up',
      ['signed_up'],
      { name: 'signed_in', props: { method: 'github' } },
      { name: 'signed_in', props: { method: { toString: 'google' } } },
      { name: 'signed_in', props: { 'method.google': 'google', __proto__: { method: 'email' } } },
      { name: 'signed_in', props: JSON.parse('{"__proto__": {"method": "email"}, "constructor": "google"}') },
      { name: 'signed_in', props: { method: 'google', uid: 'victim-uid', email: 'a@b.se' } },
      { name: 'provider_clicked', props: { offerType: 'subscription.evil', providerId: 8 } },
      { name: 'provider_clicked', props: { offerType: 7 } },
      { name: 'share_clicked', props: { surface: long, method: '__proto__' } },
      { name: 'advisor_action_taken', props: { action: 'pause', providerId: 337 } },
      { name: 'onboarding_completed', props: { step_reached: 1e9 } },
      { name: 'onboarding_completed', props: { step_reached: Number.NaN } },
      { name: 'price_check_total_shown', props: { surface: 'home', paidCount: 4 } },
    ],
  };

  it('varje skapad sökväg finns bland de sökvägar ordförrådet kan skapa', () => {
    const incs = planIncrements(hostile);
    expect(incs.length).toBeGreaterThan(0); // pinnar det positiva utfallet: de giltiga delarna räknades
    for (const inc of incs) expect(allowed.has(inc.path.join('/')), inc.path.join('/')).toBe(true);
    const m = asMap(incs);
    expect(m.get('counts/signed_in')).toBe(5);
    expect(m.get('props/signed_in/method/google')).toBe(1);
    expect(m.get('props/advisor_action_taken/action/pause')).toBe(1);
    expect(m.get('props/price_check_total_shown/surface/home')).toBe(1);
  });

  it('inget om uid, e-post eller andra identifierare hamnar i den skrivna lasten', () => {
    const written = JSON.stringify(planIncrements(hostile));
    for (const needle of ['uid', 'attacker', 'victim', 'email', '@', 'providerId', '337']) {
      expect(written).not.toContain(needle);
    }
    expect(written).toContain('signed_in'); // mätningen läser verkligen lasten
  });

  it('prototypen förblir orörd', () => {
    planIncrements(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).method).toBeUndefined();
  });
});

describe('dagdokumentets storlek i värsta fall', () => {
  it('ordförrådet ger ett fältantal långt under Firestores tak på 20 000 indexposter', () => {
    const paths = allPossiblePaths();
    // Bladen plus varje mellanliggande map räknas som fält.
    const fields = new Set<string>();
    for (const p of paths) for (let i = 1; i <= p.length; i++) fields.add(p.slice(0, i).join('/'));
    expect(fields.size).toBeGreaterThan(COUNTED_EVENT_NAMES.length); // inte en tom mätning
    expect(fields.size).toBeLessThan(200);
  });

  it('allPossiblePaths speglar ordförrådets händelser', () => {
    const counted = allPossiblePaths().filter((p) => p[0] === 'counts').map((p) => p[1]);
    expect(counted.sort()).toEqual(Object.keys(EVENT_VOCABULARY).sort());
  });
});

describe('index.ts läser aldrig identitet (källkodsskanning)', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    // kommentarer får beskriva vad funktionen inte gör
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('läser bara request.data och har grinden påslagen', () => {
    expect(src).toContain('request.data');
    expect(src).toMatch(/enforceAppCheck:\s*true/);
    expect(src).toMatch(/maxInstances:\s*5/);
    expect(src).toMatch(/region:\s*'europe-west1'/);
  });

  it.each(['request.auth', 'rawRequest', '.auth', 'logger', 'console.', 'headers', 'ip'])(
    'innehåller inte %s',
    (needle) => {
      if (needle === 'ip') expect(src).not.toMatch(/\bip\b/i);
      else expect(src).not.toContain(needle);
    },
  );
});

describe('buildIncrementPayload — dokumentet som faktiskt skrivs', () => {
  it('flera händelser och värden under samma map behålls alla', () => {
    const incs = planIncrements({
      events: [
        { name: 'share_clicked', props: { surface: 'title', method: 'native' } },
        { name: 'share_clicked', props: { surface: 'profile', method: 'native' } },
        { name: 'price_check_save_clicked' },
      ],
    });
    const payload = buildIncrementPayload(incs, (d) => ({ inc: d }));
    expect(payload).toEqual({
      counts: { share_clicked: { inc: 2 }, price_check_save_clicked: { inc: 1 } },
      props: {
        share_clicked: {
          surface: { title: { inc: 1 }, profile: { inc: 1 } },
          method: { native: { inc: 2 } },
        },
      },
    });
  });

  it('tom lista ger tomt dokument', () => {
    expect(buildIncrementPayload([], (d) => d)).toEqual({});
  });
});
