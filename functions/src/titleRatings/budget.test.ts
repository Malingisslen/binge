import { describe, it, expect } from 'vitest';
import { evaluateOmdbBudget } from './budget';

const CAP = 900;
const ALERT = 720; // 80%

const base = { count: 0, alerted: false, capLogged: false };

describe('evaluateOmdbBudget', () => {
  it('allows and increments well below the alert threshold, no signals', () => {
    const d = evaluateOmdbBudget({ ...base, count: 10 }, CAP, ALERT);
    expect(d).toEqual({
      allowed: true, newCount: 11,
      fireAlert: false, setAlerted: false,
      fireCapLog: false, setCapLogged: false,
    });
  });

  it('fires the alert exactly when the new count first reaches the threshold', () => {
    // count 719 → newCount 720 == ALERT → fire (full match so a stray cap-log mutant dies)
    const d = evaluateOmdbBudget({ ...base, count: ALERT - 1 }, CAP, ALERT);
    expect(d).toEqual({
      allowed: true, newCount: ALERT,
      fireAlert: true, setAlerted: true,
      fireCapLog: false, setCapLogged: false,
    });
  });

  it('does NOT fire the alert again once alerted is set (once per day) and still increments', () => {
    const d = evaluateOmdbBudget({ count: ALERT + 50, alerted: true, capLogged: false }, CAP, ALERT);
    expect(d).toEqual({
      allowed: true, newCount: ALERT + 51, // still spends a slot
      fireAlert: false, setAlerted: false,
      fireCapLog: false, setCapLogged: false,
    });
  });

  it('one below threshold does not fire (newCount must reach threshold)', () => {
    // count 718 → newCount 719 < 720 → no alert
    const d = evaluateOmdbBudget({ ...base, count: ALERT - 2 }, CAP, ALERT);
    expect(d).toEqual({
      allowed: true, newCount: ALERT - 1,
      fireAlert: false, setAlerted: false,
      fireCapLog: false, setCapLogged: false,
    });
  });

  it('blocks at the cap, spends no slot, logs once, never fires the alert branch', () => {
    const d = evaluateOmdbBudget({ count: CAP, alerted: true, capLogged: false }, CAP, ALERT);
    expect(d).toEqual({
      allowed: false, newCount: CAP, // unchanged — no slot spent
      fireAlert: false, setAlerted: false,
      fireCapLog: true, setCapLogged: true,
    });
  });

  it('logs the hard cap once even when count has overshot the cap (capLogged still false)', () => {
    const d = evaluateOmdbBudget({ count: CAP + 5, alerted: true, capLogged: false }, CAP, ALERT);
    expect(d).toEqual({
      allowed: false, newCount: CAP + 5,
      fireAlert: false, setAlerted: false,
      fireCapLog: true, setCapLogged: true,
    });
  });

  it('does NOT re-log the hard cap once capLogged is set', () => {
    const d = evaluateOmdbBudget({ count: CAP + 5, alerted: true, capLogged: true }, CAP, ALERT);
    expect(d).toEqual({
      allowed: false, newCount: CAP + 5,
      fireAlert: false, setAlerted: false,
      fireCapLog: false, setCapLogged: false,
    });
  });

  it('the call that lands exactly on the cap is still allowed (count==cap-1 → newCount==cap), alert suppressed by flag', () => {
    // newCount == CAP == 900 >= ALERT, but alerted:true → fireAlert must stay false
    const d = evaluateOmdbBudget({ count: CAP - 1, alerted: true, capLogged: false }, CAP, ALERT);
    expect(d).toEqual({
      allowed: true, newCount: CAP,
      fireAlert: false, setAlerted: false,
      fireCapLog: false, setCapLogged: false,
    });
  });
});
