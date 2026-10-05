import { describe, it, expect } from 'vitest';
import { shareLink } from './shareLink';

describe('shareLink', () => {
  it('märker en titelsida med källa och yta', () => {
    expect(shareLink('https://binge.nu', '/movie/27205/', 'title')).toBe(
      'https://binge.nu/movie/27205/?utm_source=share&utm_medium=title',
    );
  });

  it('släpper sidans egen query och hash på vägen in', () => {
    expect(shareLink('https://binge.nu', '/user/malin/', 'profile')).toBe(
      'https://binge.nu/user/malin/?utm_source=share&utm_medium=profile',
    );
  });

  it('ersätter en tidigare märkning i stället för att stapla den', () => {
    expect(shareLink('https://binge.nu', '/list/abc/?utm_source=share&utm_medium=title', 'list')).toBe(
      'https://binge.nu/list/abc/?utm_source=share&utm_medium=list',
    );
  });
});
