import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionsService } from './sessions.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from './entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EmailService } from '../common/email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Company, AuditLog, PasswordResetToken, RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN ?? '20m',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, JwtStrategy, EmailService],
  exports: [AuthService, SessionsService, JwtModule],
})
export class AuthModule {}
