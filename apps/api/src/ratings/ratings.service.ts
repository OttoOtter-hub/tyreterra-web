import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Rating } from './entities/rating.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Request as TireRequest, RequestStatus } from '../requests/entities/request.entity';

const MIN_INTERACTIONS = 5; // below this → score = null ("New member") (§8)
const RESPONSE_WINDOW_HOURS = 48;

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    @InjectRepository(TireRequest)
    private readonly requestRepo: Repository<TireRequest>,
  ) {}

  // Runs nightly at 02:00 UTC (§14.10)
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async recalculateAll(): Promise<void> {
    this.logger.log('Starting nightly rating recalculation');

    // Collect all company IDs that have ever been a seller (had listings with requests)
    const sellerIds: { company_id: string }[] = await this.requestRepo
      .createQueryBuilder('req')
      .innerJoin('req.listing', 'l')
      .select('DISTINCT l.company_id', 'company_id')
      .getRawMany();

    let updated = 0;
    for (const { company_id } of sellerIds) {
      await this.recalculateForCompany(company_id);
      updated++;
    }

    this.logger.log(`Rating recalculation done — ${updated} companies updated`);
  }

  async recalculateForCompany(company_id: string): Promise<Rating> {
    // All requests directed at this seller's listings
    const allRequests = await this.requestRepo
      .createQueryBuilder('req')
      .innerJoin('req.listing', 'l')
      .where('l.company_id = :cid', { cid: company_id })
      .leftJoinAndSelect('req.offer', 'offer')
      .leftJoinAndSelect('offer.deal', 'deal')
      .getMany();

    const totalRequests = allRequests.length;
    if (totalRequests === 0) {
      return this.upsertRating(company_id, 0, 0, 0, 0, null);
    }

    // Response rate: % requests answered (offered OR rejected) within 48 h
    const responded = allRequests.filter((r) => {
      if (![RequestStatus.OFFERED, RequestStatus.REJECTED].includes(r.status) &&
          r.status !== RequestStatus.ACCEPTED && r.status !== RequestStatus.CANCELLED) {
        return false;
      }
      const updatedAt = (r as unknown as { updated_at: Date }).updated_at;
      if (!updatedAt) return r.status !== RequestStatus.PENDING;
      const hoursElapsed =
        (updatedAt.getTime() - r.created_at.getTime()) / 3_600_000;
      return hoursElapsed <= RESPONSE_WINDOW_HOURS;
    });
    const response_rate = responded.length / totalRequests;

    // Offers sent (requests that reached OFFERED, ACCEPTED, or beyond)
    const offersSent = allRequests.filter((r) =>
      [RequestStatus.OFFERED, RequestStatus.ACCEPTED, RequestStatus.REJECTED].includes(r.status),
    );

    // Accept rate: % of sent offers that were accepted
    const offersAccepted = allRequests.filter((r) => r.status === RequestStatus.ACCEPTED);
    const accept_rate = offersSent.length > 0 ? offersAccepted.length / offersSent.length : 0;

    // Cancellation rate: deals cancelled after accept (not tracked yet in MVP — defaults to 0)
    // Will be wired when cancel-deal flow is added post-MVP
    const cancel_rate = 0;

    // interaction_count = total number of requests handled (offered or declined)
    const interaction_count = offersSent.length + allRequests.filter(
      (r) => r.status === RequestStatus.REJECTED,
    ).length;

    const score = this.computeScore(
      interaction_count,
      response_rate,
      accept_rate,
      cancel_rate,
    );

    return this.upsertRating(company_id, response_rate, accept_rate, cancel_rate, interaction_count, score);
  }

  private computeScore(
    interaction_count: number,
    response_rate: number,
    accept_rate: number,
    cancel_rate: number,
  ): number | null {
    if (interaction_count < MIN_INTERACTIONS) return null;

    // Weighted formula (§8)
    const raw =
      response_rate * 2.0 +   // highest weight: responding within 48 h
      accept_rate    * 1.5 +   // offer acceptance
      (1 - cancel_rate) * 1.0; // penalise cancellations

    // Map 0–4.5 → 1–5 stars, rounded to nearest 0.5
    const normalised = 1 + (raw / 4.5) * 4;
    return Math.round(Math.max(1, Math.min(5, normalised)) * 2) / 2;
  }

  private async upsertRating(
    company_id: string,
    response_rate: number,
    accept_rate: number,
    cancel_rate: number,
    interaction_count: number,
    score: number | null,
  ): Promise<Rating> {
    let rating = await this.ratingRepo.findOneBy({ company_id });
    if (!rating) {
      rating = this.ratingRepo.create({ company_id });
    }
    Object.assign(rating, { response_rate, accept_rate, cancel_rate, interaction_count, score });
    return this.ratingRepo.save(rating);
  }
}
