import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNTED_EVENTS, FLUSH_INTERVAL_MS, MAX_EVENTS_PER_CALL, type AnalyticsEvent } from './analytics';
// functions/ har en egen tsconfig och kan inte importera klientkoden, så klientens lista är
// en kopia. Att importera BÅDA i samma test är det som ser dem glida isär (samma teknik som
// mediaTypeDocId.parity.test.ts).
import {
  EVENT_VOCABULARY, COUNTED_EVENT_NAMES, MAX_EVENTS_PER_CALL as SERVER_MAX_EVENTS,
} from '../../functions/src/eventStats/logic';

/**
 * BIN-1438 — klientens COUNTED_EVENTS och serverns ordförråd måste vara samma mängd.
 * Står ett namn bara i klienten skickas anrop som servern släpper (kostnad utan räkning);
 * står det bara på servern räknas det aldrig.
 */
describe('COUNTED_EVENTS ↔ recordEvents ordförråd', () => {
  it('samma händelsenamn på båda sidor', () => {
    expect([...COUNTED_EVENTS].sort()).toEqual([...COUNTED_EVENT_NAMES].sort());
    expect(COUNTED_EVENTS.length).toBeGreaterThan(0);
  });

  it('varje räknad händelse finns i AnalyticsEvent-unionen (typnivå)', () => {
    expectTypeOf<(typeof COUNTED_EVENTS)[number]>().toExtend<AnalyticsEvent['name']>();
    expectTypeOf<keyof typeof EVENT_VOCABULARY>().toExtend<AnalyticsEvent['name']>();
  });

  it('varje räknad händelse finns som namn i AnalyticsEvent-unionen i källkoden', () => {
    // Härleds ur unionens egen deklaration, inte ur en handräknad lista.
    const src = readFileSync(join(__dirname, 'analytics.ts'), 'utf8');
    const decl = src.slice(src.indexOf('export type AnalyticsEvent'), src.indexOf('export const COUNTED_EVENTS'));
    const unionNames = new Set([...decl.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]));
    expect(unionNames.size).toBeGreaterThan(COUNTED_EVENTS.length); // mätningen läste unionen
    for (const name of COUNTED_EVENT_NAMES) expect(unionNames.has(name), name).toBe(true);
  });

  it('varje egenskap i ordförrådet finns i motsvarande unionsmedlems props', () => {
    // Typnivå per händelse: en egenskap servern räknar men klienten aldrig skickar är död.
    type PropsOf<N extends AnalyticsEvent['name']> = NonNullable<Extract<AnalyticsEvent, { name: N }>['props']>;
    expectTypeOf<'method'>().toExtend<keyof PropsOf<'signed_in'>>();
    expectTypeOf<'step_reached'>().toExtend<keyof PropsOf<'onboarding_completed'>>();
    expectTypeOf<'action'>().toExtend<keyof PropsOf<'advisor_action_taken'>>();
    expectTypeOf<'offerType'>().toExtend<keyof PropsOf<'provider_clicked'>>();
    expectTypeOf<'surface' | 'method'>().toExtend<keyof PropsOf<'share_clicked'>>();
    expectTypeOf<'surface'>().toExtend<keyof PropsOf<'price_check_total_shown'>>();
    // Körtidskontroll att listan ovan täcker ordförrådet: varje (händelse, egenskap)-par.
    const pairs = Object.entries(EVENT_VOCABULARY).flatMap(([e, props]) => Object.keys(props).map((p) => `${e}.${p}`));
    expect(pairs.sort()).toEqual([
      'advisor_action_taken.action',
      'onboarding_completed.step_reached',
      'price_check_total_shown.surface',
      'provider_clicked.offerType',
      'share_clicked.method',
      'share_clicked.surface',
      'signed_in.method',
    ]);
  });

  it('klientens tillåtna värden är samma som serverns, per (händelse, egenskap) (typnivå)', () => {
    type PropsOf<N extends AnalyticsEvent['name']> = NonNullable<Extract<AnalyticsEvent, { name: N }>['props']>;
    type V = typeof EVENT_VOCABULARY;
    expectTypeOf<NonNullable<PropsOf<'signed_in'>['method']>>().toEqualTypeOf<V['signed_in']['method'][number]>();
    expectTypeOf<NonNullable<PropsOf<'advisor_action_taken'>['action']>>().toEqualTypeOf<V['advisor_action_taken']['action'][number]>();
    expectTypeOf<NonNullable<PropsOf<'provider_clicked'>['offerType']>>().toEqualTypeOf<V['provider_clicked']['offerType'][number]>();
    expectTypeOf<NonNullable<PropsOf<'share_clicked'>['surface']>>().toEqualTypeOf<V['share_clicked']['surface'][number]>();
    expectTypeOf<NonNullable<PropsOf<'share_clicked'>['method']>>().toEqualTypeOf<V['share_clicked']['method'][number]>();
    expectTypeOf<NonNullable<PropsOf<'price_check_total_shown'>['surface']>>().toEqualTypeOf<V['price_check_total_shown']['surface'][number]>();
  });

  it('klientens batch ryms i serverns tak, och utskicken är minst 30 s isär (villkor D)', () => {
    expect(MAX_EVENTS_PER_CALL).toBeLessThanOrEqual(SERVER_MAX_EVENTS);
    expect(FLUSH_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });
});
