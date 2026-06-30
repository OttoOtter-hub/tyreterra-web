import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EmailService } from '../common/email.service';

const mockRepo = () => ({
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((x) => x),
  save: jest.fn((x) => Promise.resolve({ id: 'uuid-1', ...x })),
});

const mockJwt = () => ({ sign: jest.fn(() => 'signed-token') });
const mockEmail = () => ({ sendPasswordReset: jest.fn() });

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;
  let companyRepo: ReturnType<typeof mockRepo>;
  let auditRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockRepo },
        { provide: getRepositoryToken(Company), useFactory: mockRepo },
        { provide: getRepositoryToken(AuditLog), useFactory: mockRepo },
        { provide: getRepositoryToken(PasswordResetToken), useFactory: mockRepo },
        { provide: JwtService, useFactory: mockJwt },
        { provide: EmailService, useFactory: mockEmail },
      ],
    }).compile();

    service = module.get(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    companyRepo = module.get(getRepositoryToken(Company));
    auditRepo = module.get(getRepositoryToken(AuditLog));
  });

  const validRegisterDto = {
    email: 'dealer@example.com',
    password: 'SecurePass123',
    role: UserRole.DEALER as UserRole.DEALER,
    company_name: 'Acme Tyres',
    country: 'DE',
    gdpr_consent: true as const,
    tos_accepted: true as const,
  };

  // ── register ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('creates company + user and returns success message', async () => {
      userRepo.findOneBy.mockResolvedValue(null);

      const result = await service.register(validRegisterDto);

      expect(companyRepo.save).toHaveBeenCalledTimes(1);
      expect(userRepo.save).toHaveBeenCalledTimes(1);
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'user.registered' }),
      );
      expect(result.message).toMatch(/pending admin approval/i);
    });

    it('throws ConflictException when email is already registered', async () => {
      userRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(service.register(validRegisterDto)).rejects.toThrow(ConflictException);
      expect(companyRepo.save).not.toHaveBeenCalled();
    });

    it('stores user with PENDING status', async () => {
      userRepo.findOneBy.mockResolvedValue(null);
      await service.register(validRegisterDto);

      const savedUser = userRepo.save.mock.calls[0][0];
      expect(savedUser.status).toBe(UserStatus.PENDING);
    });

    it('hashes the password (does not store plaintext)', async () => {
      userRepo.findOneBy.mockResolvedValue(null);
      await service.register(validRegisterDto);

      const savedUser = userRepo.save.mock.calls[0][0];
      expect(savedUser.password_hash).not.toBe(validRegisterDto.password);
      const valid = await bcrypt.compare(validRegisterDto.password, savedUser.password_hash);
      expect(valid).toBe(true);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const makeUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-1',
        email: 'dealer@example.com',
        password_hash: bcrypt.hashSync('SecurePass123', 1),
        role: UserRole.DEALER,
        status: UserStatus.ACTIVE,
        ...overrides,
      }) as User;

    const loginDto = { email: 'dealer@example.com', password: 'SecurePass123' };

    it('returns access_token for active user with correct password', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());

      const result = await service.login(loginDto);

      expect(result).toEqual({ access_token: 'signed-token' });
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'user.login' }),
      );
    });

    it('throws UnauthorizedException for unknown email', async () => {
      userRepo.findOneBy.mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      await expect(service.login({ ...loginDto, password: 'WrongPassword1' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException for PENDING account', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ status: UserStatus.PENDING }));
      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for BLOCKED account', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ status: UserStatus.BLOCKED }));
      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });
  });
});
