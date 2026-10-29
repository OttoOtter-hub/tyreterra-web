import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ParsedTireSize, Segment, brandKey, sizeSegmentWarning } from '@tyreterra/tire-size';
import { Listing, ListingStatus, TireSegment } from '../entities/listing.entity';
import { ListingSize } from '../entities/listing-size.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { User } from '../../auth/entities/user.entity';
import { EncryptionService } from '../../common/encryption.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { ListingsService } from '../listings.service';
import { additionalSizesOf, parseListingSizes, sizeRows, writeListingSizes } from '../listing-sizes';
import { loadIndexColumns, rimMismatch } from '../listing-rules';
import { ImportBatch, ImportBatchItem, ImportCounts, ImportItemAction, ImportMapping } from './import.entities';
import { FileReadError, MAX_DATA_ROWS, SheetGrid, readSpreadsheet } from './file-reader';
import { ColumnGuess, FieldType, guessColumns, guessHeaderRow, guessSheet, headerSignature } from './columns';
import { BuiltRow, IMPORT_FIELDS, ImportDefaults, ImportRowData, RowAlternative, RowMessage, buildRows } from './rows';
import { toCsv } from './csv';

// Smart import: analyze → preview → commit, plus undo. Nothing is written
// before commit; preview and commit run the same checks (the ones a listing
// created in the form gets), so what the preview promises is what commit does.
// Uploaded files live in memory for the request only; row contents are never logged.

export const UNDO_WINDOW_HOURS = 24;
const INSERT_CHUNK = 500;

export type UpdateMode = 'update' | 'skip_existing';
export type RowStatus = 'ok' | 'warning' | 'error';
export type RowAction = 'new' | 'update' | 'unchanged' | 'skip';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface AnalyzeResult {
  file_type: 'xlsx' | 'csv';
  sheets: { name: string; rows: number }[];
  sheet: string;
  header_row: number;
  header: string[];
  data_rows: number;
  columns: ColumnGuess[];
  /** The company's saved mapping for this header layout was applied */
  saved_mapping: boolean;
  header_signature: string;
}

export interface PlannedRow {
  row: number;
  data: ImportRowData;
  status: RowStatus;
  messages: RowMessage[];
  action: RowAction | null;
  unrecognized?: string | null;
  alternatives?: RowAlternative[];
}

export interface PlanSummary {
  rows: number;
  new: number;
  update: number;
  unchanged: number;
  skip: number;
  errors: number;
  warnings: number;
  /** Active listings of this segment the file does not mention */
  missing: number;
}

export interface PreviewResult {
  rows: PlannedRow[];
  summary: PlanSummary;
  skipped_empty: number;
  /** File-level advice, e.g. the sizes look like another segment */
  hints: string[];
}

export interface CommitInput {
  segment: TireSegment;
  update_mode: UpdateMode;
  rows: { row: number; data: Record<string, unknown>; unrecognized?: string | null }[];
  dry_run?: boolean;
  deactivate_missing?: boolean;
  expected_deactivate?: number;
  header_signature?: string;
  mapping?: Record<string, FieldType>;
  header_row?: number;
}

export interface CommitResult {
  dry_run: boolean;
  batch_id: string | null;
  counts: ImportCounts;
  summary: PlanSummary;
  errors: { row: number; messages: string[] }[];
  /** CSV of the rows that were not imported, with the reasons */
  errors_csv: string | null;
  /** dry_run only: the re-checked rows, for the preview to refresh */
  rows?: Pick<PlannedRow, 'row' | 'status' | 'messages' | 'action'>[];
}

// Listing columns an import may set, by import field. Fields left out of a
// row keep the listing's current value on update.
const SIZE_COLUMNS: (keyof Listing)[] = ['size_format', 'size_width', 'size_aspect_ratio', 'size_construction', 'size_rim', 'size_raw'];
const LOAD_COLUMNS: (keyof Listing)[] = ['load_index_single', 'speed_single', 'load_index_dual', 'speed_dual', 'ply_rating'];
const REQUIRED_COLUMNS: (keyof Listing)[] = ['segment', 'brand', ...SIZE_COLUMNS, 'qty', 'condition', 'location_country'];
const OPTIONAL_COLUMNS: Partial<Record<keyof ImportRowData, (keyof Listing)[]>> = {
  sku: ['sku'],
  tire_type: ['tire_type'],
  pattern: ['pattern'],
  load_index: ['load_index', ...LOAD_COLUMNS],
  origin_country: ['origin_country'],
  dot_code: ['dot_code'],
  location_region: ['location_region'],
  comment: ['comment'],
};
/** Everything undo needs to put an updated listing back */
const SNAPSHOT_COLUMNS: (keyof Listing)[] = [
  ...REQUIRED_COLUMNS,
  ...Object.values(OPTIONAL_COLUMNS).flat(),
  'price_internal_encrypted', 'price_currency', 'status', 'expires_at',
];

