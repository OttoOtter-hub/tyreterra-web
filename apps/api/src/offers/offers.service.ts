import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Offer, OfferStatus } from './entities/offer.entity';
import { Request as TireRequest, RequestStatus } from '../requests/entities/request.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../auth/entities/user.entity';
import { EncryptionService } from '../common/encryption.service';
import { EmailService } from '../common/email.service';
import { CreateOfferDto } from './dto/create-offer.dto';

export interface RevealedContact {
  company_name: string;
  email: string | null;
  phone: string | null;
}

export interface DealResult {
  deal_id: string;
  seller: RevealedContact;
  buyer: RevealedContact;
}

@Injectable()
export class OffersService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(TireRequest)
    private readonly requestRepo: Repository<TireRequest>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly encryption: EncryptionService,
    private readonly email: EmailService,
    private readonly dataSource: DataSource,
  ) {}

  // Seller sends offer on a pending request
  async sendOffer(requestId: string, dto: CreateOfferDto, seller: User): Promise<Offer> {
    const request = await this.loadRequest(requestId);
    this.assertSeller(request, seller);

    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(`Cannot offer on a request with status "${request.status}"`);
    }
    if (request.offer) {
      throw new ConflictException('An offer already exists for this request');
    }

    const price_encrypted = this.encryption.encrypt(String(dto.price));

    const offer = await this.dataSource.transaction(async (em) => {
      const saved = await em.save(
        em.create(Offer, {
          request_id: requestId,
          price_encrypted,
          currency: dto.currency ?? 'EUR',
          terms_text: dto.terms_text ?? null,
          status: OfferStatus.PENDING,
        }),
      );
      await em.update(TireRequest, requestId, { status: RequestStatus.OFFERED });
      return saved;
    });

    await this.audit('offer.sent', seller.id, offer.id, { request_id: requestId });

    // Notify buyer
    const buyerCompany = await this.companyRepo.findOneBy({ id: request.buyer_company_id });
    const buyerEmail = buyerCompany?.contact_email_encrypted
      ? this.encryption.decrypt(buyerCompany.contact_email_encrypted)
      : null;
    if (buyerEmail) {
      await this.email.sendOfferReceived(buyerEmail, request.listing?.size_raw ?? '');
    }

    return offer;
  }

  // Seller declines a request
  async declineRequest(requestId: string, seller: User): Promise<TireRequest> {
    const request = await this.loadRequest(requestId);
    this.assertSeller(request, seller);

    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(`Cannot decline a request with status "${request.status}"`);
    }

    request.status = RequestStatus.REJECTED;
    const saved = await this.requestRepo.save(request);
    await this.audit('request.declined', seller.id, requestId, {});

    return saved;
  }

  // Buyer views offer (decrypted price)
  async getOffer(requestId: string, buyer: User): Promise<Offer & { price: number }> {
    const request = await this.loadRequest(requestId);
    if (request.buyer_company_id !== buyer.company_id) throw new ForbiddenException();
    if (!request.offer) throw new NotFoundException('No offer yet');

    const price = parseFloat(this.encryption.decrypt(request.offer.price_encrypted));
    return { ...request.offer, price };
  }

  // Buyer accepts → creates Deal, reveals contacts (§7.2)
  async acceptOffer(requestId: string, buyer: User): Promise<DealResult> {
    const request = await this.loadRequest(requestId);
    if (request.buyer_company_id !== buyer.company_id) throw new ForbiddenException();
    if (!request.offer) throw new NotFoundException('No offer to accept');
    if (request.offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(`Offer is already "${request.offer.status}"`);
    }
    if (request.status !== RequestStatus.OFFERED) {
      throw new BadRequestException(`Request status is "${request.status}"`);
    }

    const now = new Date();

    const deal = await this.dataSource.transaction(async (em) => {
      await em.update(Offer, request.offer!.id, { status: OfferStatus.ACCEPTED });
      await em.update(TireRequest, requestId, { status: RequestStatus.ACCEPTED });
      return em.save(em.create(Deal, {
        offer_id: request.offer!.id,
        accepted_at: now,
        contact_revealed_at: now,
      }));
    });

    await this.audit('offer.accepted', buyer.id, request.offer.id, { deal_id: deal.id });

    // Load companies to reveal contacts
    const [sellerCompany, buyerCompany] = await Promise.all([
      this.companyRepo.findOneBy({ id: request.listing.company_id }),
      this.companyRepo.findOneBy({ id: request.buyer_company_id }),
    ]);

    const result: DealResult = {
      deal_id: deal.id,
      seller: this.revealContact(sellerCompany),
      buyer: this.revealContact(buyerCompany),
    };

    // Email both parties
    const sellerEmail = result.seller.email;
    const buyerEmail = result.buyer.email;
    if (sellerEmail && buyerEmail) {
      await this.email.sendDealAccepted(sellerEmail, buyerEmail, request.listing.size_raw);
    }

    return result;
  }

  // Buyer rejects offer
  async rejectOffer(requestId: string, buyer: User): Promise<TireRequest> {
    const request = await this.loadRequest(requestId);
    if (request.buyer_company_id !== buyer.company_id) throw new ForbiddenException();
    if (!request.offer) throw new NotFoundException('No offer to reject');
    if (request.offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException(`Offer is already "${request.offer.status}"`);
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(Offer, request.offer!.id, { status: OfferStatus.REJECTED });
      await em.update(TireRequest, requestId, { status: RequestStatus.REJECTED });
    });

    await this.audit('offer.rejected', buyer.id, request.offer.id, {});
    return this.requestRepo.findOneOrFail({ where: { id: requestId } });
  }

  private async loadRequest(requestId: string): Promise<TireRequest> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['listing', 'offer', 'offer.deal'],
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private assertSeller(request: TireRequest, seller: User): void {
    if (request.listing.company_id !== seller.company_id) throw new ForbiddenException();
  }

  private revealContact(company: Company | null): RevealedContact {
    return {
      company_name: company?.name ?? '',
      email: company?.contact_email_encrypted
        ? this.encryption.decrypt(company.contact_email_encrypted)
        : null,
      phone: company?.contact_phone_encrypted
        ? this.encryption.decrypt(company.contact_phone_encrypted)
        : null,
    };
  }

  private async audit(
    event_type: string,
    actor_id: string,
    target_id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ event_type, actor_id, target_id, target_type: 'offer', payload }),
    );
  }
}
