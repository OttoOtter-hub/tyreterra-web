import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Listing } from './entities/listing.entity';
import { Company } from '../companies/entities/company.entity';

const COLS = [
  { key: 'sku',            header: 'SKU',              width: 18 },
  { key: 'segment',        header: 'Segment',           width: 8  },
  { key: 'tire_type',      header: 'Type',              width: 14 },
  { key: 'brand',          header: 'Brand',             width: 16 },
  { key: 'size_raw',       header: 'Size',              width: 14 },
  { key: 'pattern',        header: 'Pattern',           width: 16 },
  { key: 'load_index',     header: 'Load Index',        width: 14 },
  { key: 'origin_country', header: 'Origin Country',   width: 16 },
  { key: 'dot_code',       header: 'Year',              width: 8  },
  { key: 'qty',            header: 'Qty',               width: 8  },
  { key: 'condition',      header: 'Condition',         width: 12 },
  { key: 'location_country', header: 'Location',       width: 10 },
  { key: 'location_region',  header: 'Region',         width: 16 },
  { key: 'status',         header: 'Status',            width: 10 },
  { key: 'expires_at',     header: 'Expires',           width: 14 },
  { key: 'created_at',     header: 'Created',           width: 14 },
];

const ADMIN_COLS = [
  { key: 'company_name', header: 'Company', width: 24 },
  ...COLS,
];

@Injectable()
export class ListingsExportService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  async exportForUser(companyId: string): Promise<Buffer> {
    const listings = await this.listingRepo.find({
      where: { company_id: companyId },
      order: { created_at: 'DESC' },
    });
    return this.buildWorkbook(listings, COLS, false);
  }

  async exportAll(): Promise<Buffer> {
    const listings = await this.listingRepo.find({
      relations: ['company'],
      order: { created_at: 'DESC' },
    });
    return this.buildWorkbook(listings, ADMIN_COLS, true);
  }

  async buildTemplate(): Promise<Buffer> {
    return this.buildWorkbook([], COLS, false, true);
  }

  private async buildWorkbook(
    listings: Listing[],
    cols: typeof COLS,
    includeCompany: boolean,
    isTemplate = false,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TyreTerra';
    const ws = wb.addWorksheet('Listings');

    ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };
    headerRow.alignment = { vertical: 'middle' };
    headerRow.height = 20;

    if (isTemplate) {
      // Add one example row
      ws.addRow({
        sku: 'MY-SKU-001',
        segment: 'TBR',
        tire_type: 'steer',
        brand: 'Michelin',
        size_raw: '315/80R22.5',
        pattern: 'X Multi D',
        load_index: '173D/178A8',
        origin_country: 'FR',
        dot_code: '2023',
        qty: 50,
        condition: 'new',
        location_country: 'DE',
        location_region: '',
        status: 'active',
        expires_at: '',
        created_at: '',
      });
      // Light yellow bg for example row
      const exRow = ws.getRow(2);
      exRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
    }

    for (const l of listings) {
      const row: Record<string, unknown> = {
        sku: l.sku ?? '',
        segment: l.segment,
        tire_type: l.tire_type ?? '',
        brand: l.brand,
        size_raw: l.size_raw,
        pattern: l.pattern ?? '',
        load_index: l.load_index ?? '',
        origin_country: l.origin_country ?? '',
        dot_code: l.dot_code ?? '',
        qty: l.qty,
        condition: l.condition,
        location_country: l.location_country,
        location_region: l.location_region ?? '',
        status: l.status,
        expires_at: l.expires_at ? new Date(l.expires_at).toLocaleDateString() : '',
        created_at: l.created_at ? new Date(l.created_at).toLocaleDateString() : '',
      };
      if (includeCompany) {
        row.company_name = (l as unknown as { company?: { name?: string } }).company?.name ?? '';
      }
      ws.addRow(row);
    }

    // Alternating row colors
    ws.eachRow((row, rowNum) => {
      if (rowNum > 1) {
        if (rowNum % 2 === 0) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFF' } };
        }
        row.border = {
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      }
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