interface RowPlan extends PlannedRow {
  dto?: CreateListingDto;
  sizes?: ParsedTireSize[];
  existing?: Listing;
}

@Injectable()
export class SmartImportService {
  constructor(
    @InjectRepository(Listing) private readonly listingRepo: Repository<Listing>,
    @InjectRepository(ListingSize) private readonly sizeRepo: Repository<ListingSize>,
    @InjectRepository(ImportBatch) private readonly batchRepo: Repository<ImportBatch>,
    @InjectRepository(ImportBatchItem) private readonly itemRepo: Repository<ImportBatchItem>,
    @InjectRepository(ImportMapping) private readonly mappingRepo: Repository<ImportMapping>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    private readonly listings: ListingsService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── Step 1–2: what is in the file ─────────────────────────────────────────

  async analyze(
    file: UploadedFile,
    user: User,
    opts: { segment: Segment; sheet?: string; header_row?: number },
  ): Promise<AnalyzeResult> {
    const companyId = this.companyOf(user);
    const book = await this.read(file);
    const sheet = this.pickSheet(book.sheets, opts.sheet ?? guessSheet(book.sheets));
    const headerRow = opts.header_row ?? guessHeaderRow(sheet.rows);
    if (headerRow > sheet.rows.length) throw new BadRequestException('The header row is below the end of the sheet');
    const width = Math.max(0, ...sheet.rows.map((r) => r.length));
    const header = Array.from({ length: width }, (_, i) => (headerRow ? sheet.rows[headerRow - 1][i] ?? '' : '').trim());
    const data = sheet.rows.slice(headerRow);
    this.assertRowLimit(sheet, data.length);

    const columns = guessColumns(header, data, opts.segment);
    const signature = headerSignature(header);
    const saved = headerRow
      ? await this.mappingRepo.findOneBy({ company_id: companyId, header_signature: signature })
      : null;
    const savedColumns = (saved?.mapping as { columns?: Record<string, FieldType> } | undefined)?.columns;
    if (savedColumns) {
      for (const c of columns) {
        const t = savedColumns[String(c.index)];
        if (t) { c.type = t; c.confidence = 1; }
      }
    }
    return {
      file_type: book.type,
      sheets: book.sheets.map((s) => ({ name: s.name, rows: s.rows.length })),
      sheet: sheet.name,
      header_row: headerRow,
      header,
      data_rows: data.length,
      columns,
      saved_mapping: !!savedColumns,
      header_signature: signature,
    };
  }

  // ── Step 3: rows in our model ─────────────────────────────────────────────

  async preview(
    file: UploadedFile,
    user: User,
    opts: {
      segment: TireSegment;
      sheet: string;
      header_row: number;
      mapping: Record<string, FieldType>;
      defaults: ImportDefaults;
      update_mode: UpdateMode;
    },
  ): Promise<PreviewResult> {
    const companyId = this.companyOf(user);
    const book = await this.read(file);
    const sheet = this.pickSheet(book.sheets, opts.sheet);
    if (opts.header_row > sheet.rows.length) throw new BadRequestException('The header row is below the end of the sheet');
    this.assertRowLimit(sheet, sheet.rows.length - opts.header_row);
    const mapping = Object.fromEntries(Object.entries(opts.mapping).map(([k, v]) => [Number(k), v]));
    if (!Object.values(mapping).includes('size')) throw new BadRequestException('Choose the column with the tyre size');

    const built = buildRows(sheet.rows, {
      segment: opts.segment as Segment,
      mapping,
      headerRow: opts.header_row,
      defaults: opts.defaults,
    });
    const { rows, summary, segmentMisfits } = await this.plan(companyId, opts.segment, opts.update_mode, built.rows);

    const hints: string[] = [];
    const readable = rows.filter((r) => r.data.size).length;
    if (readable >= 5 && segmentMisfits / readable >= 0.3) {
      hints.push(
        `${segmentMisfits} of ${readable} sizes look unusual for ${opts.segment}. ` +
        'If the file mixes segments, upload it once per segment (or split it).',
      );
    }
    return { rows, summary, skipped_empty: built.skippedEmpty, hints };
  }

  // ── Step 4: write (or re-check with dry_run) ──────────────────────────────

  async commit(input: CommitInput, user: User): Promise<CommitResult> {
    const companyId = this.companyOf(user);
    const { rows, summary, missing } = await this.plan(companyId, input.segment, input.update_mode, input.rows);
    const errors = rows.filter((r) => r.status === 'error');
    const errorReport = errors.map((r) => ({ row: r.row, messages: r.messages.filter((m) => m.level === 'error').map((m) => m.text) }));
    const errors_csv = errors.length ? this.errorsCsv(errors) : null;
    const counts: ImportCounts = {
      created: summary.new,
      updated: summary.update,
      unchanged: summary.unchanged + summary.skip,
      deactivated: input.deactivate_missing ? missing.length : 0,
      skipped: summary.errors,
    };

    if (input.deactivate_missing && !input.dry_run && input.expected_deactivate !== missing.length) {
      throw new ConflictException(
        `${missing.length} listings would be deactivated, not ${input.expected_deactivate ?? 0}. Re-check the summary and confirm again.`,
      );
    }
    if (input.dry_run) {
      const checked = rows.map(({ row, status, messages, action }) => ({ row, status, messages, action }));
      return { dry_run: true, batch_id: null, counts, summary, errors: errorReport, errors_csv, rows: checked };
    }

    const toCreate = rows.filter((r) => r.status !== 'error' && r.action === 'new');
    const toUpdate = rows.filter((r) => r.status !== 'error' && r.action === 'update');
    const toDeactivate = input.deactivate_missing ? missing : [];

    const batch = await this.listingRepo.manager.transaction(async (m) => {
      const b = await m.save(m.create(ImportBatch, {
        company_id: companyId,
        user_id: user.id,
        segment: input.segment,
        status: 'completed',
        counts,
      }));
      const items: ImportBatchItem[] = [];
      const item = (listing_id: string, action: ImportItemAction, snapshot: Record<string, unknown> | null) =>
        m.create(ImportBatchItem, { batch_id: b.id, listing_id, action, snapshot });

      for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
        const chunk = toCreate.slice(i, i + INSERT_CHUNK);
        const res = await m.insert(Listing, chunk.map((r) => this.listings.buildNewListing(r.dto!, companyId, r.sizes!)));
        const ids = res.identifiers.map((x) => x.id as string);
        await m.insert(ListingSize, chunk.flatMap((r, j) => sizeRows(ids[j], r.sizes!)));
        items.push(...ids.map((id) => item(id, 'created', null)));
      }

      for (const r of toUpdate) {
        const existing = r.existing!;
        items.push(item(existing.id, 'updated', this.snapshot(existing)));
        await m.update(Listing, existing.id, this.updatePatch(r.dto!, r.sizes!, companyId));
        await writeListingSizes(m, existing.id, r.sizes!);
      }

      for (const l of toDeactivate) {
        items.push(item(l.id, 'deactivated', { status: l.status }));
        await m.update(Listing, l.id, { status: ListingStatus.INACTIVE });
      }

      for (let i = 0; i < items.length; i += INSERT_CHUNK) {
        await m.insert(ImportBatchItem, items.slice(i, i + INSERT_CHUNK));
      }
      if (input.header_signature && input.mapping) {
        await this.saveMapping(m, companyId, input.header_signature, input.mapping, input.header_row);
      }
      return b;
    });

    await this.auditRepo.save(this.auditRepo.create({
      event_type: 'listings.imported',
      actor_id: user.id,
      target_id: batch.id,
      target_type: 'import_batch',
      payload: { segment: input.segment, update_mode: input.update_mode, ...counts },
    }));

    return { dry_run: false, batch_id: batch.id, counts, summary, errors: errorReport, errors_csv };
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  async undo(batchId: string, user: User): Promise<{ batch_id: string; restored: number; removed: number }> {
    const companyId = this.companyOf(user);
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch || batch.company_id !== companyId) throw new NotFoundException('Import not found');
    if (batch.status === 'undone') throw new ConflictException('This import was already undone');
    if (Date.now() - batch.created_at.getTime() > UNDO_WINDOW_HOURS * 3600_000) {
      throw new ForbiddenException(`An import can be undone within ${UNDO_WINDOW_HOURS} hours only`);
    }
    const items = await this.itemRepo.findBy({ batch_id: batch.id });
    const ids = items.map((i) => i.listing_id);

    // A later import that touched the same listings has to be undone first,
    // or this undo would overwrite its changes with older ones
    if (ids.length) {
      const later = await this.itemRepo
        .createQueryBuilder('i')
        .innerJoin(ImportBatch, 'b', 'b.id = i.batch_id')
        .where('b.company_id = :companyId', { companyId })
        .andWhere('b.status = :st', { st: 'completed' })
        .andWhere('b.created_at > (SELECT created_at FROM import_batches WHERE id = :batchId)', { batchId: batch.id })
        .andWhere('i.listing_id IN (:...ids)', { ids })
        .getCount();
      if (later) throw new ConflictException('A later import changed the same listings — undo that import first');
    }

    let restored = 0;
    let removed = 0;
    await this.listingRepo.manager.transaction(async (m) => {
      for (const item of items) {
        if (item.action === 'created') {
          await m.update(Listing, { id: item.listing_id, deleted_at: IsNull() }, {
            deleted_at: new Date(),
            status: ListingStatus.INACTIVE,
          });
          removed++;
        } else if (item.action === 'updated' && item.snapshot) {
          const { sizes, ...cols } = item.snapshot as Record<string, unknown> & { sizes?: string[] };
          if (cols.expires_at) cols.expires_at = new Date(cols.expires_at as string);
          await m.update(Listing, item.listing_id, cols as Partial<Listing>);
          if (sizes?.length) await writeListingSizes(m, item.listing_id, parseListingSizes(sizes[0], sizes.slice(1)));
          restored++;
        } else if (item.action === 'deactivated' && item.snapshot) {
          await m.update(Listing, item.listing_id, { status: item.snapshot.status as ListingStatus });
          restored++;
        }
      }
      await m.update(ImportBatch, batch.id, { status: 'undone', undone_at: new Date() });
    });

    await this.auditRepo.save(this.auditRepo.create({
      event_type: 'listings.import_undone',
      actor_id: user.id,
      target_id: batch.id,
      target_type: 'import_batch',
      payload: { restored, removed },
    }));
    return { batch_id: batch.id, restored, removed };
  }

