import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual, Between } from 'typeorm';
import { User, UserStatus, UserRole } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing, ListingStatus } from '../listings/entities/listing.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RatingsService } from '../ratings/ratings.service';
import { EmailService } from '../common/email.service';
import { ApproveUserDto, ApprovalAction } from './dto/approve-user.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly ratingsService: RatingsService,
    private readonly email: EmailService,
  ) {}

  // ── User approval queue (§10) ────────────────────────────────────────────

  async getPendingUsers(): Promise<User[]> {
    return this.userRepo.find({
      where: { status: UserStatus.PENDING },
      relations: ['company'],
      order: { created_at: 'ASC' },
    });
  }

  async approveOrReject(userId: string, dto: ApproveUserDto, admin: User): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['company'] });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.PENDING) {
      throw new BadRequestException(`User is already "${user.status}"`);
    }

    if (dto.action === ApprovalAction.APPROVE) {
      user.status = UserStatus.ACTIVE;
    } else {
      if (!dto.reason) throw new BadRequestException('Rejection reason is required');
      user.status = UserStatus.BLOCKED;
    }

    const saved = await this.userRepo.save(user);

    await this.writeAudit(
      dto.action === ApprovalAction.APPROVE ? 'admin.user.approved' : 'admin.user.rejected',
      admin.id, userId, { reason: dto.reason },
    );

    // Email notification (§2.2)
    // Stub — replace with actual email when EmailService is wired to SendGrid
    this.email.sendOfferReceived(user.email, dto.action).catch(() => {});

    return saved;
  }

  // ── Block / unblock ──────────────────────────────────────────────────────

  async blockUser(userId: string, admin: User): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    user.status = UserStatus.BLOCKED;
    const saved = await this.userRepo.save(user);
    await this.writeAudit('admin.user.blocked', admin.id, userId, {});
    return saved;
  }

  async unblockUser(userId: string, admin: User): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    user.status = UserStatus.ACTIVE;
    const saved = await this.userRepo.save(user);
    await this.writeAudit('admin.user.unblocked', admin.id, userId, {});
    return saved;
  }

  async setRole(userId: string, role: UserRole, admin: User): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    user.role = role;
    const saved = await this.userRepo.save(user);
    await this.writeAudit('admin.user.role_changed', admin.id, userId, { role });
    return saved;
  }

  // ── Listing moderation ───────────────────────────────────────────────────

  async removeListing(listingId: string, admin: User): Promise<{ message: string }> {
    const listing = await this.listingRepo.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException('Listing not found');
    listing.status = ListingStatus.INACTIVE;
    await this.listingRepo.save(listing);
    await this.writeAudit('admin.listing.removed', admin.id, listingId, {});
    return { message: 'Listing removed by admin' };
  }

  // ── VAT verification override (§10) ─────────────────────────────────────

  async overrideVat(companyId: string, admin: User): Promise<Company> {
    const company = await this.companyRepo.findOneBy({ id: companyId });
    if (!company) throw new NotFoundException('Company not found');
    company.vat_verified = true;
    company.vat_verified_at = new Date();
    const saved = await this.companyRepo.save(company);
    await this.writeAudit('admin.vat.override', admin.id, companyId, { target_type: 'company' });
    return saved;
  }

  // ── Audit log viewer ─────────────────────────────────────────────────────

  async getAuditLog(query: AuditLogQueryDto): Promise<{ data: AuditLog[]; total: number }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);

    const qb = this.auditRepo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');

    if (query.event_type) qb.andWhere('a.event_type = :et', { et: query.event_type });
    if (query.actor_id) qb.andWhere('a.actor_id = :aid', { aid: query.actor_id });
    if (query.from) qb.andWhere('a.created_at >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('a.created_at <= :to', { to: new Date(query.to) });

    const [data, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    return { data, total };
  }

  // ── KPI dashboard ────────────────────────────────────────────────────────

  async getDashboard(): Promise<Record<string, number>> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

    const [
      activeListings,
      pendingUsers,
      requestsToday,
      dealsThisWeek,
      newSignupsToday,
    ] = await Promise.all([
      this.listingRepo.countBy({ status: ListingStatus.ACTIVE }),
      this.userRepo.countBy({ status: UserStatus.PENDING }),
      this.auditRepo.count({
        where: { event_type: 'request.created', created_at: MoreThanOrEqual(dayAgo) },
      }),
      this.auditRepo.count({
        where: { event_type: 'offer.accepted', created_at: MoreThanOrEqual(weekAgo) },
      }),
      this.userRepo.count({
        where: { created_at: MoreThanOrEqual(dayAgo) },
      }),
    ]);

    return { activeListings, pendingUsers, requestsToday, dealsThisWeek, newSignupsToday };
  }

  // ── Manual rating recalculation trigger ──────────────────────────────────

  async recalculateRating(companyId: string): Promise<{ message: string }> {
    await this.ratingsService.recalculateForCompany(companyId);
    return { message: `Rating recalculated for company ${companyId}` };
  }

  private async writeAudit(
    event_type: string,
    actor_id: string,
    target_id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ event_type, actor_id, target_id, target_type: 'user', payload }),
    );
  }
}
