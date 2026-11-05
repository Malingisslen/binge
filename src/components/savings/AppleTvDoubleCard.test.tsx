import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppleTvDoubleCard from './AppleTvDoubleCard';

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));

describe('AppleTvDoubleCard', () => {
  it('visar rådet när Apple TV+ ingår i Viaplay-paketet', () => {
    auth.user = { myProviders: [76, 350], providerTiers: { 76: 'total-appletv' } };
    render(<AppleTvDoubleCard />);
    expect(screen.getByText('Du betalar Apple TV två gånger')).toBeInTheDocument();
    expect(screen.getByText(/sparar du 119 kr\/mån/)).toBeInTheDocument();
  });
  it('visar inget utan Apple TV+', () => {
    auth.user = { myProviders: [76], providerTiers: { 76: 'total-appletv' } };
    const { container } = render(<AppleTvDoubleCard />);
    expect(container).toBeEmptyDOMElement();
  });
  it('visar inget för Viaplay utan Apple TV', () => {
    auth.user = { myProviders: [76, 350], providerTiers: { 76: 'total' } };
    const { container } = render(<AppleTvDoubleCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