  /** The company's imports that can still be undone, newest first */
  async recentBatches(user: User): Promise<ImportBatch[]> {
    const companyId = this.companyOf(user);
    return this.batchRepo.find({
      where: { company_id: companyId, created_at: MoreThan(new Date(Date.now() - UNDO_WINDOW_HOURS * 3600_000)) },
      order: { created_at: 'DESC' },
      take: 20,
    });
  }

  // ── Checks shared by preview and commit ───────────────────────────────────

  private async plan(
    companyId: string,
    segment: TireSegment,
    mode: UpdateMode,
    input: (BuiltRow | { row: number; data: Record<string, unknown>; unrecognized?: string | null })[],
  ): Promise<{ rows: RowPlan[]; summary: PlanSummary; missing: Listing[]; segmentMisfits: number }> {
    const existing = await this.listingRepo.find({
      where: { company_id: companyId, deleted_at: IsNull() },
      relations: { sizes: true },
      order: { created_at: 'ASC' },
    });
    const bySku = new Map<string, Listing>();
    const byKey = new Map<string, Listing>();
    for (const l of existing) {
      if (l.sku && !bySku.has(skuKey(l.sku))) bySku.set(skuKey(l.sku), l);
      const k = listingKey(l.segment, l.brand, l.pattern, l.size_raw, l.dot_code);
      if (!byKey.has(k)) byKey.set(k, l);
    }

    const seen = new Map<string, number>();
    const matched = new Set<string>();
    let segmentMisfits = 0;
    const rows: RowPlan[] = [];

    for (const src of input) {
      const built = 'messages' in src ? (src as BuiltRow) : null;
      const messages: RowMessage[] = built ? [...built.messages] : [];
      const data = src.data as Record<string, unknown>;
      const plan: RowPlan = {
        row: src.row,
        data: data as ImportRowData,
        status: 'ok',
        messages,
        action: null,
        unrecognized: src.unrecognized ?? null,
        ...(built ? { alternatives: built.alternatives } : {}),
      };
      rows.push(plan);

      const extra = Object.keys(data).filter((k) => !(IMPORT_FIELDS as readonly string[]).includes(k));
      if (extra.length) {
        messages.push({ level: 'error', text: `Fields not allowed in an import: ${extra.join(', ')}` });
        plan.status = 'error';
        continue;
      }

      // Same validation as a listing created in the form
      const dto = plainToInstance(CreateListingDto, { ...data, segment });
      const invalid = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      for (const e of flatten(invalid)) {
        if (messages.some((m) => m.level === 'error' && m.field === e.field)) continue;
        // One clear message for a missing field instead of every rule it breaks
        const v = data[e.field];
        const missing = v === undefined || v === null || v === '';
        messages.push({ level: 'error', field: e.field, text: missing ? `${e.field} is required` : e.text });
      }

      let sizes: ParsedTireSize[] | undefined;
      if (typeof dto.size === 'string' && dto.size.trim()) {
        try {
          sizes = parseListingSizes(dto.size, Array.isArray(dto.additional_sizes) ? dto.additional_sizes : []);
        } catch (e) {
          messages.push({ level: 'error', field: 'size', text: (e as Error).message });
        }
      }
      if (sizes) {
        const rim = rimMismatch(sizes);
        if (rim) messages.push({ level: 'warning', field: 'size', text: rim });
        const misfit = sizeSegmentWarning(sizes[0], segment as Segment);
        if (misfit) {
          segmentMisfits++;
          messages.push({ level: 'warning', field: 'size', text: misfit });
        }
      }
      if (typeof dto.load_index === 'string') {
        for (const w of loadIndexColumns(dto.load_index).warnings) messages.push({ level: 'warning', field: 'load_index', text: w });
      }

      // Which listing this row is, even when the row has errors: its listing
      // then counts as mentioned (never deactivated because of a typo)
      let key: string | null = null;
      let match: Listing | undefined;
      if (typeof dto.sku === 'string' && dto.sku.trim()) {
        key = 'sku:' + skuKey(dto.sku);
        match = bySku.get(skuKey(dto.sku));
      } else if (sizes && typeof dto.brand === 'string') {
        key = listingKey(segment, dto.brand, dto.pattern ?? null, sizes[0].size_raw, dto.dot_code ?? null);
        match = byKey.get(key);
      }
      if (match) matched.add(match.id);
      if (key) {
        const first = seen.get(key);
        if (first !== undefined) {
          messages.push({ level: 'error', text: `Same tyre as row ${first} (same ${key.startsWith('sku:') ? 'SKU' : 'brand, pattern, size and year'})` });
        } else seen.set(key, src.row);
      }

      plan.messages = dedupe(messages);
      plan.status = plan.messages.some((m) => m.level === 'error') ? 'error' : plan.messages.length ? 'warning' : 'ok';
      if (plan.status === 'error' || !sizes) continue;

      plan.dto = dto;
      plan.sizes = sizes;
      if (!match) plan.action = 'new';
      else if (mode === 'skip_existing') plan.action = 'skip';
      else {
        plan.existing = match;
        plan.action = this.differs(match, dto, sizes) ? 'update' : 'unchanged';
      }
    }

    const missing = existing.filter((l) => l.segment === segment && l.status === ListingStatus.ACTIVE && !matched.has(l.id));
    const count = (a: RowAction) => rows.filter((r) => r.action === a).length;
    const summary: PlanSummary = {
      rows: rows.length,
      new: count('new'),
      update: count('update'),
      unchanged: count('unchanged'),
      skip: count('skip'),
      errors: rows.filter((r) => r.status === 'error').length,
      warnings: rows.filter((r) => r.status === 'warning').length,
      missing: missing.length,
    };
    // Plans leave the service without internals
    for (const r of rows) Object.defineProperties(r, hidden(['dto', 'sizes', 'existing']));
    return { rows, summary, missing, segmentMisfits };
  }

