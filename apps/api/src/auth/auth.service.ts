import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { User, UserStatus } from './entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EmailService } from '../common/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hour

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepo: Repository<PasswordResetToken>,
    private readonly jwtService: JwtService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.userRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const company = await this.companyRepo.save(
      this.companyRepo.create({
        name: dto.company_name,
        country: dto.country.toUpperCase(),
        vat_number: dto.vat_number ?? null,
        vat_verified: false,
      }),
    );

    const password_hash = await bcrypt.hash(dto.password, 12);

    const user = await this.userRepo.save(
      this.userRepo.create({
        email: dto.email,
        password_hash,
        role: dto.role,
        status: UserStatus.PENDING,
        company_id: company.id,
        gdpr_consent: dto.gdpr_consent,
        gdpr_consent_at: new Date(),
        tos_accepted_at: new Date(),
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'user.registered',
        actor_id: user.id,
        target_id: user.id,
        target_type: 'user',
        payload: { email: user.email, role: user.role, company_id: company.id },
      }),
    );

    return { message: 'Registration successful. Your account is pending admin approval.' };
  }

  async login(dto: LoginDto): Promise<{ access_token: string }> {
    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('Account is pending admin approval');
    }
    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('Account has been blocked');
    }

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'user.login',
        actor_id: user.id,
        target_id: user.id,
        target_type: 'user',
        payload: { email: user.email },
      }),
    );

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return { access_token: this.jwtService.sign(payload) };
  }

  async getProfile(userId: string): Promise<Omit<User, 'password_hash'> & { company: Company | null }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });
    if (!user) throw new UnauthorizedException();
    const { password_hash, ...profile } = user;
    return { ...profile, company: user.company ?? null };
  }

  // Always returns a generic message regardless of whether the email exists,
  // to avoid leaking which emails are registered.
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const genericResponse = {
      message: 'If an account exists for that email, a password reset link has been sent.',
    };

    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user || user.status === UserStatus.BLOCKED) {
      return genericResponse;
    }

    const rawToken = randomBytes(32).toString('hex');
    const token_hash = this.hashToken(rawToken);
    const expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.resetTokenRepo.save(
      this.resetTokenRepo.create({ user_id: user.id, token_hash, expires_at }),
    );

    const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    await this.email.sendPasswordReset(user.email, resetUrl);

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'user.password_reset_requested',
        actor_id: user.id,
        target_id: user.id,
        target_type: 'user',
        payload: {},
      }),
    );

    return genericResponse;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const token_hash = this.hashToken(dto.token);

    const tokenRow = await this.resetTokenRepo.findOne({
      where: { token_hash, used_at: IsNull(), expires_at: MoreThan(new Date()) },
    });
    if (!tokenRow) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.userRepo.findOneBy({ id: tokenRow.user_id });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    user.password_hash = await bcrypt.hash(dto.new_password, 12);
    await this.userRepo.save(user);

    tokenRow.used_at = new Date();
    await this.resetTokenRepo.save(tokenRow);

    // Invalidate any other outstanding tokens for this user
    await this.resetTokenRepo
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ used_at: () => 'NOW()' })
      .where('user_id = :userId', { userId: user.id })
      .andWhere('used_at IS NULL')
      .execute();

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'user.password_reset_completed',
        actor_id: user.id,
        target_id: user.id,
        target_type: 'user',
        payload: {},
      }),
    );

    return { message: 'Password has been reset. You can now log in with your new password.' };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
