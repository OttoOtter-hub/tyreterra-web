import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Brackets, SelectQueryBuilder } from 'typeorm';
import { Listing, ListingStatus, AllowedRoles } from './entities/listing.entity';
import { ListingSize } from './entities/listing-size.entity';
import { User, UserRole } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import {
  parseTireSize,
  parsePartialSize,
  normaliseSizeQuery,
  SizeCandidate,
  ParsedTireSize,
} from '@tyreterra/tire-size';
import {
  SizeMatcher,
  SizeSuggestion,
  candidateMatcher,
  sizeRawPrefix,
  toSuggestion,
  usableCandidates,
  whereAnyCandidate,
  whereHasSize,
} from './size-search';
import {
  additionalSizesOf,
  mainSizeColumns,
  parseListingSizes,
  writeListingSizes,
} from './listing-sizes';
import { assertRimsOrConfirmed, loadIndexColumns } from './listing-rules';
import { EncryptionService } from '../common/encryption.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingDto } from './dto/search-listing.dto';
import { canSeeListing, isOwner, whereListingVisibleTo } from './listing-visibility';
import { serializeListing, SerializedListing } from '../common/serializers';

const LISTING_TTL_DAYS = 30;
const SUGGEST_LIMIT = 10;
const NEAREST_LIMIT = 5;
const SUGGEST_CACHE_MS = 5_000;
const SUGGEST_CACHE_MAX = 500;

// Shape returned by the catalogue/search endpoint (§6.1 + §6.2)
export interface CatalogueItem {
  id: string;
  company_id: string;
  segment: string;
  tire_type: string | null;
  size_raw: string;
  size_width: number;
  size_aspect_ratio: number | null;
  size_construction: string;
  size_rim: number;
  size_format: string;
  /** Sizes besides the main one (size_raw) */
  additional_sizes: string[];
  /** For a size search: the listing's size that matched (may be an additional one) */
  matched_size: string | null;
  brand: string;
  pattern: string | null;
  sku: string | null;
  load_index: string | null;
  load_index_single: number | null;
  speed_single: string | null;
  load_index_dual: number | null;
  speed_dual: string | null;
  ply_rating: number | null;
  comment: string | null;
  origin_country: string | null;
  dot_code: string | null;
  qty: number;
  condition: string;
  location_country: string;
  location_region: string | null;
  seller_country: string | null;
  seller_rating: number | null;
  created_at: Date;
  expires_at: Date;
}