  // Columns an update writes: the always-present fields, and the optional ones the row carries
  private updatePatch(dto: CreateListingDto, sizes: ParsedTireSize[], companyId: string): Partial<Listing> {
    const next = this.listings.buildNewListing(dto, companyId, sizes);
    const patch: Partial<Listing> = {};
    const put = (cols: (keyof Listing)[]) => { for (const c of cols) (patch as Record<string, unknown>)[c] = next[c]; };
    put(REQUIRED_COLUMNS);
    for (const [field, cols] of Object.entries(OPTIONAL_COLUMNS)) {
      if ((dto as unknown as Record<string, unknown>)[field] !== undefined) put(cols!);
    }
    if (dto.price !== undefined) put(['price_internal_encrypted', 'price_currency']);
    patch.status = ListingStatus.ACTIVE;
    patch.expires_at = next.expires_at;
    return patch;
  }

  private differs(l: Listing, dto: CreateListingDto, sizes: ParsedTireSize[]): boolean {
    if (l.status !== ListingStatus.ACTIVE) return true;
    const patch = this.updatePatch(dto, sizes, l.company_id);
    for (const [col, value] of Object.entries(patch)) {
      if (['status', 'expires_at', 'price_internal_encrypted', 'price_currency'].includes(col)) continue;
      if (!same((l as unknown as Record<string, unknown>)[col], value)) return true;
    }
    if (dto.price !== undefined) {
      if (Number(this.decryptPrice(l)) !== Number(dto.price)) return true;
      if ((l.price_currency ?? null) !== (patch.price_currency ?? null)) return true;
    }
    const current = [l.size_raw, ...additionalSizesOf(l.sizes)];
    return current.join('|') !== sizes.map((s) => s.size_raw).join('|');
  }

