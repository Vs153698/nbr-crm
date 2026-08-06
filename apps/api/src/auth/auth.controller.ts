import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type SessionUser,
} from '@nbr/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorisedError } from '../common/errors';
import { zodBody } from '../common/zod-validation.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import {
  AllowDuringPasswordChange,
  CurrentUser,
  Public,
} from './auth.decorators';
import { AuthService, parseDuration } from './auth.service';
import type { Actor } from '../common/request-context';

const ACCESS_COOKIE = 'nbr_access';
const REFRESH_COOKIE = 'nbr_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Tokens are delivered as HttpOnly cookies rather than in the JSON body.
   * A token in localStorage is readable by any script on the page, which turns
   * a single XSS into full account takeover; an HttpOnly cookie is not.
   * SameSite=strict plus the CSRF double-submit check covers the cross-site
   * request forgery that cookies would otherwise open up.
   */
  private setAuthCookies(
    reply: FastifyReply,
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
  ): void {
    const secure = this.env.COOKIE_SECURE;
    const common = {
      httpOnly: true,
      secure,
      sameSite: 'strict' as const,
      path: '/',
      domain: this.env.COOKIE_DOMAIN === 'localhost' ? undefined : this.env.COOKIE_DOMAIN,
    };

    void reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
      ...common,
      maxAge: Math.floor(parseDuration(this.env.JWT_ACCESS_TTL) / 1000),
    });

    void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...common,
      // Scoped to the refresh endpoints only, so it is never sent on the
      // hundreds of ordinary API calls that have no use for it.
      path: '/api/v1/auth',
      maxAge: Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000),
    });
  }

  private clearAuthCookies(reply: FastifyReply): void {
    void reply.clearCookie(ACCESS_COOKIE, { path: '/' });
    void reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(loginSchema)) body: { identifier: string; password: string; rememberMe: boolean },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: SessionUser }> {
    const result = await this.auth.login(body.identifier, body.password, body.rememberMe);
    this.setAuthCookies(reply, result);
    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ expiresAt: string }> {
    const token = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies
      ?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorisedError('REFRESH_MISSING', 'Please sign in again.');

    const tokens = await this.auth.refresh(token);
    this.setAuthCookies(reply, tokens);
    return { expiresAt: tokens.accessExpiresAt.toISOString() };
  }

  @Post('logout')
  @HttpCode(200)
  @AllowDuringPasswordChange()
  async logout(
    @CurrentUser() actor: Actor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(actor.sessionId, actor.userId);
    this.clearAuthCookies(reply);
    return { ok: true };
  }

  /**
   * Always returns the same response, whether or not the address is registered
   * — otherwise this endpoint tells an attacker which emails have accounts.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(
    @Body(zodBody(forgotPasswordSchema)) body: { email: string },
  ): Promise<{ message: string }> {
    const result = await this.auth.requestPasswordReset(body.email);

    if (result) {
      await this.mail.sendPasswordReset(body.email, result.token);
    }

    return {
      message: 'If that email is registered, a reset link is on its way.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) body: { token: string; password: string },
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowDuringPasswordChange()
  async changePassword(
    @CurrentUser() actor: Actor,
    @Body(zodBody(changePasswordSchema))
    body: { currentPassword: string; password: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(actor.userId, body.currentPassword, body.password);
    // Every session was just revoked, including this one — the client must
    // sign in again with the new credential.
    this.clearAuthCookies(reply);
    return { ok: true };
  }

  /** Session bootstrap for the web app: user, role and permission set. */
  @Get('me')
  @AllowDuringPasswordChange()
  async me(@CurrentUser() actor: Actor): Promise<SessionUser> {
    await this.auth.touchSession(actor.sessionId);
    const expiresAt = new Date(Date.now() + this.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
    return this.auth.buildSessionUser(actor.userId, expiresAt);
  }
}
