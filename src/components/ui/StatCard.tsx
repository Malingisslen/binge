export default function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-main rounded-sm px-3 py-2 text-center">
      <div className="text-[20px] font-bold text-accent">{value}</div>
      <div className="text-xxs text-text-muted uppercase tracking-[0.5px]">{label}</div>
    </div>
  );
}
