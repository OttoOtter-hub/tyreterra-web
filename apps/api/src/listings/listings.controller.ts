import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Request, ParseUUIDPipe, Res, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { IsArray, IsString, IsIn, ArrayMinSize } from 'class-validator';

class BulkActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids: string[];

  @IsIn(['delete', 'deactivate'])
  action: 'delete' | 'deactivate';
}
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ListingsService } from './listings.service';
import { ListingsExportService } from './listings-export.service';
import { ListingsImportService } from './listings-import.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingDto } from './dto/search-listing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

@Controller('listings')
@UseGuards(JwtAuthGuard)
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly exportService: ListingsExportService,
    private readonly importService: ListingsImportService,
  ) {}

  @Post()
  create(@Body() dto: CreateListingDto, @Request() req: { user: User }) {
    return this.listingsService.create(dto, req.user);
  }

  @Get('mine')
  findMine(@Request() req: { user: User }) {
    return this.listingsService.findMine(req.user);
  }

  @Get('export')
  async export(@Request() req: { user: User }, @Res() res: Response) {
    const buf = await this.exportService.exportForUser(req.user.company_id!);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="my-listings.xlsx"',
    });
    res.send(buf);
  }

  @Get('import/template')
  async template(@Res() res: Response) {
    const buf = await this.exportService.buildTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="tyreterra-import-template.xlsx"',
    });
    res.send(buf);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: User },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.importService.importFromBuffer(file.buffer, req.user);
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

  @Post('bulk-action')
  bulkAction(@Body() dto: BulkActionDto, @Request() req: { user: User }) {
    return this.listingsService.bulkAction(dto.ids, dto.action, req.user);
  }

  @Post(':id/deactivate')
  deactivateOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.deactivate(id, req.user);
  }

  @Delete(':id')
  hardDelete(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.hardDelete(id, req.user);
  }

  @Post(':id/renew')
  renew(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.listingsService.renew(id, req.user);
  }
}
