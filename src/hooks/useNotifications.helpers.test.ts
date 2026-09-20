import { describe, it, expect, vi } from 'vitest';
import { isBenignWriteFailure, markOneRead, markManyRead } from './useNotifications.helpers';

// BIN-1170. Två egenskaper som bara ett test kan hålla:
//
// 1. "Markera alla som lästa" gick från en atomisk writeBatch till en skrivning
//    per notis. Det avgörande fallet är att EN avvisad skrivning inte tar de
//    andra med sig — en bunt där mitten faller ska ändå skriva första och sista.
// 2. En notis som redan är raderad ger `not-found`, och det ska inte larmas om;
//    varje annat fel ska larmas om, eftersom anroparen inte väntar på svaret.

const failWith = (code: string) => Object.assign(new Error(code), { code });

describe('isBenignWriteFailure', () => {
  it('bara not-found är benignt', () => {
    expect(isBenignWriteFailure(failWith('not-found'))).toBe(true);
    expect(isBenignWriteFailure(failWith('permission-denied'))).toBe(false);
    expect(isBenignWriteFailure(new Error('nätverket dog'))).toBe(false);
    expect(isBenignWriteFailure(null)).toBe(false);
  });
});

describe('markOneRead', () => {
  it('skriver notisen och rapporterar ingenting när skrivningen går igenom', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn();
    await markOneRead(write, 'n1', report);
    expect(write).toHaveBeenCalledWith('n1');
    expect(report).not.toHaveBeenCalled();
  });

  it('tiger om en notis som redan är raderad', async () => {
    const report = vi.fn();
    await expect(markOneRead(vi.fn().mockRejectedValue(failWith('not-found')), 'n1', report))
      .resolves.toBeUndefined();
    expect(report).not.toHaveBeenCalled();
  });

  it('rapporterar varje annat fel, och kastar inte vidare', async () => {
    const report = vi.fn();
    const error = failWith('permission-denied');
    await expect(markOneRead(vi.fn().mockRejectedValue(error), 'n1', report))
      .resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(error, 'markRead');
  });
});

describe('markManyRead', () => {
  it('en avvisad skrivning stoppar inte de andra', async () => {
    const written: string[] = [];
    const write = vi.fn(async (id: string) => {
      if (id === 'n2') throw failWith('not-found');
      written.push(id);
    });
    const report = vi.fn();

    await expect(markManyRead(write, ['n1', 'n2', 'n3'], report)).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(3);
    expect(written).toEqual(['n1', 'n3']);
    expect(report).not.toHaveBeenCalled();
  });

  it('rapporterar de fel som inte är not-found, ett per rad', async () => {
    const denied = failWith('permission-denied');
    const write = vi.fn(async (id: string) => {
      if (id === 'n2') throw denied;
      if (id === 'n3') throw failWith('not-found');
    });
    const report = vi.fn();

    await markManyRead(write, ['n1', 'n2', 'n3'], report);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(denied, 'markAllRead');
  });

  it('skriver ingenting för en tom lista', async () => {
    const write = vi.fn();
    await markManyRead(write, [], vi.fn());
    expect(write).not.toHaveBeenCalled();
  });
});
