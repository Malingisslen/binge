import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Anropsplatsen är det som ger TV-översikten dess skydd, inte bara predikaten i logic.ts. Reglerna
 * gäller inte här (Admin SDK), så varje kontroll som reglerna annars gör ska stå kvar i funktionen.
 */
const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('tvOverview anropsplats', () => {
  it('kräver App Check', () => expect(src).toContain('enforceAppCheck: true'));
  it('kräver tv-claim och binder uid till enheten', () => {
    expect(src).toContain('token?.tv !== true');
    expect(src).toContain('request.auth.uid !== `tv_${deviceId}`');
  });
  it('läser ägaren ur token och aldrig ur indata', () => {
    expect(src).toContain('token?.ownerUid');
    expect(src).not.toMatch(/data\.(ownerUid|uid|groupId)/);
  });
  it('kontrollerar enhetens rad före allt annat arbete, och begränsar per enhet', () => {
    expect(src.indexOf('tvDevices/${deviceId}')).toBeGreaterThan(-1);
    expect(src.indexOf('tvDevices/${deviceId}')).toBeLessThan(src.indexOf('takeRate('));
    expect(src.indexOf('takeRate(')).toBeLessThan(src.indexOf("db.doc(`users/${ownerUid}`)"));
  });
  it('en bortkopplad TV avvisas, inte bara slås upp', () => {
    expect(src).toContain("if (!device.exists) throw new HttpsError('permission-denied'");
  });
  it('ägaren måste fortfarande vara medlem i gruppen', () => expect(src).toContain('if (!memberUids.includes(ownerUid)) continue;'));
  it('en sessionsfråga som kastar (indexet byggs) tar inte ner tjänsterna', () => {
    expect(src).toContain('sessions query failed');
    expect(src).toContain('const live = sessions?.docs.find(');
  });
  it('watchlist-frågan använder den testade statuslistan', () => {
    expect(src).toContain("where('status', 'in', [...OPEN_RAW_STATUSES])");
  });
  it('hushållsvyn kräver flaggan på servern', () => expect(src).toContain("flag?.get('enabled') === true"));
  it('en flagg- eller grupp-läsning som felar tar inte ner tjänsterna och ger ingen hushållsvy', () => {
    expect(src).toContain("db.doc('appConfig/tvHousehold').get().catch(() => null)");
    expect(src).toContain(".limit(10).get().catch(() => null)");
    expect(src).toContain('groups?.docs ?? []');
  });
  it('varje watchlist-rad går genom toWatchItem och bara soffvalda listor läses', () => {
    expect(src).toContain('toWatchItem(d.data())');
    expect(src).toContain('wanted.map');
    expect(src).toContain('const roster = rosterOf(uids);');
    expect(src).toContain("typeof data.roster === 'string' ? data.roster : null");
  });
  it('platser och medlemmar avgörs av de testade hjälparna, inte av egen kod i anropet', () => {
    expect(src).toContain('resolveSeating(clientRoster, roster, requestedSeated, uids.length)');
    expect(src).toContain('householdUids(ownerUid, memberUids, sharingUidsOf(rows))');
    expect(src).toContain('if (!ownRow.exists) continue;');
    expect(src).toContain('wanted.map');
  });
  it('loggar varken uid, namn eller titlar', () => {
    expect(src.indexOf("logger.info('[tvOverview]'")).toBeGreaterThan(-1);
    const log = src.slice(src.indexOf("logger.info('[tvOverview]'"));
    expect(log.slice(0, log.indexOf(');'))).not.toMatch(/uid|deviceId|name|title/i);
  });
});
