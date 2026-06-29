import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Listing, ListingStatus, TireSegment, TireCondition, AllowedRoles } from './entities/listing.entity';
import { User } from '../auth/entities/user.entity';
import { parseTireSize, TireSizeParseError } from '../common/tire-size.parser';

const VALID_SEGMENTS = Object.values(TireSegment) as string[];
const VALID_CONDITIONS = Object.values(TireCondition) as string[];

@Injectable()
export class ListingsImportService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
  ) {}

  async importFromBuffer(
    buffer: Buffer,
    user: User,
  ): Promise<{ imported: number; skipped: number; errors: { row: number; message: string }[] }> {
    if (!user.company_id) throw new BadRequestException('No company associated');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Empty workbook');

    // Read header row
    const headers: string[] = [];
    ws.getRow(1).eachCell(cell => headers.push(String(cell.value ?? '').toLowerCase().trim().replace(/\s+/g, '_')));

    // Returns 1-based column index, or 0 if not found (safe: ExcelJS getCell(0) returns empty cell-like object we handle via nullish)
    const col = (name: string): number => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? idx + 1 : 0;
    };

    const getStr = (row: ExcelJS.Row, colIdx: number): string => {
      if (colIdx === 0) return '';
      const cell = row.getCell(colIdx);
      return cell?.value == null ? '' : String(cell.value).trim();
    };

    const toStr = (cell: ExcelJS.Cell): string =>
      cell?.value == null ? '' : String(cell.value).trim();

    const errors: { row: number; message: string }[] = [];
    const toCreate: Partial<Listing>[] = [];

    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);

    let dataRowCount = 0;
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header

      const segment = getStr(row, col('segment')).toUpperCase();
      const size    = getStr(row, col('size'));
      const brand   = getStr(row, col('brand'));
      const qtyStr  = getStr(row, col('qty'));
      const condition = getStr(row, col('condition')).toLowerCase();
      const location_country = (getStr(row, col('location_country')) || getStr(row, col('location'))).toUpperCase();

      // Skip entirely empty rows
      if (!segment && !size && !brand && !qtyStr) return;
      dataRowCount++;

      if (!VALID_SEGMENTS.includes(segment)) {
        errors.push({ row: rowNum, message: `Invalid segment "${segment}". Valid: ${VALID_SEGMENTS.join(', ')}` });
        throw new BadRequestException(JSON.stringify(errors));
      }
      if (!brand) {
        errors.push({ row: rowNum, message: 'Brand is required' });
        throw new BadRequestException(JSON.stringify(errors));
      }
      if (!size) {
        errors.push({ row: rowNum, message: 'Size is required' });
        throw new BadRequestException(JSON.stringify(errors));
      }
      if (!VALID_CONDITIONS.includes(condition)) {
        errors.push({ row: rowNum, message: `Invalid condition "${condition}". Valid: ${VALID_CONDITIONS.join(', ')}` });
        throw new BadRequestException(JSON.stringify(errors));
      }
      if (!location_country || location_country.length !== 2) {
        errors.push({ row: rowNum, message: 'Location country must be a 2-letter ISO code (e.g. DE)' });
        throw new BadRequestException(JSON.stringify(errors));
      }
      const qty = parseInt(qtyStr, 10);
      if (isNaN(qty) || qty < 1) {
        errors.push({ row: rowNum, message: `Invalid qty "${qtyStr}"` });
        throw new BadRequestException(JSON.stringify(errors));
      }

      let parsed;
      try {
        parsed = parseTireSize(size);
      } catch (e) {
        const msg = e instanceof TireSizeParseError ? e.message : 'Invalid size format';
        errors.push({ row: rowNum, message: msg });
        throw new BadRequestException(JSON.stringify(errors));
      }

      toCreate.push({
        company_id: user.company_id!,
        segment: segment as TireSegment,
        tire_type: getStr(row, col('type')) || null,
        brand,
        sku: getStr(row, col('sku')) || null,
        size_format: parsed.format,
        size_width: parsed.size_width,
        size_aspect_ratio: parsed.size_aspect_ratio,
        size_construction: parsed.size_construction,
        size_rim: parsed.size_rim,
        size_raw: parsed.size_raw,
        pattern: getStr(row, col('pattern')) || null,
        load_index: getStr(row, col('load_index')) || null,
        origin_country: getStr(row, col('origin_country')) || null,
        dot_code: getStr(row, col('year')) || null,
        qty,
        condition: condition as TireCondition,
        location_country,
        location_region: getStr(row, col('region')) || null,
        status: ListingStatus.ACTIVE,
        allowed_roles: AllowedRoles.ALL,
        exclude_own_region: false,
        expires_at,
      });
    });

    if (dataRowCount === 0) throw new BadRequestException('No data rows found');

    const saved = await this.listingRepo.save(toCreate.map(d => this.listingRepo.create(d)));
    return { imported: saved.length, skipped: 0, errors: [] };
  }
}
