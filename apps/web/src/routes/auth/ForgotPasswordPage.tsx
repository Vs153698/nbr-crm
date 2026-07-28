import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AuthCard, AuthNotice, AuthShell, BrandMark } from './AuthShell';
import { BrandBackLink, BrandButton, BrandInput } from './BrandField';

/**
 * W-02 step 1 — request a reset link.
 *
 * The success message is identical whether or not the address is registered.
 * Confirming "no such account" here would turn this form into an account
 * enumeration tool, so the server always returns 202 and the UI always says
 * the same thing.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      // Deliberately swallowed — see above. A failure here must look exactly
      // like a success to the caller.
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  const footer = (
    <p className="text-[11px] leading-relaxed text-nbr-text-4">
      Authorised staff only. All access is logged and audited under the
      <br className="hidden sm:block" /> Digital Personal Data Protection Act, 2023.
    </p>
  );

  if (sent) {
    return (
      <AuthShell footer={footer}>
        <BrandMark />

        <AuthCard title="Check your email">
          <AuthNotice tone="ok">
            <p className="font-semibold">
              If that email is registered, a reset link is on its way.
            </p>
            <p className="mt-1 opacity-80">
              The link is valid for 30 minutes. Check your spam folder if it hasn't arrived in a few
              minutes.
            </p>
          </AuthNotice>

          {/* The address is echoed so a typo is obvious without revealing
              whether it matched an account. */}
          {email ? (
            <p className="mt-4 truncate text-center text-xs text-nbr-text-3">
              Sent to <span className="font-semibold text-nbr-text-2">{email}</span>
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3">
            <Link to="/login" className="block">
              <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-nbr-edge text-sm font-semibold text-nbr-text-2 transition-colors hover:border-nbr-text-4 hover:text-white">
                <Icons.ChevronLeft size={15} strokeWidth={2.4} />
                Back to sign in
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setSent(false)}
              className="rounded text-xs font-semibold text-nbr-orange transition-colors hover:text-nbr-orange-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring"
            >
              Use a different email address
            </button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={footer}>
      <BrandMark />

      <AuthCard
        title="Reset your password"
        subtitle="We'll email you a link to set a new one."
        note="For security, we send the same confirmation whether or not the address is registered."
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <BrandInput
            label="Registered email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@nationalbookofrecords.in"
            autoComplete="email"
            autoFocus
            required
            prefix={<Icons.Mail size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
          />

          <div className="pt-1.5">
            <BrandButton loading={submitting} loadingLabel="Sending…">
              Send Reset Link
            </BrandButton>
          </div>

          <div className="pt-0.5 text-center">
            <Link to="/login" className="group inline-block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring">
              <BrandBackLink>Back to sign in</BrandBackLink>
            </Link>
          </div>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
