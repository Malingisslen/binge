'use client';

interface Props {
  ratingCount: number;
  onOpenQuickRate: () => void;
}

export default function EmptyState({ ratingCount, onOpenQuickRate }: Props) {
  if (ratingCount >= 3) return null;
  const text = ratingCount === 0
    ? 'Betygsätt 3 titlar du sett för fler personliga rader →'
    : `Betygsätt ${3 - ratingCount} till för person- och tematiska rader →`;
  return (
    <div className="bg-surface border border-rule rounded-sm p-3 mb-4 text-xs flex items-center justify-between">
      <span className="text-ink-2">{text}</span>
      <button onClick={onOpenQuickRate} className="text-acc-deep hover:underline">
        Snabb-betyg (90s)
      </button>
    </div>
  );
}
