import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AuthLayout } from './AuthLayout';

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

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <div className="rounded-lg border border-ok-ring bg-ok-tint p-4">
          <div className="flex gap-2.5">
            <Icons.CheckCircle2
              size={ICON_SIZE.lg}
              strokeWidth={ICON_STROKE}
              className="mt-0.5 shrink-0 text-ok"
            />
            <div className="text-xs leading-relaxed text-ok">
              <p className="font-semibold">If that email is registered, a reset link is on its way.</p>
              <p className="mt-1 opacity-80">
                The link is valid for 30 minutes. Check your spam folder if it hasn't arrived in a
                few minutes.
              </p>
            </div>
          </div>
        </div>

        <Link to="/login" className="mt-5 block">
          <Button variant="secondary" block icon={Icons.ChevronLeft}>
            Back to sign in
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
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

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Send reset link
        </Button>

        <Link
          to="/login"
          className="flex items-center justify-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-brand"
        >
          <Icons.ChevronLeft size={14} strokeWidth={ICON_STROKE} />
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  );
}
