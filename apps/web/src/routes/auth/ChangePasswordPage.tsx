import { passwordSchema } from '@nbr/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AuthLayout } from './AuthLayout';

/**
 * Change password — also the forced-rotation screen.
 *
 * A user carrying `mustChangePassword` is routed here from anywhere and cannot
 * leave until they rotate, mirroring the API guard that closes every other
 * endpoint for them. Changing the password revokes all sessions server-side,
 * so this screen always ends at the login page.
 */
export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const forced = user?.mustChangePassword ?? false;

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setErrors({ password: result.error.issues[0]?.message ?? 'Password is not strong enough' });
      return;
    }
    if (password !== confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    if (password === currentPassword) {
      setErrors({ password: 'Choose a password you have not used before.' });
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, password, confirmPassword });
      toast.success('Password updated. Please sign in again.');
      // Every session was just revoked — including this one.
      await logout();
      navigate('/login', { replace: true });
    } catch (caught: unknown) {
      if (caught instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const { name, message } of caught.fieldErrors) fieldErrors[name] = message;
        setErrors(
          Object.keys(fieldErrors).length > 0 ? fieldErrors : { currentPassword: caught.message },
        );
      } else {
        setErrors({ currentPassword: 'Something went wrong. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={forced ? 'Set your password' : 'Change password'}
      subtitle={
        forced
          ? 'Your account was created with a temporary password. Choose your own to continue.'
          : 'You will be signed out of all devices afterwards.'
      }
    >
      {forced ? (
        <div className="mb-5 flex gap-2.5 rounded-lg border border-warn-ring bg-warn-tint p-3">
          <Icons.ShieldAlert
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE}
            className="mt-0.5 shrink-0 text-warn"
          />
          <p className="text-xs leading-relaxed text-warn">
            The temporary password you were given is assumed to be compromised. Nothing else in the
            system is reachable until you replace it.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label={forced ? 'Temporary password' : 'Current password'}
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={errors.currentPassword}
          autoComplete="current-password"
          autoFocus
          required
          prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        />

        <div className="space-y-2">
          <Input
            label="New password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            autoComplete="new-password"
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
          label="Confirm new password"
          type={show ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={errors.confirmPassword}
          autoComplete="new-password"
          required
          prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Update password
        </Button>

        {!forced ? (
          <Button variant="ghost" block onClick={() => navigate(-1)}>
            Cancel
          </Button>
        ) : null}
      </form>
    </AuthLayout>
  );
}
