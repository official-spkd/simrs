import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController, AuthController, SessionAssignmentController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

/** P02 · Identitas dan login. Validasi sesi per permintaan ada di infra/auth (AuthGuard, SessionStore). */
@Module({
  controllers: [AuthController, AccountController, SessionAssignmentController],
  providers: [AuthService, AccountService, AuthRepository],
})
export class AuthModule {}
