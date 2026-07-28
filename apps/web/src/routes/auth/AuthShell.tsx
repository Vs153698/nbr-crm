import { useEffect, type ReactNode } from 'react';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';

/**
 * Brand frame for the sign-in screen.
 *
 * Deliberately separate from `AuthLayout`, which still serves the password
 * reset screens: the brand rollout is happening page by page, and a shared
 * frame would have dragged three unreviewed screens along with this one.
 * Once those screens are redesigned too, this replaces it.
 *
 * The dot grid is a CSS background rather than an image — it is two gradients'
 * worth of visual interest for zero bytes and no HTTP request, and it survives
 * any viewport size without tiling seams.
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  // The dark page is painted by this element, but overscroll reveals `body`
  // underneath it — which is the light application canvas. Without this, a
  // rubber-band scroll on iOS flashes grey above a navy page.
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#0D1B2A';
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-nbr-bg px-5 py-10">
      {/* Dot grid. `radial-gradient` here draws a dot, not a colour ramp —
          there is no gradient fill anywhere in this design. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #1B2C3D 1.5px, transparent 1.5px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Corner rules: structure without a box, so the page reads as a
          considered surface rather than a form floating in the dark. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-nbr-line" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-nbr-line" />

      <main className="relative w-full max-w-[416px]">{children}</main>

      {footer ? (
        <footer className="relative mt-8 w-full max-w-[416px] text-center">{footer}</footer>
      ) : null}
    </div>
  );
}

/**
 * The bordered panel every auth screen sits in.
 *
 * `note` renders in a separate strip below the form rather than inside it, so
 * standing policy text is not mistaken for feedback about what was just typed.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  note,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-nbr-line bg-nbr-surface">
      {/* Brand rule. Carries the accent without an ornament competing with
          the form's own primary action for attention. */}
      <div aria-hidden className="h-[3px] w-full bg-nbr-orange" />

      <div className="p-7 sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm leading-relaxed text-nbr-text-3">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>

      {note ? (
        <div className="flex items-start gap-2 border-t border-nbr-line bg-nbr-raised px-7 py-3.5 sm:px-8">
          <Icons.ShieldCheck
            size={14}
            strokeWidth={ICON_STROKE}
            className="mt-px shrink-0 text-nbr-text-4"
          />
          <p className="text-[11px] leading-relaxed text-nbr-text-4">{note}</p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Inline status panel.
 *
 * Tinted with an alpha over the dark surface rather than the light `*-tint`
 * tokens, which were mixed against white and turn muddy here.
 */
export function AuthNotice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger';
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const styles = {
    ok: { box: 'border-ok/40 bg-ok/10 text-ok', icon: Icons.CheckCircle2 },
    warn: { box: 'border-warn/40 bg-warn/10 text-warn', icon: Icons.ShieldAlert },
    danger: { box: 'border-danger/40 bg-danger/10 text-danger', icon: Icons.ShieldAlert },
  }[tone];

  const Resolved = Icon ?? styles.icon;

  return (
    <div role="alert" className={`flex gap-2.5 rounded-lg border p-3.5 ${styles.box}`}>
      <Resolved size={16} strokeWidth={ICON_STROKE} className="mt-px shrink-0" />
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

/** Logo lock-up. Sized for the login card; the wordmark is text, not artwork. */
export function BrandMark() {
  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <img
        src="/nbr-logo.png"
        alt=""
        width={72}
        height={72}
        // The one image on the page and it is above the fold, so it loads
        // eagerly and at high priority rather than waiting its turn.
        loading="eager"
        fetchPriority="high"
        className="h-[72px] w-[72px]"
      />
      <p className="mt-3.5 text-[15px] font-bold uppercase tracking-[0.18em] text-white">
        National Book of Records
      </p>
      <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.22em] text-nbr-text-4">
        Backend CRM · Internal System
      </p>
    </div>
  );
}
