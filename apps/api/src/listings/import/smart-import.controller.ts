import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Segment } from '@tyreterra/tire-size';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { User } from '../../auth/entities/user.entity';
import { MAX_FILE_BYTES } from './file-reader';
import { AnalyzeImportDto, CommitImportDto, PreviewImportDto } from './import.dto';
import { SmartImportService } from './smart-import.service';
import { UserThrottlerGuard } from './user-throttler.guard';

// The upload stays in memory (never on disk) and is dropped with the request
const upload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 256 * 1024 },
});

@Controller('listings/import')
@UseGuards(JwtAuthGuard, UserThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class SmartImportController {
  constructor(private readonly service: SmartImportService) {}

  @Post('analyze')
  @HttpCode(200)
  @UseInterceptors(upload)
  analyze(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AnalyzeImportDto,
    @Request() req: { user: User },
  ) {
    return this.service.analyze(file, req.user, { segment: dto.segment as Segment, sheet: dto.sheet, header_row: dto.header_row });
  }

  // multipart: file + `options` (JSON of PreviewImportDto)
  @Post('preview')
  @HttpCode(200)
  @UseInterceptors(upload)
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @Body('options') options: string,
    @Request() req: { user: User },
  ) {
    let raw: unknown;
    try {
      raw = JSON.parse(options ?? '');
    } catch {
      throw new BadRequestException('options must be JSON');
    }
    const dto = plainToInstance(PreviewImportDto, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? { [e.property]: `${e.property} is invalid` })));
    }
    return this.service.preview(file, req.user, dto);
  }

  @Post('commit')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  commit(@Body() dto: CommitImportDto, @Request() req: { user: User }) {
    return this.service.commit(dto, req.user);
  }

  @Get('batches')
  batches(@Request() req: { user: User }) {
    return this.service.recentBatches(req.user);
  }

  @Post('batches/:id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.service.undo(id, req.user);
  }
}
