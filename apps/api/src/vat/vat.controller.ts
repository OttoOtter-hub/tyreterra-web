import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { VatService } from './vat.service';
import { VatCheckDto } from './dto/vat-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('vat')
@UseGuards(JwtAuthGuard)
export class VatController {
  constructor(private readonly vatService: VatService) {}

  @Post('check')
  check(@Body() dto: VatCheckDto) {
    return this.vatService.checkVat(dto.countryCode, dto.vatNumber);
  }
}
