import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderChips, PosterProviderDots } from './WatchlistProviderDisplay';
import { getProvider } from '@/lib/tmdb/providers';

const HBO = 384;
const HBO_LEGACY = 1899;
const NETFLIX = 8;
const DISNEY = 337;
const SVT = 520;

describe('ProviderChips', () => {
  it('visar en tjänst en gång även när sparad data bär både id och alias', () => {
    render(<ProviderChips providers={[HBO, HBO_LEGACY, NETFLIX]} myProviders={[]} />);
    expect(screen.getAllByText(getProvider(HBO)!.shortName)).toHaveLength(1);
    expect(screen.getByText(getProvider(NETFLIX)!.shortName)).toBeTruthy();
  });

  it('låter inte en dubblett ta en av de tre platserna', () => {
    render(<ProviderChips providers={[HBO, HBO_LEGACY, NETFLIX, DISNEY, SVT]} myProviders={[]} />);
    for (const id of [HBO, NETFLIX, DISNEY]) expect(screen.getByText(getProvider(id)!.shortName)).toBeTruthy();
    expect(screen.queryByText(getProvider(SVT)!.shortName)).toBeNull();
  });

  it('räknar ett alias i mina tjänster som min tjänst', () => {
    render(<ProviderChips providers={[HBO_LEGACY]} myProviders={[HBO]} />);
    expect(screen.getByText(getProvider(HBO)!.shortName).className).toContain('border-acc-deep');
  });
});

describe('ProviderChips — Ej på SE', () => {
  const checked = new Date(2026, 9, 1);

  it('visas när TMDB inte gav någon tjänst', () => {
    render(<ProviderChips providers={[]} myProviders={[]} providersCheckedAt={checked} />);
    expect(screen.getByText('Ej på SE')).toBeTruthy();
  });

  it('visas inte innan tjänsterna kontrollerats', () => {
    const { container } = render(<ProviderChips providers={[]} myProviders={[]} providersCheckedAt={null} />);
    expect(container.textContent).toBe('');
  });

  it('visas inte när titeln bara finns på tjänster utanför vår tabell', () => {
    const AMAZON_VIDEO = 10;
    expect(getProvider(AMAZON_VIDEO)).toBeUndefined();
    const { container } = render(<ProviderChips providers={[AMAZON_VIDEO]} myProviders={[]} providersCheckedAt={checked} />);
    expect(container.textContent).toBe('');
  });

  it('låter inte ett okänt id ta en av de tre platserna', () => {
    render(<ProviderChips providers={[999_999, HBO, NETFLIX, DISNEY]} myProviders={[]} />);
    for (const id of [HBO, NETFLIX, DISNEY]) expect(screen.getByText(getProvider(id)!.shortName)).toBeTruthy();
  });
});

describe('PosterProviderDots', () => {
  it('ritar en prick per tjänst', () => {
    render(<PosterProviderDots providers={[HBO, HBO_LEGACY]} myProviders={[]} />);
    expect(screen.getAllByTitle(getProvider(HBO)!.name)).toHaveLength(1);
  });

  it('räknar ett alias i mina tjänster som min tjänst', () => {
    render(<PosterProviderDots providers={[HBO_LEGACY, NETFLIX]} myProviders={[HBO]} />);
    expect(screen.getByTitle(getProvider(HBO)!.name).className).not.toContain('opacity-50');
    expect(screen.getByTitle(getProvider(NETFLIX)!.name).className).toContain('opacity-50');
  });
});
