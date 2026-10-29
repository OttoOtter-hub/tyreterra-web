import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Listing, ListingStatus } from './entities/listing.entity';
import { EmailService } from '../common/email/email.service';
import { listingsExpiredEmail, listingsExpiringEmail } from '../common/email/email-templates';

const REMINDER_WINDOW_DAYS = 3;

// Nightly emails to sellers about listings that expire within 3 days or have
// expired. One email per company per run (a count, not a list), and each
// listing is mailed about at most once per expiry: expiry_reminder_sent_at /
// expired_notice_sent_at are set only after a successful send, and cleared
// when the listing is renewed or re-activated.
@Injectable()
export class ListingExpiryNotifier {
  private readonly logger = new Logger(ListingExpiryNotifier.name);
  // Spacing between companies, to stay under Resend's per-second rate limit
  pauseMs = 600;

  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    private readonly email: EmailService,
  ) {}

  // 03:00, after the ratings recalculation at 02:00
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      const now = new Date();
      const reminded = await this.notifyExpiringSoon(now);
      const expired = await this.notifyExpired(now);
      this.logger.log(`Listing expiry emails — expiring soon: ${reminded} companies, expired: ${expired} companies`);
    } catch (err) {
      this.logger.error(`Listing expiry job failed: ${(err as Error)?.message ?? err}`);
    }
  }

  async notifyExpiringSoon(now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86_400_000);
    const listings = await this.listingRepo.find({
      where: {
        status: ListingStatus.ACTIVE,
        deleted_at: IsNull(),
        expiry_reminder_sent_at: IsNull(),
        expires_at: And(MoreThan(now), LessThanOrEqual(horizon)),
      },
      select: { id: true, company_id: true },
    });
    return this.notifyByCompany(listings, 'listings-expiring', listingsExpiringEmail, {
      expiry_reminder_sent_at: now,
    });
  }

  async notifyExpired(now: Date): Promise<number> {
    const listings = await this.listingRepo.find({
      where: {
        status: ListingStatus.ACTIVE,
        deleted_at: IsNull(),
        expired_notice_sent_at: IsNull(),
        expires_at: LessThanOrEqual(now),
      },
      select: { id: true, company_id: true },
    });
    return this.notifyByCompany(listings, 'listings-expired', listingsExpiredEmail, {
      expired_notice_sent_at: now,
    });
  }

  // Returns the number of companies successfully emailed
  private async notifyByCompany(
    listings: Pick<Listing, 'id' | 'company_id'>[],
    kind: string,
    template: typeof listingsExpiringEmail,
    mark: Partial<Pick<Listing, 'expiry_reminder_sent_at' | 'expired_notice_sent_at'>>,
  ): Promise<number> {
    const byCompany = new Map<string, string[]>();
    for (const l of listings) {
      const ids = byCompany.get(l.company_id) ?? [];
      ids.push(l.id);
      byCompany.set(l.company_id, ids);
    }

    let sent = 0;
    let first = true;
    for (const [companyId, ids] of byCompany) {
      if (!first) await this.pause();
      first = false;
      const ok = await this.email.sendToCompany(
        companyId,
        kind,
        template(ids.length, this.email.link('/listings')),
      );
      // Not marked on failure, so the next night tries again
      if (!ok) continue;
      await this.listingRepo.update({ id: In(ids) }, mark);
      sent++;
    }
    return sent;
  }

  private pause(): Promise<void> {
    return this.pauseMs > 0 ? new Promise((r) => setTimeout(r, this.pauseMs)) : Promise.resolve();
  }
}
