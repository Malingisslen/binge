'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      <h2 className="text-[18px] font-bold text-text-primary mb-2">Något gick fel</h2>
      <p className="text-sm text-text-muted mb-4">Ett oväntat fel uppstod. Försök ladda om sidan.</p>
      <button
        onClick={reset}
        className="px-4 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-[inherit] cursor-pointer"
      >
        Ladda om
      </button>
    </div>
  );
}
