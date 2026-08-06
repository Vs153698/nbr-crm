import { cn } from '@/lib/cn';

/**
 * Password strength meter (W-02 step 2).
 *
 * Scores against the same rules the shared `passwordSchema` enforces, so the
 * meter can never show "strong" for something the server will reject. Length
 * carries the most weight because it genuinely matters most.
 */
export interface PasswordCheck {
  readonly label: string;
  readonly met: boolean;
}

export function evaluatePassword(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  checks: PasswordCheck[];
} {
  const checks: PasswordCheck[] = [
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'An uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'A lowercase letter', met: /[a-z]/.test(password) },
    { label: 'A number', met: /\d/.test(password) },
    { label: 'A symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];

  const met = checks.filter((check) => check.met).length;
  // Length is the single biggest factor in real-world resistance, so a long
  // password gets credit even before every character class is present.
  const lengthBonus = password.length >= 16 ? 1 : 0;
  const raw = Math.min(4, Math.max(0, met - 1 + lengthBonus));

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

  return {
    score: raw as 0 | 1 | 2 | 3 | 4,
    label: labels[raw] ?? 'Very weak',
    checks,
  };
}

const BAR_COLOURS = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-brand', 'bg-ok'] as const;

/**
 * `tone` picks the palette for the surface underneath.
 *
 * The default tokens are mixed against the light application canvas, and the
 * unmet-requirement colours in particular (`text-ink-3` on `bg-slate2-tint`)
 * all but vanish on the dark navy auth surface — which is the one place this
 * component has to be legible, since it is telling someone why their password
 * was rejected.
 */
export function PasswordStrength({
  password,
  tone = 'light',
}: {
  password: string;
  tone?: 'light' | 'dark';
}) {
  if (!password) return null;

  const { score, label, checks } = evaluatePassword(password);
  const dark = tone === 'dark';

  const trackClass = dark ? 'bg-nbr-line' : 'bg-slate2-tint';
  const mutedClass = dark ? 'text-nbr-text-4' : 'text-ink-3';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-200',
                index < score ? BAR_COLOURS[score] : trackClass,
              )}
            />
          ))}
        </div>
        <span className={cn('w-16 shrink-0 text-right text-[10px] font-semibold', mutedClass)}>
          {label}
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {checks.map((check) => (
          <li
            key={check.label}
            className={cn('flex items-center gap-1 text-[10px]', check.met ? 'text-ok' : mutedClass)}
          >
            <span
              className={cn(
                'grid h-3 w-3 shrink-0 place-items-center rounded-full text-[8px] font-bold',
                check.met
                  ? 'bg-ok text-white'
                  : cn(trackClass, dark ? 'text-nbr-text-4' : 'text-ink-4'),
              )}
            >
              {check.met ? '✓' : '·'}
            </span>
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
