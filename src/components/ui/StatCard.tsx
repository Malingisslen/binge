import { eyebrowClass } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';
export default function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={cardClass('px-3 py-2 text-center')}>
      <div className="text-2xl font-bold text-acc-deep">{value}</div>
      <div className={eyebrowClass()}>{label}</div>
    </div>
  );
}
