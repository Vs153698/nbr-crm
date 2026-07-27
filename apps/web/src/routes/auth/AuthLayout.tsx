import type { ReactNode } from 'react';

/**
 * Shared frame for login, forgot-password and reset screens (W-01, W-02).
 *
 * Split layout: the brand panel carries the institutional weight the product
 * needs, the form side stays plain so nothing competes with the one thing the
 * user came here to do.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Brand panel — hidden on small screens where it would just push the
          form below the fold. */}
      <aside
        className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden p-10 text-white lg:flex"
        style={{
          background:
            'radial-gradient(1000px 420px at 85% -10%, rgba(37,87,214,.45), transparent 62%), linear-gradient(160deg, #0E1B3D 0%, #1B2C55 100%)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#F0C64E] to-gold text-xl font-bold text-navy shadow-[0_4px_16px_rgba(192,138,46,.45)]">
            ★
          </span>
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em]">National Book of Records</p>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">
              Backend CRM · Internal System
            </p>
          </div>
        </div>

        <div className="max-w-md">
          <p className="text-2xl font-bold leading-snug tracking-tight">
            One applicant.
            <br />
            One permanent digital profile.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Application, verification, payment, certificate, publication and dispatch — the whole
            lifecycle managed from a single screen, with every action recorded automatically.
          </p>
        </div>

        <p className="text-[11px] leading-relaxed text-white/35">
          Authorised staff only. All access is logged and audited under the Digital Personal Data
          Protection Act, 2023.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          {/* Compact brand mark for the mobile layout. */}
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#F0C64E] to-gold text-lg font-bold text-navy">
              ★
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-navy">
                National Book of Records
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-3">Backend CRM</p>
            </div>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-3">{subtitle}</p> : null}

          <div className="mt-6">{children}</div>

          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
