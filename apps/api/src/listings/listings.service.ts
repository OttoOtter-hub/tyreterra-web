import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Brackets, SelectQueryBuilder } from 'typeorm';
import { Listing, ListingStatus, AllowedRoles } from './entities/listing.entity';
import { User, UserRole } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import {
  parseTireSize,
  TireSizeParseError,
  parsePartialSize,
  normaliseSizeQuery,
  SizeCandidate,
} from '@tyreterra/tire-size';
import {
  SizeSuggestion,
  sizeRawPrefix,
  toSuggestion,
  usableCandidates,
  whereAnyCandidate,
} from './size-search';
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
  brand: string;
  pattern: string | null;
  sku: string | null;
  load_index: string | null;
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

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly encryption: EncryptionService,
  ) {}

  // A listing by id for this viewer: 404 when it does not exist or the
  // viewer may not see it (listing-visibility.ts). Loads the seller company.
  async findVisible(id: string, viewer: User): Promise<Listing> {
    const listing = await this.listingRepo.findOne({ where: { id }, relations: ['company'] });
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

  async create(dto: CreateListingDto, user: User): Promise<SerializedListing> {
    if (!user.company_id) {
      throw new ForbiddenException('User has no associated company');
    }

    let parsed;
    try {
      parsed = parseTireSize(dto.size);
    } catch (e) {
      if (e instanceof TireSizeParseError) throw new BadRequestException(e.message);
      throw e;
    }

    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + LISTING_TTL_DAYS);

    const listing = await this.listingRepo.save(
      this.listingRepo.create({
        company_id: user.company_id,
        segment: dto.segment,
        brand: dto.brand,
        size_format: parsed.format,
        size_width: parsed.size_width,
        size_aspect_ratio: parsed.size_aspect_ratio,
        size_construction: parsed.size_construction,
        size_rim: parsed.size_rim,
        size_raw: parsed.size_raw,
        sku: dto.sku ?? null,
        tire_type: dto.tire_type ?? null,
        pattern: dto.pattern ?? null,
        load_index: dto.load_index ?? null,
        origin_country: dto.origin_country ?? null,
        qty: dto.qty,
        dot_code: dto.dot_code ?? null,
        location_country: dto.location_country.toUpperCase(),
        location_region: dto.location_region ?? null,
        condition: dto.condition,
        visible_regions: dto.visible_regions ?? null,
        exclude_own_region: dto.exclude_own_region ?? false,
        price_internal_encrypted: dto.price != null
          ? this.encryption.encrypt(String(dto.price))
          : null,
        price_currency: dto.currency ?? (dto.price != null ? 'EUR' : null),
        allowed_roles: dto.allowed_roles ?? AllowedRoles.ALL,
        status: ListingStatus.ACTIVE,
        expires_at,
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.created',
        actor_id: user.id,
        target_id: listing.id,
        target_type: 'listing',
        payload: { segment: listing.segment, size_raw: listing.size_raw, qty: listing.qty },
      }),
    );

    return serializeListing(listing, user, this.encryption);
  }

  async findMine(user: User): Promise<SerializedListing[]> {
    if (!user.company_id) return [];
    const listings = await this.listingRepo.find({
      where: { company_id: user.company_id, deleted_at: IsNull() },
      order: { created_at: 'DESC' },
    });
    return listings.map(l => serializeListing(l, user, this.encryption));
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

    // Free-text size query (`q`): parsed into components and every plausible
    // reading searched, so an ambiguous query never silently picks one
    if (dto.q !== undefined && dto.q.trim() !== '') {
      const candidates = usableCandidates(parsePartialSize(dto.q));
      if (!candidates.length) return { data: [], total: 0, nearest: [] };
      whereAnyCandidate(qb, 'l', candidates);

      const [rows, total] = await qb
        .orderBy('l.created_at', 'DESC')
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();
      const nearest = total === 0 ? await this.nearestSizes(candidates, dto, viewer) : [];
      return { data: rows.map((r) => this.toCatalogueItem(r)), total, nearest };
    }

    // Legacy size search (§4.4), kept for old clients and links: size_raw
    // matches width + rim + construction; or structured components
    if (dto.size_raw) {
      try {
        const p = parseTireSize(dto.size_raw);
        qb.andWhere('l.size_width = :w AND l.size_rim = :r AND l.size_construction = :c', {
          w: p.size_width, r: p.size_rim, c: p.size_construction,
        });
      } catch {
        return { data: [], total: 0 };
      }
    } else {
      if (dto.size_width) qb.andWhere('l.size_width = :w', { w: dto.size_width });
      if (dto.size_rim) qb.andWhere('l.size_rim = :r', { r: dto.size_rim });
      if (dto.size_construction) qb.andWhere('l.size_construction = :c', { c: dto.size_construction });
    }

    const [rows, total] = await qb
      .orderBy('l.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data: rows.map((r) => this.toCatalogueItem(r)), total };
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
          if (prefix) or.orWhere(`l.size_raw LIKE :prefix ESCAPE '\\'`, { prefix });
          if (candidates.length) or.orWhere(new Brackets((sub) => whereAnyCandidate(sub, 'l', candidates)));
        }),
      );
      // Exact text prefix first, then the most offered sizes
      if (prefix) qb.orderBy(`MAX(CASE WHEN l.size_raw LIKE :prefix ESCAPE '\\' THEN 1 ELSE 0 END)`, 'DESC');
      const rows = await qb
        .addOrderBy('COUNT(*)', 'DESC')
        .addOrderBy('MIN(l.size_raw)', 'ASC')
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
      .andWhere('l.size_width = :nw AND l.size_rim = :nr', { nw: target.width, nr: target.rim })
      .andWhere('l.size_aspect_ratio IS NOT NULL AND l.size_aspect_ratio <> :na', { na: target.aspect });
    if (target.construction) qb.andWhere('l.size_construction = :nc', { nc: target.construction });
    this.applyFilters(qb, dto);

    const rows = await qb
      .orderBy('ABS(l.size_aspect_ratio - :na)', 'ASC')
      .addOrderBy('COUNT(*)', 'DESC')
      .limit(NEAREST_LIMIT)
      .getRawMany<Record<string, unknown>>();
    return rows.map(toSuggestion);
  }

  // Visible listings grouped by size, selecting only size columns and a count
  private sizeGroups(viewer: User): SelectQueryBuilder<Listing> {
    return this.visibleListings(viewer)
      .select('MIN(l.size_raw)', 'size')
      .addSelect('l.size_width', 'width')
      .addSelect('l.size_aspect_ratio', 'aspect')
      .addSelect('l.size_construction', 'construction')
      .addSelect('l.size_rim', 'rim')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.size_width')
      .addGroupBy('l.size_aspect_ratio')
      .addGroupBy('l.size_construction')
      .addGroupBy('l.size_rim');
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
  }

  async findOne(id: string, viewer: User): Promise<SerializedListing | Omit<SerializedListing, 'company'> & { seller_country: string | null }> {
    const listing = await this.findVisible(id, viewer);
    // The owner gets the decrypted price (serializeListing)
    const serialized = serializeListing(listing, viewer, this.encryption);
    if (isOwner(listing, viewer)) return serialized;
    // §6.2: others get the seller's country, never the company itself (name,
    // VAT number, contacts)
    const { company, ...rest } = serialized;
    return { ...rest, seller_country: company?.country ?? null };
  }

  async update(id: string, dto: UpdateListingDto, user: User): Promise<SerializedListing> {
    const listing = await this.findForChange(id, user);

    const { size, ...rest } = dto;

    // Re-parse size if provided
    if (size) {
      let parsed;
      try {
        parsed = parseTireSize(size);
      } catch (e) {
        if (e instanceof TireSizeParseError) throw new BadRequestException(e.message);
        throw e;
      }
      listing.size_format = parsed.format;
      listing.size_width = parsed.size_width;
      listing.size_aspect_ratio = parsed.size_aspect_ratio;
      listing.size_construction = parsed.size_construction;
      listing.size_rim = parsed.size_rim;
      listing.size_raw = parsed.size_raw;
    }

    if (rest.price != null) {
      listing.price_internal_encrypted = this.encryption.encrypt(String(rest.price));
      listing.price_currency = rest.currency ?? listing.price_currency ?? 'EUR';
    }
    // Remove virtual fields before assign to avoid TypeORM issues
    const { price, currency, ...dbRest } = rest;
    Object.assign(listing, dbRest);
    const saved = await this.listingRepo.save(listing);

    await this.auditRepo.save(
      this.auditRepo.create({
        event_type: 'listing.updated',
        actor_id: user.id,
        target_id: listing.id,
        target_type: 'listing',
        payload: dto as unknown as Record<string, unknown>,
      }),
    );

    return serializeListing(saved, user, this.encryption);
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
      tire_type: l.tire_type,
      brand: l.brand,
      pattern: l.pattern,
      sku: l.sku,
      load_index: l.load_index,
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
}
