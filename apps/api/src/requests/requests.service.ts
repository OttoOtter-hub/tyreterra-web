import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, RequestStatus } from './entities/request.entity';
import { Listing, ListingStatus } from '../listings/entities/listing.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../auth/entities/user.entity';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(Request)
    private readonly requestRepo: Repository<Request>,
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async create(dto: CreateRequestDto, buyer: User): Promise<Request> {
    if (!buyer.company_id) throw new ForbiddenException('No company associated');

    const listing = await this.listingRepo.findOneBy({ id: dto.listing_id });
    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new NotFoundException('Listing not found or not active');
    }
    if (listing.company_id === buyer.company_id) {
      throw new BadRequestException('Cannot request your own listing');
    }

    const existing = await this.requestRepo.findOne({
      where: {
        listing_id: dto.listing_id,
        buyer_company_id: buyer.company_id,
        status: RequestStatus.PENDING,
      },
    });
    if (existing) throw new BadRequestException('You already have a pending request for this listing');

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        listing_id: dto.listing_id,
        buyer_company_id: buyer.company_id,
        qty_requested: dto.qty_requested,
        comment: dto.comment ?? null,
        status: RequestStatus.PENDING,
      }),
    );

    await this.audit('request.created', buyer.id, request.id, {
      listing_id: listing.id, qty: dto.qty_requested,
    });

    return request;
  }

  // Incoming requests — seller sees requests on their listings
  async findIncoming(seller: User): Promise<Request[]> {
    if (!seller.company_id) return [];
    return this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.listing', 'l')
      .where('l.company_id = :cid', { cid: seller.company_id })
      .andWhere('r.status != :cancelled', { cancelled: RequestStatus.CANCELLED })
      .leftJoinAndSelect('r.listing', 'listing')
      .orderBy('r.created_at', 'DESC')
      .getMany();
  }

  // Outgoing requests — buyer sees their own requests
  async findOutgoing(buyer: User): Promise<Request[]> {
    if (!buyer.company_id) return [];
    return this.requestRepo.find({
      where: { buyer_company_id: buyer.company_id },
      relations: ['listing', 'offer'],
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Request> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['listing', 'offer', 'offer.deal'],
    });
    if (!request) throw new NotFoundException('Request not found');
    this.assertAccess(request, user);
    return request;
  }

  async cancel(id: string, buyer: User): Promise<Request> {
    const request = await this.requestRepo.findOneBy({ id });
    if (!request) throw new NotFoundException('Request not found');
    if (request.buyer_company_id !== buyer.company_id) throw new ForbiddenException();
    if (![RequestStatus.PENDING, RequestStatus.OFFERED].includes(request.status)) {
      throw new BadRequestException(`Cannot cancel a request with status "${request.status}"`);
    }

    request.status = RequestStatus.CANCELLED;
    const saved = await this.requestRepo.save(request);
    await this.audit('request.cancelled', buyer.id, id, {});
    return saved;
  }

  private assertAccess(request: Request, user: User): void {
    const isbuyer = request.buyer_company_id === user.company_id;
    const isSeller = request.listing?.company_id === user.company_id;
    if (!isbuyer && !isSeller) throw new ForbiddenException();
  }

  private async audit(
    event_type: string,
    actor_id: string,
    target_id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ event_type, actor_id, target_id, target_type: 'request', payload }),
    );
  }
}
