import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  create(@Body() dto: CreateRequestDto, @Request() req: { user: User }) {
    return this.requestsService.create(dto, req.user);
  }

  @Get('incoming')
  incoming(@Request() req: { user: User }) {
    return this.requestsService.findIncoming(req.user);
  }

  @Get('outgoing')
  outgoing(@Request() req: { user: User }) {
    return this.requestsService.findOutgoing(req.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.requestsService.findOne(id, req.user);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.requestsService.cancel(id, req.user);
  }
}
