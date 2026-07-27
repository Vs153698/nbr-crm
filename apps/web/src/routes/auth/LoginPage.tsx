import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AuthLayout } from './AuthLayout';

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

  const isLockout = error?.code === 'RATE_LIMITED';

  return (
    <AuthLayout title="Sign in" subtitle="Use your work email or employee ID.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? (
          <div
            role="alert"
            className={`flex gap-2.5 rounded-lg border p-3 ${
              isLockout
                ? 'border-warn-ring bg-warn-tint text-warn'
                : 'border-danger-ring bg-danger-tint text-danger'
            }`}
          >
            <Icons.ShieldAlert
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE}
              className="mt-0.5 shrink-0"
            />
            <p className="text-xs leading-relaxed">{error.message}</p>
          </div>
        ) : null}

        <Input
          label="Email or employee ID"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="you@nationalbookofrecords.in"
          autoComplete="username"
          autoFocus
          required
          prefix={<Icons.User size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        />

        <Input
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
              className="text-ink-3 transition-colors hover:text-ink"
            >
              {showPassword ? (
                <Icons.EyeOff size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
              ) : (
                <Icons.Eye size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
              )}
            </button>
          }
        />

        <div className="flex items-center justify-between">
          <Checkbox
            label="Remember me"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          <Link
            to="/forgot-password"
            className="text-xs font-medium text-brand transition-colors hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
        <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
        Five failed attempts lock the account for 15 minutes. Sessions end after 30 minutes of
        inactivity.
      </p>
    </AuthLayout>
  );
}
