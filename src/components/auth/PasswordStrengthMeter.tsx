import type { PasswordStrength } from '@/lib/passwordStrength';

/**
 * 4-segment styrke-meter + etikett. Färgmappning:
 * - score 0-1: röd (otillräcklig, blockerar submit)
 * - score 2: accent-orange (ok)
 * - score 3-4: grön (bra/stark)
 */
export function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  if (!strength.label) return null;

  const barColor =
    strength.score >= 3 ? 'bg-green-600' :
    strength.score === 2 ? 'bg-acc-deep' :
    'bg-danger';

  return (
    <div className="mb-2 -mt-1">
      <div className="flex gap-[2px] mb-1" aria-hidden="true">
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={`h-[3px] flex-1 rounded-sm ${
              i <= strength.score ? barColor : 'bg-rule'
            }`}
          />
        ))}
      </div>
      <div className={`text-xxs ${
        strength.acceptable ? 'text-ink-3' : 'text-danger-ink'
      }`}>
        {strength.label}
        {strength.feedback ? ` — ${strength.feedback}` : ''}
      </div>
    </div>
  );
}
