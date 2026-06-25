import { Injectable, Logger } from '@nestjs/common';

// Stub — wire to SendGrid or Postmark in production (§11)
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendOfferReceived(buyerEmail: string, listingSize: string): Promise<void> {
    this.logger.log(`[EMAIL] Offer received for ${listingSize} → ${buyerEmail}`);
  }

  async sendRequestDeclined(buyerEmail: string, listingSize: string): Promise<void> {
    this.logger.log(`[EMAIL] Request declined for ${listingSize} → ${buyerEmail}`);
  }

  async sendDealAccepted(sellerEmail: string, buyerEmail: string, listingSize: string): Promise<void> {
    this.logger.log(`[EMAIL] Deal accepted for ${listingSize} → seller: ${sellerEmail}, buyer: ${buyerEmail}`);
  }
}
