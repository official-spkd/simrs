import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController, AuthController, SessionAssignmentController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PinDeviceController, PinLoginController } from './pin.controller';
import { PinService } from './pin.service';

/** P02 · Identitas dan login. Validasi sesi per permintaan ada di infra/auth (AuthGuard, SessionStore). */
@Module({
  controllers: [
    AuthController,
    AccountController,
    SessionAssignmentController,
    PinLoginController,
    PinDeviceController,
  ],
  providers: [AuthService, AccountService, AuthRepository, PinService],
})
export class AuthModule {}