// A listing as its owner (or an admin) gets it back: serialized, with the
// additional sizes as a plain list instead of the size rows
export type ListingResponse = Omit<SerializedListing, 'sizes'> & { additional_sizes: string[] };

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(ListingSize)
    private readonly sizeRepo: Repository<ListingSize>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly encryption: EncryptionService,
  ) {}

  // A listing by id for this viewer: 404 when it does not exist or the
  // viewer may not see it (listing-visibility.ts). Loads the seller company
  // (and any other `relations` asked for).
  async findVisible(id: string, viewer: User, relations: string[] = ['company']): Promise<Listing> {
    const listing = await this.listingRepo.findOne({ where: { id }, relations });
    if (!listing || !(await this.canSee(listing, viewer))) throw new NotFoundException('Listing not found');
    return listing;
  }

  private async canSee(listing: Listing, viewer: User): Promise<boolean> {
    const viewerCompany = viewer.company_id ? await this.companyRepo.findOneBy({ id: viewer.company_id }) : null;
    const sellerCompany = listing.company ?? await this.companyRepo.findOneBy({ id: listing.company_id });
    return canSeeListing(listing, viewer, {
      sellerCountry: sellerCompany?.country ?? null,
      viewerCountry: viewerCompany?.country ?? null,
    });
  }

  // A listing the user is about to change: 404 if they may not even see it,
  // 403 if they see it but it is not theirs (admins may change any).
  private async findForChange(id: string, user: User, allowAdmin = true): Promise<Listing> {
    const listing = await this.findVisible(id, user);
    if (!isOwner(listing, user) && !(allowAdmin && user.role === UserRole.ADMIN)) throw new ForbiddenException();
    return listing;
  }

  private readonly suggestCache = new Map<string, { value: SizeSuggestion[]; expires: number }>();

  // Column values of a new listing from validated input and its parsed sizes
  buildNewListing(dto: CreateListingDto, companyId: string, sizes: ParsedTireSize[]): Partial<Listing> {
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + LISTING_TTL_DAYS);
    return {
      company_id: companyId,
      segment: dto.segment,
      brand: dto.brand,
      ...mainSizeColumns(sizes[0]),
      sku: dto.sku ?? null,
      tire_type: dto.tire_type ?? null,
      pattern: dto.pattern ?? null,
      load_index: dto.load_index ?? null,
      ...loadIndexColumns(dto.load_index).columns,
      origin_country: dto.origin_country ?? null,
      qty: dto.qty,
      dot_code: dto.dot_code ?? null,
      location_country: dto.location_country.toUpperCase(),
      location_region: dto.location_region ?? null,
      condition: dto.condition,
      comment: dto.comment ?? null,
      visible_regions: dto.visible_regions ?? null,
      exclude_own_region: dto.exclude_own_region ?? false,
      price_internal_encrypted: dto.price != null
        ? this.encryption.encrypt(String(dto.price))
        : null,
      price_currency: dto.currency ?? (dto.price != null ? 'EUR' : null),
      allowed_roles: dto.allowed_roles ?? AllowedRoles.ALL,
      status: ListingStatus.ACTIVE,
      expires_at,
    };
  }

  async create(dto: CreateListingDto, user: User): Promise<ListingResponse> {
    if (!user.company_id) {
      throw new ForbiddenException('User has no associated company');
    }

    const sizes = parseListingSizes(dto.size, dto.additional_sizes);
    assertRimsOrConfirmed(sizes, dto.confirm_rim_mismatch);

    // The listing and its sizes are written together or not at all
    const listing = await this.listingRepo.manager.transaction(async (m) => {
      const saved = await m.save(this.listingRepo.create(this.buildNewListing(dto, user.company_id!, sizes)));
      await writeListingSizes(m, saved.id, sizes);
      return saved;
    });

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.created',
        actor_id: user.id,
        target_id: listing.id,
        target_type: 'listing',
        payload: {
          segment: listing.segment,
          size_raw: listing.size_raw,
          additional_sizes: sizes.slice(1).map((p) => p.size_raw),
          qty: listing.qty,
        },
      }),
    );

    return this.withSizeList(serializeListing(listing, user, this.encryption), sizes.slice(1).map((p) => p.size_raw));
  }

  async findMine(user: User): Promise<ListingResponse[]> {
    if (!user.company_id) return [];
    const listings = await this.listingRepo.find({
      where: { company_id: user.company_id, deleted_at: IsNull() },
      relations: ['sizes'],
      order: { created_at: 'DESC' },
    });
    return listings.map(l => this.withSizeList(serializeListing(l, user, this.encryption), additionalSizesOf(l.sizes)));
  }

  async search(
    dto: SearchListingDto,
    viewer: User,
  ): Promise<{ data: CatalogueItem[]; total: number; nearest?: SizeSuggestion[] }> {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 100);

    // §6.1: include seller country and rating; §6.2: never expose company name
    const qb = this.visibleListings(viewer).addSelect(['c.country', 'r.score', 'r.interaction_count']);
    this.applyFilters(qb, dto);

    // Every size of a listing (main and additional) is searched; a listing
    // still appears once, with the size that matched.
    const fetchPage = async (match: SizeMatcher | null) => {
      if (match) whereHasSize(qb, 'l', match);
      const [rows, total] = await qb
        .orderBy('l.created_at', 'DESC')
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();
      return { data: await this.toCatalogueItems(rows, match), total };
    };

    // Free-text size query (`q`): parsed into components and every plausible
    // reading searched, so an ambiguous query never silently picks one
    if (dto.q !== undefined && dto.q.trim() !== '') {
      const candidates = usableCandidates(parsePartialSize(dto.q));
      if (!candidates.length) return { data: [], total: 0, nearest: [] };
      const result = await fetchPage(candidateMatcher(candidates));
      const nearest = result.total === 0 ? await this.nearestSizes(candidates, dto, viewer) : [];
      return { ...result, nearest };
    }

    // Legacy size search (§4.4), kept for old clients and links: size_raw
    // matches width + rim + construction; or structured components
    if (dto.size_raw) {
      let p;
      try {
        p = parseTireSize(dto.size_raw);
      } catch {
        return { data: [], total: 0 };
      }
      return fetchPage((w, a) => w.andWhere(`${a}.size_width = :w AND ${a}.size_rim = :r AND ${a}.size_construction = :c`, {
        w: p.size_width, r: p.size_rim, c: p.size_construction,
      }));
    }
    if (dto.size_width || dto.size_rim || dto.size_construction) {
      return fetchPage((w, a) => {
        if (dto.size_width) w.andWhere(`${a}.size_width = :w`, { w: dto.size_width });
        if (dto.size_rim) w.andWhere(`${a}.size_rim = :r`, { r: dto.size_rim });
        if (dto.size_construction) w.andWhere(`${a}.size_construction = :c`, { c: dto.size_construction });
      });
    }
    return fetchPage(null);
  }

  // Up to 10 sizes matching a partial size query, from listings the viewer
  // can see, with how many listings each has. Sizes only: no listing ids,
  // prices or companies. Cached briefly per viewer company and query.
  async suggestSizes(q: string | undefined, viewer: User): Promise<SizeSuggestion[]> {
    const norm = normaliseSizeQuery(q ?? '');
    if (!norm) return [];
    const key = `${viewer.company_id ?? '-'}|${norm}`;
    const cached = this.suggestCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const candidates = usableCandidates(parsePartialSize(norm));
    const prefix = sizeRawPrefix(norm);
    let value: SizeSuggestion[] = [];
    if (candidates.length || prefix) {
      const qb = this.sizeGroups(viewer);
      qb.andWhere(
        new Brackets((or) => {
          if (prefix) or.orWhere(`ls.size_raw LIKE :prefix ESCAPE '\\'`, { prefix });
          if (candidates.length) or.orWhere(new Brackets((sub) => whereAnyCandidate(sub, 'ls', candidates)));
        }),
      );
      // Exact text prefix first, then the most offered sizes
      if (prefix) qb.orderBy(`MAX(CASE WHEN ls.size_raw LIKE :prefix ESCAPE '\\' THEN 1 ELSE 0 END)`, 'DESC');
      const rows = await qb
        .addOrderBy('COUNT(DISTINCT l.id)', 'DESC')
        .addOrderBy('MIN(ls.size_raw)', 'ASC')
        .limit(SUGGEST_LIMIT)
        .getRawMany<Record<string, unknown>>();
      value = rows.map(toSuggestion);
    }

    if (this.suggestCache.size >= SUGGEST_CACHE_MAX) {
      this.suggestCache.delete(this.suggestCache.keys().next().value as string);
    }
    this.suggestCache.set(key, { value, expires: Date.now() + SUGGEST_CACHE_MS });
    return value;
  }

  // For an empty result: up to 5 sizes with the same width and rim (and
  // construction, if given) but another profile, closest profile first.
  private async nearestSizes(
    candidates: SizeCandidate[],
    dto: SearchListingDto,
    viewer: User,
  ): Promise<SizeSuggestion[]> {
    const target = candidates.find((c) => c.aspect !== undefined && c.rim !== undefined);
    if (!target) return [];

    const qb = this.sizeGroups(viewer)
      .andWhere('ls.size_width = :nw AND ls.size_rim = :nr', { nw: target.width, nr: target.rim })
      .andWhere('ls.size_aspect_ratio IS NOT NULL AND ls.size_aspect_ratio <> :na', { na: target.aspect });
    if (target.construction) qb.andWhere('ls.size_construction = :nc', { nc: target.construction });
    this.applyFilters(qb, dto);

    const rows = await qb
      .orderBy('ABS(ls.size_aspect_ratio - :na)', 'ASC')
      .addOrderBy('COUNT(DISTINCT l.id)', 'DESC')
      .limit(NEAREST_LIMIT)
      .getRawMany<Record<string, unknown>>();
    return rows.map(toSuggestion);
  }

  // Sizes (main and additional, as `ls`) of visible listings, grouped,
  // selecting only size columns and how many listings carry each
  private sizeGroups(viewer: User): SelectQueryBuilder<Listing> {
    return this.visibleListings(viewer)
      .innerJoin(ListingSize, 'ls', 'ls.listing_id = l.id')
      .select('MIN(ls.size_raw)', 'size')
      .addSelect('ls.size_width', 'width')
      .addSelect('ls.size_aspect_ratio', 'aspect')
      .addSelect('ls.size_construction', 'construction')
      .addSelect('ls.size_rim', 'rim')
      .addSelect('COUNT(DISTINCT l.id)', 'count')
      .groupBy('ls.size_width')
      .addGroupBy('ls.size_aspect_ratio')
      .addGroupBy('ls.size_construction')
      .addGroupBy('ls.size_rim');
  }

  // Active, not deleted, not expired listings the viewer may see. Joins the
  // seller company as `c`, its rating as `r` and the viewer's company as `vc`.
  private visibleListings(viewer: User): SelectQueryBuilder<Listing> {
    const viewerCompanyId = viewer.company_id ?? null;
    const qb = this.listingRepo
      .createQueryBuilder('l')
      .leftJoin('l.company', 'c')
      .leftJoin('c.rating', 'r')
      .leftJoin(Company, 'vc', 'vc.id = :viewerCompanyId', { viewerCompanyId })
      .where('l.status = :status', { status: ListingStatus.ACTIVE })
      .andWhere('l.deleted_at IS NULL')
      .andWhere('l.expires_at > NOW()');
    whereListingVisibleTo(qb, 'l', 'c', 'vc', viewer);
    return qb;
  }

  // Catalogue filters other than size
  private applyFilters(qb: SelectQueryBuilder<Listing>, dto: SearchListingDto): void {
    if (dto.segment) qb.andWhere('l.segment = :segment', { segment: dto.segment });
    if (dto.tire_type) qb.andWhere('l.tire_type = :tire_type', { tire_type: dto.tire_type });
    if (dto.brand) qb.andWhere('LOWER(l.brand) = LOWER(:brand)', { brand: dto.brand });
    if (dto.condition) qb.andWhere('l.condition = :condition', { condition: dto.condition });
    if (dto.location_country) {
      qb.andWhere('l.location_country = :country', { country: dto.location_country.toUpperCase() });
    }
    if (dto.qty_min) qb.andWhere('l.qty >= :qty_min', { qty_min: dto.qty_min });

    // §6.3: minimum seller rating — null score (new members) excluded when filter is set
    if (dto.min_rating) {
      qb.andWhere('r.score >= :min_rating', { min_rating: dto.min_rating });
    }
    if (dto.ply_rating) qb.andWhere('l.ply_rating = :ply', { ply: dto.ply_rating });
    if (dto.load_index_min) qb.andWhere('l.load_index_single >= :li_min', { li_min: dto.load_index_min });
  }

  async findOne(id: string, viewer: User): Promise<ListingResponse | Omit<ListingResponse, 'company'> & { seller_country: string | null }> {
    const listing = await this.findVisible(id, viewer, ['company', 'sizes']);
    // The owner gets the decrypted price (serializeListing)
    const serialized = this.withSizeList(serializeListing(listing, viewer, this.encryption), additionalSizesOf(listing.sizes));
    if (isOwner(listing, viewer)) return serialized;
    // §6.2: others get the seller's country, never the company itself (name,
    // VAT number, contacts)
    const { company, ...rest } = serialized;
    return { ...rest, seller_country: company?.country ?? null };
  }

  async update(id: string, dto: UpdateListingDto, user: User): Promise<ListingResponse> {
    const listing = await this.findForChange(id, user);

    const { size, additional_sizes, ...rest } = dto;

    // Re-parse sizes if either the main or the additional ones are given;
    // the other part is kept as it is
    const current = await this.sizeRepo.find({ where: { listing_id: id } });
    let extras = additionalSizesOf(current);
    let sizes = null;
    if (size || additional_sizes) {
      sizes = parseListingSizes(size || listing.size_raw, additional_sizes ?? extras);
      assertRimsOrConfirmed(sizes, rest.confirm_rim_mismatch);
      Object.assign(listing, mainSizeColumns(sizes[0]));
      extras = sizes.slice(1).map((p) => p.size_raw);
    }

    if (rest.price != null) {
      listing.price_internal_encrypted = this.encryption.encrypt(String(rest.price));
      listing.price_currency = rest.currency ?? listing.price_currency ?? 'EUR';
    }
    if (rest.load_index !== undefined) Object.assign(listing, loadIndexColumns(rest.load_index).columns);
    // Remove virtual fields before assign to avoid TypeORM issues
    const { price, currency, confirm_rim_mismatch, ...dbRest } = rest;
    Object.assign(listing, dbRest);
    const saved = await this.listingRepo.manager.transaction(async (m) => {
      const s = await m.save(listing);
      if (sizes) await writeListingSizes(m, id, sizes);
      return s;
    });

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.updated',
        actor_id: user.id,
        target_id: listing.id,
        target_type: 'listing',
        payload: dto as unknown as Record<string, unknown>,
      }),
    );

    return this.withSizeList(serializeListing(saved, user, this.encryption), extras);
  }

  async activate(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.findForChange(id, user);

    listing.status = ListingStatus.ACTIVE;
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);
    listing.expires_at = expires_at;
    await this.listingRepo.save(listing);

    return { message: 'Listing activated' };
  }

  async deactivate(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.findForChange(id, user);

    listing.status = ListingStatus.INACTIVE;
    await this.listingRepo.save(listing);

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.deactivated',
        actor_id: user.id,
        target_id: listing.id,
        target_type: 'listing',
        payload: {},
      }),
    );

    return { message: 'Listing deactivated' };
  }

  // Soft delete — preserves audit trail and dispute history. Sets deleted_at
  // and status=inactive instead of removing the row.
  async hardDelete(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.findForChange(id, user);

    listing.deleted_at = new Date();
    listing.status = ListingStatus.INACTIVE;
    await this.listingRepo.save(listing);

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.deleted',
        actor_id: user.id,
        target_id: id,
        target_type: 'listing',
        payload: {},
      }),
    );

    return { message: 'Listing deleted' };
  }

  async bulkAction(
    ids: string[],
    action: 'delete' | 'deactivate' | 'activate',
    user: User,
  ): Promise<{ affected: number }> {
    if (!ids.length) return { affected: 0 };
    const isAdmin = user.role === UserRole.ADMIN;

    const listings = await this.listingRepo.findBy(
      ids.map(id => ({
        id,
        deleted_at: IsNull(),
        ...(!isAdmin ? { company_id: user.company_id! } : {}),
      })),
    );

    let affected = 0;
    for (const l of listings) {
      if (action === 'delete') {
        l.deleted_at = new Date();
        l.status = ListingStatus.INACTIVE;
        await this.listingRepo.save(l);
      } else if (action === 'activate') {
        l.status = ListingStatus.ACTIVE;
        const exp = new Date();
        exp.setDate(exp.getDate() + 30);
        l.expires_at = exp;
        await this.listingRepo.save(l);
      } else {
        l.status = ListingStatus.INACTIVE;
        await this.listingRepo.save(l);
      }
      affected++;
    }

    return { affected };
  }

  async renew(id: string, user: User): Promise<SerializedListing> {
    const listing = await this.findForChange(id, user, false);

    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + LISTING_TTL_DAYS);
    listing.expires_at = expires_at;
    listing.status = ListingStatus.ACTIVE;
    const saved = await this.listingRepo.save(listing);

    return serializeListing(saved, user, this.encryption);
  }

  // Catalogue items for a page of listings, with their additional sizes and,
  // for a size search, the first of their sizes that matched (two queries
  // for the whole page, not one per listing)
  private async toCatalogueItems(rows: Listing[], match: SizeMatcher | null): Promise<CatalogueItem[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const sizes = await this.sizeRepo.find({ where: { listing_id: In(ids) } });
    const matched = new Map<string, string>();
    if (match) {
      const matching = await this.sizeRepo
        .createQueryBuilder('ls')
        .where('ls.listing_id IN (:...ids)', { ids })
        .andWhere(new Brackets((w) => match(w, 'ls')))
        .orderBy('ls.position', 'ASC')
        .getMany();
      for (const s of matching) if (!matched.has(s.listing_id)) matched.set(s.listing_id, s.size_raw);
    }
    return rows.map((r) => ({
      ...this.toCatalogueItem(r),
      additional_sizes: additionalSizesOf(sizes.filter((s) => s.listing_id === r.id)),
      matched_size: matched.get(r.id) ?? null,
    }));
  }

  private toCatalogueItem(l: Listing): CatalogueItem {
    const rating = (l.company as unknown as { rating?: { score?: number | null; interaction_count?: number } })?.rating;
    return {
      id: l.id,
      company_id: l.company_id,
      segment: l.segment,
      size_raw: l.size_raw,
      size_width: l.size_width,
      size_aspect_ratio: l.size_aspect_ratio,
      size_construction: l.size_construction,
      size_rim: l.size_rim,
      size_format: l.size_format,
      additional_sizes: additionalSizesOf(l.sizes),
      matched_size: null,
      tire_type: l.tire_type,
      brand: l.brand,
      pattern: l.pattern,
      sku: l.sku,
      load_index: l.load_index,
      load_index_single: l.load_index_single,
      speed_single: l.speed_single,
      load_index_dual: l.load_index_dual,
      speed_dual: l.speed_dual,
      ply_rating: l.ply_rating,
      comment: l.comment,
      origin_country: l.origin_country,
      dot_code: l.dot_code,
      qty: l.qty,
      condition: l.condition,
      location_country: l.location_country,
      location_region: l.location_region,
      seller_country: l.company?.country ?? null,
      seller_rating: rating?.score ?? null,
      created_at: l.created_at,
      expires_at: l.expires_at,
    };
  }

  // Replaces the loaded size rows with the plain list of additional sizes
  private withSizeList<T extends { sizes?: ListingSize[] }>(listing: T, additional: string[]): Omit<T, 'sizes'> & { additional_sizes: string[] } {
    const { sizes: _rows, ...rest } = listing;
    return { ...rest, additional_sizes: additional };
  }
}