  private snapshot(l: Listing): Record<string, unknown> {
    const s: Record<string, unknown> = {};
    for (const c of SNAPSHOT_COLUMNS) s[c] = (l as unknown as Record<string, unknown>)[c];
    s.sizes = [l.size_raw, ...additionalSizesOf(l.sizes)];
    return s;
  }

  private decryptPrice(l: Listing): number | null {
    if (!l.price_internal_encrypted) return null;
    try {
      return parseFloat(this.encryption.decrypt(l.price_internal_encrypted));
    } catch {
      return null;
    }
  }

  private errorsCsv(rows: RowPlan[]): string {
    const fields = IMPORT_FIELDS as readonly string[];
    return toCsv([
      ['Row', 'Problems', 'Unrecognized text', ...fields],
      ...rows.map((r) => [
        r.row,
        r.messages.filter((m) => m.level === 'error').map((m) => m.text).join('; '),
        r.unrecognized ?? '',
        ...fields.map((f) => {
          const v = (r.data as Record<string, unknown>)[f];
          return Array.isArray(v) ? v.join('; ') : v;
        }),
      ]),
    ]);
  }

  private async saveMapping(
    m: EntityManager,
    companyId: string,
    signature: string,
    columns: Record<string, FieldType>,
    headerRow?: number,
  ): Promise<void> {
    await m
      .createQueryBuilder()
      .insert()
      .into(ImportMapping)
      .values({ company_id: companyId, header_signature: signature, mapping: headerRow === undefined ? { columns } : { columns, header_row: headerRow } })
      .orUpdate(['mapping', 'updated_at'], ['company_id', 'header_signature'])
      .execute();
  }

