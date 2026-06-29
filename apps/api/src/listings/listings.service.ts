import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Listing, ListingStatus, AllowedRoles } from './entities/listing.entity';
import { User, UserRole } from '../auth/entities/user.entity';
import { parseTireSize, TireSizeParseError } from '../common/tire-size.parser';
import { EncryptionService } from '../common/encryption.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingDto } from './dto/search-listing.dto';

const LISTING_TTL_DAYS = 30;

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

// Fields never returned in catalogue responses (§6.2)
const HIDDEN_FIELDS: (keyof Listing)[] = ['price_internal_encrypted', 'price_currency'];

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingRepo: Repository<Listing>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly encryption: EncryptionService,
  ) {}

  async create(dto: CreateListingDto, user: User): Promise<Listing> {
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

    return this.sanitise(listing);
  }

  async findMine(user: User): Promise<(Listing & { price?: number | null })[]> {
    if (!user.company_id) return [];
    const listings = await this.listingRepo.find({
      where: { company_id: user.company_id },
      order: { created_at: 'DESC' },
    });
    return listings.map(l => this.withDecryptedPrice(l));
  }

  async search(dto: SearchListingDto, viewer: User): Promise<{ data: CatalogueItem[]; total: number }> {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 100);

    const qb = this.listingRepo
      .createQueryBuilder('l')
      .leftJoin('l.company', 'c')
      .leftJoin('c.rating', 'r')
      // §6.1: include seller country and rating; §6.2: never expose company name
      .addSelect(['c.country', 'r.score', 'r.interaction_count'])
      .where('l.status = :status', { status: ListingStatus.ACTIVE })
      .andWhere('l.expires_at > NOW()');

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

    // Size search on parsed components (§4.4) — prefer structured, fall back to raw
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

  async findOne(id: string, viewer: User): Promise<Listing & { price?: number | null }> {
    const listing = await this.listingRepo.findOne({
      where: { id },
      relations: ['company'],
    });
    if (!listing || listing.status === ListingStatus.EXPIRED) {
      throw new NotFoundException('Listing not found');
    }
    this.assertVisible(listing, viewer);
    const sanitised = this.sanitise(listing);
    // Return decrypted price only to the owner
    if (viewer.company_id && listing.company_id === viewer.company_id) {
      return this.withDecryptedPrice(sanitised);
    }
    return sanitised;
  }

  async update(id: string, dto: UpdateListingDto, user: User): Promise<Listing> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) throw new NotFoundException('Listing not found');

    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAdmin && listing.company_id !== user.company_id) throw new ForbiddenException();

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

    return this.sanitise(saved);
  }

  async activate(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) throw new NotFoundException('Listing not found');
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAdmin && listing.company_id !== user.company_id) throw new ForbiddenException();

    listing.status = ListingStatus.ACTIVE;
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);
    listing.expires_at = expires_at;
    await this.listingRepo.save(listing);

    return { message: 'Listing activated' };
  }

  async deactivate(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) throw new NotFoundException('Listing not found');
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAdmin && listing.company_id !== user.company_id) throw new ForbiddenException();

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

  async hardDelete(id: string, user: User): Promise<{ message: string }> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) throw new NotFoundException('Listing not found');
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAdmin && listing.company_id !== user.company_id) throw new ForbiddenException();

    await this.listingRepo.remove(listing);

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
      ids.map(id => ({ id, ...(!isAdmin ? { company_id: user.company_id! } : {}) })),
    );

    let affected = 0;
    for (const l of listings) {
      if (action === 'delete') {
        await this.listingRepo.remove(l);
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

  async renew(id: string, user: User): Promise<Listing> {
    const listing = await this.listingRepo.findOneBy({ id });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.company_id !== user.company_id) throw new ForbiddenException();

    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + LISTING_TTL_DAYS);
    listing.expires_at = expires_at;
    listing.status = ListingStatus.ACTIVE;
    const saved = await this.listingRepo.save(listing);

    return this.sanitise(saved);
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

  // Strips price and other hidden fields before returning to callers (§6.2)
  private sanitise(listing: Listing): Listing {
    const copy = { ...listing } as Record<string, unknown>;
    for (const f of HIDDEN_FIELDS) delete copy[f];
    return copy as unknown as Listing;
  }

  private assertVisible(_listing: Listing, _viewer: User): void {
    // Roles removed — all authenticated users see all listings
  }

  private withDecryptedPrice(listing: Listing): Listing & { price: number | null; currency: string | null } {
    let price: number | null = null;
    try {
      if (listing.price_internal_encrypted) {
        price = parseFloat(this.encryption.decrypt(listing.price_internal_encrypted));
      }
    } catch { price = null; }
    // Remove encrypted field, expose plaintext price
    const { price_internal_encrypted, ...rest } = listing as unknown as Record<string, unknown>;
    return { ...rest, price, currency: (listing as unknown as Record<string, unknown>).price_currency as string | null } as unknown as Listing & { price: number | null; currency: string | null };
  }
}
