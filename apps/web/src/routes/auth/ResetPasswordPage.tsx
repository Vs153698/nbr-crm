import { passwordSchema } from '@nbr/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AUTH_FOOTER, AuthCard, AuthNotice, AuthShell, BrandMark } from './AuthShell';
import { BrandBackLink, BrandButton, BrandInput } from './BrandField';

/** W-02 step 2 — set a new password from the emailed link. */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    // Validated with the same Zod schema the API uses, so the browser can
    // never accept something the server will reject.
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setErrors({ password: result.error.issues[0]?.message ?? 'Password is not strong enough' });
      return;
    }
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password, confirmPassword });
      toast.success('Password updated. Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (caught: unknown) {
      if (caught instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const { name, message } of caught.fieldErrors) fieldErrors[name] = message;
        setErrors(
          Object.keys(fieldErrors).length > 0 ? fieldErrors : { password: caught.message },
        );
      } else {
        setErrors({ password: 'Something went wrong. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthShell footer={AUTH_FOOTER}>
        <BrandMark />

        <AuthCard title="Invalid reset link">
          <AuthNotice tone="danger">
            This link is missing its token. Request a new reset email.
          </AuthNotice>

          <div className="mt-5">
            <Link to="/forgot-password" className="block">
              <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-nbr-orange text-sm font-bold tracking-wide text-white transition-colors hover:bg-nbr-orange-hover">
                Request a new link
                <Icons.ArrowRight size={16} strokeWidth={2.4} />
              </span>
            </Link>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={AUTH_FOOTER}>
      <BrandMark />

      <AuthCard
        title="Set a new password"
        subtitle="Choose something you haven't used before."
        note="This link works once and expires 30 minutes after it was sent."
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <BrandInput
              label="New password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              autoComplete="new-password"
              autoFocus
              required
              prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
              suffix={
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="rounded p-1 text-nbr-text-4 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring"
                >
                  {show ? (
                    <Icons.EyeOff size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                  ) : (
                    <Icons.Eye size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                  )}
                </button>
              }
            />
            <PasswordStrength password={password} tone="dark" />
          </div>

          <BrandInput
            label="Confirm password"
            type={show ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={errors.confirmPassword}
            autoComplete="new-password"
            required
            prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
          />

          <div className="pt-1.5">
            <BrandButton loading={submitting} loadingLabel="Setting…">
              Set Password
            </BrandButton>
          </div>

          <div className="pt-0.5 text-center">
            <Link
              to="/login"
              className="group inline-block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring"
            >
              <BrandBackLink>Back to sign in</BrandBackLink>
            </Link>
          </div>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
