import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deal, DealStatus } from './entities/deal.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class DealsService {
  constructor(
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  // Lists all deals the user is a participant in (as buyer or seller)
  async findMine(user: User): Promise<Deal[]> {
    if (!user.company_id) return [];

    return this.dealRepo
      .createQueryBuilder('d')
      .innerJoin('d.offer', 'o')
      .innerJoin('o.request', 'req')
      .innerJoin('req.listing', 'l')
      .where('req.buyer_company_id = :cid OR l.company_id = :cid', { cid: user.company_id })
      .leftJoinAndSelect('d.offer', 'offer')
      .leftJoinAndSelect('offer.request', 'request')
      .leftJoinAndSelect('request.listing', 'listing')
      .leftJoinAndSelect('listing.company', 'seller_company')
      .leftJoinAndSelect('request.buyer_company', 'buyer_company')
      .orderBy('d.accepted_at', 'DESC')
      .getMany();
  }

  async findOne(id: string, viewer: User): Promise<Deal> {
    const deal = await this.dealRepo.findOne({
      where: { id },
      relations: [
        'offer', 'offer.request', 'offer.request.listing',
        'offer.request.listing.company', 'offer.request.buyer_company',
        'messages',
      ],
    });
    if (!deal) throw new NotFoundException('Deal not found');
    this.assertParticipant(deal, viewer);
    return deal;
  }

  async confirmReceipt(id: string, user: User): Promise<Deal> {
    const deal = await this.dealRepo.findOne({
      where: { id },
      relations: ['offer', 'offer.request'],
    });
    if (!deal) throw new NotFoundException('Deal not found');

    const buyerCompanyId = deal.offer?.request?.buyer_company_id;
    if (user.company_id !== buyerCompanyId) {
      throw new ForbiddenException('Only the buyer can confirm receipt');
    }
    if (deal.status === DealStatus.COMPLETED) {
      throw new BadRequestException('Deal already completed');
    }

    deal.status = DealStatus.COMPLETED;
    deal.completed_at = new Date();
    return this.dealRepo.save(deal);
  }

  private assertParticipant(deal: Deal, user: User): void {
    const request = deal.offer?.request;
    const sellerCompanyId = request?.listing?.company_id;
    const buyerCompanyId = request?.buyer_company_id;

    if (user.company_id !== sellerCompanyId && user.company_id !== buyerCompanyId) {
      throw new ForbiddenException('You are not a participant in this deal');
    }
  }
}
