import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';
import { User, UserStatus } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { JwtPayload } from './strategies/jwt.strategy';
import { REFRESH_TOKEN_TTL_MS } from './refresh-cookie';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

type Rotation = { tokens: SessionTokens } | { reusedBy: string } | null;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokenRepo: Repository<RefreshToken>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly jwtService: JwtService,
  ) {}

  // Starts a new session (login, or the session kept after a password change)
  async issue(userId: string): Promise<SessionTokens> {
    return this.tokenRepo.manager.transaction(async (m) => {
      const user = await this.lockUser(m, userId);
      if (!user) throw new UnauthorizedException();
      await m.delete(RefreshToken, { user_id: userId, expires_at: LessThan(new Date()) });
      return this.createTokens(m, user);
    });
  }

  // Exchanges a refresh token for a new pair. A token works exactly once:
  // presenting a used one again means it leaked, so the whole user is signed out.
  async rotate(rawToken: string | null): Promise<SessionTokens> {
    const result = rawToken ? await this.tryRotate(this.hash(rawToken)) : null;

    if (result && 'reusedBy' in result) {
      this.logger.warn(`Refresh token reuse detected, all sessions revoked for user ${result.reusedBy}`);
      await this.audit('session.reuse_detected', result.reusedBy);
    }
    if (!result || 'reusedBy' in result) throw new UnauthorizedException('Session expired');
    return result.tokens;
  }

  // Logout: ends this session only, the user's other devices stay signed in
  async revoke(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    const row = await this.tokenRepo.findOneBy({ token_hash: this.hash(rawToken) });
    if (!row || row.revoked_at) return;
    row.revoked_at = new Date();
    await this.tokenRepo.save(row);
    await this.audit('user.logout', row.user_id);
  }

  // Password change or reset, blocking: ends every session, access tokens included
  async revokeAll(userId: string): Promise<void> {
    await this.tokenRepo.manager.transaction((m) => this.revokeAllIn(m, userId));
  }

  private tryRotate(token_hash: string): Promise<Rotation> {
    return this.tokenRepo.manager.transaction(async (m) => {
      const found = await m.findOneBy(RefreshToken, { token_hash });
      if (!found) return null;

      // All session changes of one user run in turn. Otherwise two refreshes
      // with one token could both pass, or a token issued by a rotation could
      // outlive a revokeAll running next to it.
      const user = await this.lockUser(m, found.user_id);
      const row = await m.findOneBy(RefreshToken, { id: found.id });
      if (!user || !row || row.expires_at <= new Date()) return null;

      if (row.used_at) {
        await this.revokeAllIn(m, row.user_id);
        return { reusedBy: row.user_id };
      }
      if (row.revoked_at || user.status !== UserStatus.ACTIVE) return null;

      row.used_at = new Date();
      await m.save(row);
      return { tokens: await this.createTokens(m, user) };
    });
  }

  private async createTokens(m: EntityManager, user: User): Promise<SessionTokens> {
    const refresh_token = randomBytes(32).toString('hex');
    await m.save(
      m.create(RefreshToken, {
        user_id: user.id,
        token_hash: this.hash(refresh_token),
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      }),
    );
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.token_version ?? 0,
    };
    return { access_token: this.jwtService.sign(payload), refresh_token };
  }

  private async revokeAllIn(m: EntityManager, userId: string): Promise<void> {
    // Updating the user first takes the same row lock that lockUser waits for
    await m
      .createQueryBuilder()
      .update(User)
      .set({ token_version: () => 'token_version + 1' })
      .where('id = :userId', { userId })
      .execute();
    await m
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: () => 'NOW()' })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  private lockUser(m: EntityManager, id: string): Promise<User | null> {
    return m
      .createQueryBuilder(User, 'u')
      .addSelect('u.token_version')
      .where('u.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async audit(event_type: string, userId: string): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ event_type, actor_id: userId, target_id: userId, target_type: 'user', payload: {} }),
    );
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
