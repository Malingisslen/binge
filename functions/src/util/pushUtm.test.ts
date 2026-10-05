import { describe, it, expect } from 'vitest';
import { withPushUtm } from './pushUtm';

describe('withPushUtm', () => {
  it('märker en relativ länk och behåller den relativ', () => {
    expect(withPushUtm('/movie/27205/', 'available-27205')).toBe(
      '/movie/27205/?utm_source=push&utm_medium=notis&utm_campaign=available',
    );
  });

  it('utelämnar kampanjen när notisen saknar tagg', () => {
    expect(withPushUtm('/savings/')).toBe('/savings/?utm_source=push&utm_medium=notis');
  });

  it('behåller befintlig query och hash', () => {
    expect(withPushUtm('/tv/1399/?season=2#avsnitt', 'episode-1399')).toBe(
      '/tv/1399/?season=2&utm_source=push&utm_medium=notis&utm_campaign=episode#avsnitt',
    );
  });

  it('märker en absolut binge.nu-länk och behåller den absolut', () => {
    expect(withPushUtm('https://binge.nu/feed/', 'friend')).toBe(
      'https://binge.nu/feed/?utm_source=push&utm_medium=notis&utm_campaign=friend',
    );
  });

  it('lämnar en extern länk orörd', () => {
    expect(withPushUtm('https://www.netflix.com/title/1', 'x')).toBe('https://www.netflix.com/title/1');
  });

  it('skriver inte över en källa som anroparen redan satt', () => {
    expect(withPushUtm('/feed/?utm_source=digest', 'weekly')).toBe('/feed/?utm_source=digest');
  });
});
