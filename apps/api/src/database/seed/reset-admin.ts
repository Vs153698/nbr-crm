import 'dotenv/config';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { loadEnv } from '../../config/env';
import { createDatabase, createPool } from '../client';
import * as schema from '../schema';

/**
 * Reset the Super Admin password back to whatever `SUPER_ADMIN_PASSWORD` holds.
 *
 * Exists because the seed deliberately never touches an existing user's
 * password — re-running it on a deployed system must not silently reset a
 * credential. That is correct, but it leaves no way back in if the bootstrap
 * password is lost, so this is the explicit escape hatch.
 *
 * Every live session is revoked, and a password change is forced on next login.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  if (env.NODE_ENV === 'production') {
    process.stderr.write(
      '✗ Refusing to run against production.\n' +
        '  Reset a production password through the Users screen, or via a one-off\n' +
        '  script with an auditable reason — not with a blanket CLI reset.\n',
    );
    process.exit(1);
  }

  const sqlClient = createPool();
  const db = createDatabase(sqlClient);

  try {
    const passwordHash = await argon2.hash(env.SUPER_ADMIN_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const updated = await db
      .update(schema.users)
      .set({
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        // Bumping the token version invalidates every access token already
        // issued to this account.
        tokenVersion: sql`${schema.users.tokenVersion} + 1`,
      })
      .where(eq(schema.users.email, env.SUPER_ADMIN_EMAIL))
      .returning({ id: schema.users.id, email: schema.users.email });

    if (updated.length === 0) {
      process.stderr.write(
        `✗ No user found with email ${env.SUPER_ADMIN_EMAIL}.\n` +
          '  Run `pnpm db:seed` first to provision the Super Admin.\n',
      );
      process.exit(1);
    }

    // Revoke outstanding refresh sessions so an old browser tab cannot keep
    // operating under the previous credential.
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'admin_password_reset' })
      .where(eq(schema.sessions.userId, updated[0]!.id));

    process.stdout.write(
      `✓ Password reset for ${updated[0]!.email}\n` +
        `  Sign in with SUPER_ADMIN_PASSWORD from .env\n` +
        `  You will be asked to set a new password immediately.\n`,
    );
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`✗ Reset failed\n${String(error)}\n`);
  process.exit(1);
});
