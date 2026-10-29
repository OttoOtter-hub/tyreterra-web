import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ListingExpiryNotifier } from './listing-expiry-notifier.service';
import { Listing } from './entities/listing.entity';
import { EmailService } from '../common/email/email.service';

describe('ListingExpiryNotifier', () => {
  const NOW = new Date('2026-11-01T03:00:00Z');
  let find: jest.Mock;
  let update: jest.Mock;
  let email: { sendToCompany: jest.Mock; link: jest.Mock };
  let notifier: ListingExpiryNotifier;

  beforeEach(() => {
    find = jest.fn().mockResolvedValue([]);
    update = jest.fn().mockResolvedValue({ affected: 1 });
    email = {
      sendToCompany: jest.fn().mockResolvedValue(true),
      link: jest.fn((path: string) => `https://app.test${path}`),
    };
    notifier = new ListingExpiryNotifier(
      { find, update } as unknown as Repository<Listing>,
      email as unknown as EmailService,
    );
    notifier.pauseMs = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // TypeORM FindOperators expose their pieces; this pulls out the query window
  const whereOf = () => find.mock.calls[0][0].where;

  it('looks for active, not deleted, not yet reminded listings expiring within 3 days', async () => {
    await notifier.notifyExpiringSoon(NOW);
    const where = whereOf();
    expect(where.status).toBe('active');
    expect(where.deleted_at.type).toBe('isNull');
    expect(where.expiry_reminder_sent_at.type).toBe('isNull');
    const [after, until] = where.expires_at.value;
    expect(after.type).toBe('moreThan');
    expect(after.value).toEqual(NOW);
    expect(until.type).toBe('lessThanOrEqual');
    expect(until.value).toEqual(new Date('2026-11-04T03:00:00Z'));
  });

  it('sends one email per company with the listing count and marks those listings', async () => {
    find.mockResolvedValue([
      { id: 'l1', company_id: 'c1' },
      { id: 'l2', company_id: 'c1' },
      { id: 'l3', company_id: 'c2' },
    ]);

    await expect(notifier.notifyExpiringSoon(NOW)).resolves.toBe(2);

    expect(email.sendToCompany).toHaveBeenCalledTimes(2);
    const [cid, kind, content] = email.sendToCompany.mock.calls[0];
    expect([cid, kind]).toEqual(['c1', 'listings-expiring']);
    expect(content.text).toContain('2 of your listings expire');
    expect(content.text).toContain('https://app.test/listings');

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0].id.value).toEqual(['l1', 'l2']);
    expect(update.mock.calls[0][1]).toEqual({ expiry_reminder_sent_at: NOW });
    expect(update.mock.calls[1][0].id.value).toEqual(['l3']);
  });

  it('does not mark listings when sending failed, so the next run retries', async () => {
    find.mockResolvedValue([{ id: 'l1', company_id: 'c1' }, { id: 'l2', company_id: 'c2' }]);
    email.sendToCompany.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(notifier.notifyExpiringSoon(NOW)).resolves.toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].id.value).toEqual(['l2']);
  });

  it('expired: queries listings past expires_at without an expired notice and marks them', async () => {
    find.mockResolvedValue([{ id: 'l9', company_id: 'c3' }]);

    await expect(notifier.notifyExpired(NOW)).resolves.toBe(1);

    const where = whereOf();
    expect(where.expired_notice_sent_at.type).toBe('isNull');
    expect(where.expires_at.type).toBe('lessThanOrEqual');
    expect(where.expires_at.value).toEqual(NOW);
    expect(email.sendToCompany.mock.calls[0][1]).toBe('listings-expired');
    expect(email.sendToCompany.mock.calls[0][2].text).toContain('1 of your listings has expired');
    expect(update.mock.calls[0][1]).toEqual({ expired_notice_sent_at: NOW });
  });

  it('sends nothing when there is nothing to report', async () => {
    await notifier.run();
    expect(email.sendToCompany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('run() never throws, even if the database query fails', async () => {
    find.mockRejectedValue(new Error('db down'));
    await expect(notifier.run()).resolves.toBeUndefined();
  });
});
