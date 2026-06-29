import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingDto } from './dto/search-listing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

@Controller('listings')
@UseGuards(JwtAuthGuard)
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post()
  create(@Body() dto: CreateListingDto, @Request() req: { user: User }) {
    return this.listingsService.create(dto, req.user);
  }

  @Get('mine')
  findMine(@Request() req: { user: User }) {
    return this.listingsService.findMine(req.user);
  }

  @Get()
  search(@Query() dto: SearchListingDto, @Request() req: { user: User }) {
    return this.listingsService.search(dto, req.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
    @Request() req: { user: User },
  ) {
    return this.listingsService.update(id, dto, req.user);
  }

  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.deactivate(id, req.user);
  }

  @Post(':id/renew')
  renew(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.renew(id, req.user);
  }
}
