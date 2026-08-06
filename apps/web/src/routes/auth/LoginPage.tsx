import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AUTH_FOOTER, AuthCard, AuthNotice, AuthShell, BrandMark } from './AuthShell';
import { BrandButton, BrandCheckbox, BrandInput } from './BrandField';

/**
 * W-01 Login.
 *
 * Accepts email or employee ID. The lockout and rate-limit messages come
 * straight from the server so the countdown the user sees is the real one,
 * not a client-side guess.
 */
export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const user = await login(identifier, password, rememberMe);
      // A user forced to rotate their password has no working session yet —
      // send them to the change screen, not to the dashboard.
      navigate(user.mustChangePassword ? '/change-password' : (from ?? '/dashboard'), {
        replace: true,
      });
    } catch (caught: unknown) {
      if (caught instanceof ApiError) {
        setError({ code: caught.code, message: caught.message });
      } else {
        setError({ code: 'NETWORK', message: 'Could not reach the server. Check your connection.' });
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  const isLockout = error?.code === 'RATE_LIMITED' || error?.code === 'ACCOUNT_LOCKED';

  return (
    <AuthShell footer={AUTH_FOOTER}>
      <BrandMark />

      <AuthCard
        title="Sign in"
        subtitle="Use your work email or employee ID."
        note="Five failed attempts lock the account for 15 minutes. Sessions end after 30 minutes of inactivity."
      >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error ? (
              <AuthNotice tone={isLockout ? 'warn' : 'danger'}>{error.message}</AuthNotice>
            ) : null}

            <BrandInput
              label="Email or employee ID"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="you@nationalbookofrecords.in"
              autoComplete="username"
              autoFocus
              required
              prefix={<Icons.User size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
            />

            <BrandInput
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="rounded p-1 text-nbr-text-4 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring"
                >
                  {showPassword ? (
                    <Icons.EyeOff size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                  ) : (
                    <Icons.Eye size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                  )}
                </button>
              }
            />

            <div className="flex items-center justify-between pt-0.5">
              <BrandCheckbox label="Remember me" checked={rememberMe} onChange={setRememberMe} />
              <Link
                to="/forgot-password"
                className="rounded text-xs font-semibold text-nbr-orange transition-colors hover:text-nbr-orange-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring"
              >
                Forgot password?
              </Link>
            </div>

            <div className="pt-1.5">
              <BrandButton loading={submitting}>Sign In</BrandButton>
            </div>
          </form>
      </AuthCard>
    </AuthShell>
  );
}
