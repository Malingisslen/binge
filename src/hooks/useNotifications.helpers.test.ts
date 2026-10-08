import { describe, it, expect, vi } from 'vitest';
import { markOneRead, markManyRead } from './useNotifications.helpers';

// BIN-1170/BIN-1251. Tre egenskaper som bara ett test kan hålla:
//
// 1. "Markera alla som lästa" gick från en atomisk writeBatch till en skrivning
//    per notis. Det avgörande fallet är att EN avvisad skrivning inte tar de
//    andra med sig — en bunt där mitten faller ska ändå skriva första och sista.
// 2. En notis som redan är raderad ger `permission-denied` — MÄTT mot emulatorn,
//    se helparfilens huvudkommentar och regeltestet den namnger. Det ska inte
//    kastas vidare, eftersom anroparen inte väntar på svaret.
// 3. Men det ska RAPPORTERAS, under ett eget `kind` som går att skilja från
//    felvägens. Det är den halvan helhetsgranskningen fällde 2026-09-20: utan
//    den kunde en regelregression eller en utloggad session göra varje "markera
//    som läst" tyst medan klockan behöll sitt antal. Assertionerna nedan pinnar
//    alltså både ATT det rapporteras och UNDER VILKET namn — ett test som bara
//    kontrollerade att inget kastas hade varit grönt även utan rapporten.
//
// Predikatet som skiljer de två fallen är `isPermissionDenied` i `errorCodes.ts`;
// härled vilka andra test som rör det med `grep -rln "isPermissionDenied" src`.

const failWith = (code: string) => Object.assign(new Error(code), { code });

describe('markOneRead', () => {
  it('skriver notisen och rapporterar ingenting när skrivningen går igenom', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    await markOneRead(write, 'n1', report);
    expect(write).toHaveBeenCalledWith('n1');
    expect(report).not.toHaveBeenCalled();
  });

  it('kastar inte vidare när notisen redan är raderad', async () => {
    await expect(markOneRead(vi.fn().mockRejectedValue(failWith('permission-denied')), 'n1', vi.fn()))
      .resolves.toBeUndefined();
  });

  it('rapporterar ändå det godartade avvisandet, under ett eget kind', async () => {
    const report = vi.fn();
    const error = failWith('permission-denied');
    await markOneRead(vi.fn().mockRejectedValue(error), 'n1', report);
    expect(report).toHaveBeenCalledWith(error, 'markRead-refused');
  });

  it('rapporterar varje annat fel under felvägens kind, och kastar inte vidare', async () => {
    const report = vi.fn();
    const error = failWith('unavailable');
    await expect(markOneRead(vi.fn().mockRejectedValue(error), 'n1', report))
      .resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(error, 'markRead');
  });

  // Det fallet biljetten handlade om: före BIN-1251 svalde helparen `not-found`,
  // en kod den mätta skrivvägen aldrig ger. Ett `not-found` som ändå kommer är
  // alltså något annat än raderingskapplöpningen och hör till felvägen.
  it('behandlar not-found som ett vanligt fel — koden kapplöpningen inte ger', async () => {
    const report = vi.fn();
    const error = failWith('not-found');
    await markOneRead(vi.fn().mockRejectedValue(error), 'n1', report);
    expect(report).toHaveBeenCalledWith(error, 'markRead');
  });

  it('rapporterar ett fel utan kod under felvägens kind', async () => {
    const report = vi.fn();
    const error = new Error('nätverket dog');
    await markOneRead(vi.fn().mockRejectedValue(error), 'n1', report);
    expect(report).toHaveBeenCalledWith(error, 'markRead');
  });
});

// BIN-1254, avgjord som daterad post i `.claude/rules/accepted-deviations.md`.
describe('markOneRead — orsakerna bakom permission-denied skiljs inte åt (BIN-1254)', () => {
  it('en utloggad session och en raderad notis ger samma kind', async () => {
    const deleted = Object.assign(new Error('Null value error. for update'), { code: 'permission-denied' });
    const signedOut = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    const report = vi.fn();

    await markOneRead(vi.fn().mockRejectedValue(deleted), 'n1', report);
    await markOneRead(vi.fn().mockRejectedValue(signedOut), 'n2', report);

    expect(report).toHaveBeenNthCalledWith(1, deleted, 'markRead-refused');
    expect(report).toHaveBeenNthCalledWith(2, signedOut, 'markRead-refused');
  });
});

describe('markManyRead', () => {
  it('en avvisad skrivning stoppar inte de andra', async () => {
    const written: string[] = [];
    const write = vi.fn(async (id: string) => {
      if (id === 'n2') throw failWith('permission-denied');
      written.push(id);
    });

    await expect(markManyRead(write, ['n1', 'n2', 'n3'], vi.fn())).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(3);
    expect(written).toEqual(['n1', 'n3']);
  });

  it('skiljer de två kinden åt, en rad per avvisande', async () => {
    const offline = failWith('unavailable');
    const gone = failWith('permission-denied');
    const write = vi.fn(async (id: string) => {
      if (id === 'n2') throw offline;
      if (id === 'n3') throw gone;
    });
    const report = vi.fn();

    await markManyRead(write, ['n1', 'n2', 'n3'], report);

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(offline, 'markAllRead');
    expect(report).toHaveBeenCalledWith(gone, 'markAllRead-refused');
  });

  it('skriver ingenting för en tom lista', async () => {
    const write = vi.fn();
    await markManyRead(write, [], vi.fn());
    expect(write).not.toHaveBeenCalled();
  });
});
