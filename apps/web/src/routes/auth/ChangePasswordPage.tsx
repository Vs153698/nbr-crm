import { passwordSchema } from '@nbr/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PasswordStrength } from '@/components/ui/PasswordStrength';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { AUTH_FOOTER, AuthCard, AuthNotice, AuthShell, BrandMark } from './AuthShell';
import { BrandButton, BrandButtonSecondary, BrandInput } from './BrandField';

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
    <AuthShell footer={AUTH_FOOTER}>
      <BrandMark />

      <AuthCard
        title={forced ? 'Set your password' : 'Change password'}
        subtitle={
          forced
            ? 'Your account was created with a temporary password. Choose your own to continue.'
            : 'You will be signed out of all devices afterwards.'
        }
        note="Changing your password ends every active session, on this device and any other."
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {forced ? (
            <AuthNotice tone="warn">
              The temporary password you were given is assumed to be compromised. Nothing else in
              the system is reachable until you replace it.
            </AuthNotice>
          ) : null}

          <BrandInput
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
            <BrandInput
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
            label="Confirm new password"
            type={show ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={errors.confirmPassword}
            autoComplete="new-password"
            required
            prefix={<Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
          />

          <div className="pt-1.5">
            <BrandButton loading={submitting} loadingLabel="Updating…">
              Update Password
            </BrandButton>
          </div>

          {/* No way out while the rotation is forced — the API closes every
              other endpoint for this user, so a Cancel would only dead-end. */}
          {!forced ? (
            <BrandButtonSecondary onClick={() => navigate(-1)}>Cancel</BrandButtonSecondary>
          ) : null}
        </form>
      </AuthCard>
    </AuthShell>
  );
}
