import { passwordSchema } from '@nbr/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AuthLayout } from './AuthLayout';

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
      <AuthLayout title="Invalid reset link">
        <div className="rounded-lg border border-danger-ring bg-danger-tint p-4 text-xs leading-relaxed text-danger">
          This link is missing its token. Request a new reset email.
        </div>
        <Link to="/forgot-password" className="mt-5 block">
          <Button variant="primary" block>
            Request a new link
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose something you haven't used before.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Input
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
                className="text-ink-3 transition-colors hover:text-ink"
              >
                {show ? (
                  <Icons.EyeOff size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                ) : (
                  <Icons.Eye size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                )}
              </button>
            }
          />
          <PasswordStrength password={password} />
        </div>

        <Input
          label="Confirm password"
          type={show ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={errors.confirmPassword}
          autoComplete="new-password"
          required
          prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Set password &amp; sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
