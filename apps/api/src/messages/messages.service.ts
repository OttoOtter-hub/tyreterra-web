import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { Deal } from '../deals/entities/deal.entity';
import { User } from '../auth/entities/user.entity';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  async send(dealId: string, dto: CreateMessageDto, sender: User): Promise<Message> {
    const deal = await this.loadDeal(dealId);
    this.assertParticipant(deal, sender);

    return this.messageRepo.save(
      this.messageRepo.create({
        deal_id: dealId,
        sender_company_id: sender.company_id!,
        body: dto.body ?? null,
      }),
    );
  }

  async sendFile(
    dealId: string,
    file: Express.Multer.File,
    body: string | undefined,
    sender: User,
  ): Promise<Message> {
    const deal = await this.loadDeal(dealId);
    this.assertParticipant(deal, sender);

    const file_url = `/uploads/${file.filename}`;

    return this.messageRepo.save(
      this.messageRepo.create({
        deal_id: dealId,
        sender_company_id: sender.company_id!,
        body: body || null,
        file_url,
        file_name: file.originalname,
      }),
    );
  }

  async findAll(dealId: string, viewer: User): Promise<Message[]> {
    const deal = await this.loadDeal(dealId);
    this.assertParticipant(deal, viewer);

    return this.messageRepo.find({
      where: { deal_id: dealId },
      order: { created_at: 'ASC' },
    });
  }

  private async loadDeal(dealId: string): Promise<Deal> {
    const deal = await this.dealRepo.findOne({
      where: { id: dealId },
      relations: ['offer', 'offer.request', 'offer.request.listing'],
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  // Only seller company or buyer company can read/write messages (§7.3)
  private assertParticipant(deal: Deal, user: User): void {
    const request = deal.offer?.request;
    if (!request) throw new NotFoundException('Deal has no associated request');

    const sellerCompanyId = request.listing?.company_id;
    const buyerCompanyId = request.buyer_company_id;

    if (user.company_id !== sellerCompanyId && user.company_id !== buyerCompanyId) {
      throw new ForbiddenException('You are not a participant in this deal');
    }
  }
}
