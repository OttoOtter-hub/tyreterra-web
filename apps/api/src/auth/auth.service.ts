import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User, UserStatus } from './entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly jwtService: JwtService,
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
}