  private async read(file: UploadedFile) {
    if (!file?.buffer?.length) throw new BadRequestException('Upload a file');
    try {
      return await readSpreadsheet(file.buffer, file.originalname ?? '', file.mimetype ?? '');
    } catch (e) {
      if (e instanceof FileReadError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private pickSheet(sheets: SheetGrid[], name: string): SheetGrid {
    const s = sheets.find((x) => x.name === name);
    if (!s) throw new BadRequestException('No such sheet in the file');
    return s;
  }

  private assertRowLimit(sheet: SheetGrid, dataRows: number) {
    if (sheet.truncated || dataRows > MAX_DATA_ROWS) {
      throw new BadRequestException(`The sheet has more than ${MAX_DATA_ROWS} rows — split the file`);
    }
  }

  private companyOf(user: User): string {
    if (!user.company_id) throw new ForbiddenException('User has no associated company');
    return user.company_id;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function skuKey(sku: string): string {
  return sku.trim().toLowerCase();
}

/** Update key without an SKU: segment + brand + pattern + main size + year */
export function listingKey(
  segment: string,
  brand: string,
  pattern: string | null,
  sizeRaw: string,
  dot: string | null,
): string {
  const p = (pattern ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return [segment, brandKey(brand), p, sizeRaw.toUpperCase(), dot ?? ''].join('|');
}

function same(a: unknown, b: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== 'boolean' && !Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

function flatten(errors: ValidationError[], prefix = ''): { field: string; text: string }[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}).map((text) => ({ field: prefix + e.property, text })),
    ...flatten(e.children ?? [], `${prefix}${e.property}.`),
  ]);
}

function dedupe(messages: RowMessage[]): RowMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const k = `${m.level}|${m.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function hidden(keys: string[]): PropertyDescriptorMap {
  return Object.fromEntries(keys.map((k) => [k, { enumerable: false, writable: true, configurable: true }]));
}
