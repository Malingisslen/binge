export default function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface border border-rule rounded-sm px-3 py-2 text-center">
      <div className="text-[20px] font-bold text-acc-deep">{value}</div>
      <div className="text-xxs text-ink-3 uppercase tracking-[0.5px]">{label}</div>
    </div>
  );
}
