import type { Metadata } from 'next';
import TvPairPage from '@/components/tv/TvPairPage';

// Inloggningskrävande parningssida: utan egen metadata ärver den root-layoutens
// index:true och canonical:/, och Google läser den som en startsides-dubblett.
export const metadata: Metadata = {
  title: 'Koppla din TV',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default TvPairPage;
