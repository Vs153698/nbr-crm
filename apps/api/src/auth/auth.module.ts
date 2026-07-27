import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  imports: [
    // Secrets are supplied per-call rather than registered here, because the
    // access and refresh paths deliberately use different keys.
    JwtModule.register({}),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PermissionsService],
  exports: [AuthService, PermissionsService, JwtModule],
})
export class AuthModule {}
