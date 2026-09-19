// BIN-1233. Profilsidan slår upp användare på användarnamn, så admin-vyns länk till en
// anmäld användare måste bära användarnamnet — en uid-länk öppnar "Användaren hittades
// inte" för ett konto som finns.
import { describe, it, expect } from 'vitest';
import { buildTargetLink, linkableUsername, reportedProfileNotice } from './reportTargetLink';

describe('buildTargetLink (BIN-1233)', () => {
  it('en användaranmälan leder till profilen på användarnamnet, aldrig på uid:t', () => {
    expect(buildTargetLink({ targetType: 'user', targetId: 'uid-123' }, 'kalle')).toBe('/user/kalle');
  });

  it('en användaranmälan utan läsbart användarnamn får ingen länk alls', () => {
    expect(buildTargetLink({ targetType: 'user', targetId: 'uid-123' }, null)).toBeNull();
  });

  it('en listanmälan leder till listan på sitt id, oberoende av användarnamn', () => {
    expect(buildTargetLink({ targetType: 'list', targetId: 'l1' }, null)).toBe('/list/l1');
  });

  it('recensioner och kommentarer har ingen direktlänk', () => {
    expect(buildTargetLink({ targetType: 'review', targetId: 'r1' }, 'kalle')).toBeNull();
    expect(buildTargetLink({ targetType: 'comment', targetId: 'reviews/r1/comments/c1' }, 'kalle')).toBeNull();
  });
});

describe('linkableUsername (BIN-1244)', () => {
  it('a public profile links on its username', () => {
    expect(linkableUsername({ username: 'kim', isPublic: true })).toBe('kim');
  });
  it('a private profile gets no link, even with a username', () => {
    expect(linkableUsername({ username: 'kim', isPublic: false })).toBeNull();
  });
  it('no profile, or no username, gets no link', () => {
    expect(linkableUsername(null)).toBeNull();
    expect(linkableUsername({ username: null, isPublic: true })).toBeNull();
  });
});

describe('reportedProfileNotice (BIN-1239)', () => {
  const failed = { isError: true, isSuccess: false, data: undefined };
  const loading = { isError: false, isSuccess: false, data: undefined };
  const found = { isError: false, isSuccess: true, data: { username: 'kim' } };
  const none = { isError: false, isSuccess: true, data: null };

  it('a review or comment report never shows a profile note, even if a lookup errored', () => {
    expect(reportedProfileNotice(null, failed)).toBeNull();
    expect(reportedProfileNotice(null, none)).toBeNull();
  });
  it('a failed lookup for a user report is retryable', () => {
    expect(reportedProfileNotice('u1', failed)).toBe('lookup-failed');
  });
  it('a lookup that found no profile document says the profile is missing', () => {
    expect(reportedProfileNotice('u1', none)).toBe('missing');
  });
  it('a found profile, or a lookup still loading, shows no note', () => {
    expect(reportedProfileNotice('u1', found)).toBeNull();
    expect(reportedProfileNotice('u1', loading)).toBeNull();
  });
});
