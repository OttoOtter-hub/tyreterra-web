import { Controller, Post, Get, Body, Param, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

// All offer actions are scoped to a request ID
@Controller('requests/:requestId')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // Seller: send offer
  @Post('offer')
  sendOffer(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: CreateOfferDto,
    @Request() req: { user: User },
  ) {
    return this.offersService.sendOffer(requestId, dto, req.user);
  }

  // Seller: decline request
  @Post('decline')
  decline(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: User },
  ) {
    return this.offersService.declineRequest(requestId, req.user);
  }

  // Buyer: view offer (with decrypted price)
  @Get('offer')
  getOffer(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: User },
  ) {
    return this.offersService.getOffer(requestId, req.user);
  }

  // Buyer: accept offer → creates deal, reveals contacts
  @Post('offer/accept')
  accept(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: User },
  ) {
    return this.offersService.acceptOffer(requestId, req.user);
  }

  // Buyer: reject offer
  @Post('offer/reject')
  reject(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: { user: User },
  ) {
    return this.offersService.rejectOffer(requestId, req.user);
  }
}
