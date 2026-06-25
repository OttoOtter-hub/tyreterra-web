import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';
import { Request } from '../../requests/entities/request.entity';

export enum TireSegment {
  TBR = 'TBR',
  OTR = 'OTR',
  AGRI = 'AGRI',
}

export enum TireCondition {
  NEW = 'new',
  USED = 'used',
  RETREADED = 'retreaded',
}

export enum ListingStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  EXPIRED = 'expired',
}

export enum AllowedRoles {
  ALL = 'all',
  DEALER = 'dealer',
  DISTRIBUTOR = 'distributor',
}

@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id' })
  company_id: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'enum', enum: TireSegment })
  segment: TireSegment;

  @Column({ length: 100 })
  brand: string;

  // ── Parsed size fields (§4.2) ─────────────────────────────────────────────
  @Column({ length: 20, name: 'size_format' })
  size_format: string; // metric | flotation | diagonal_inch | radial_inch

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'size_width' })
  size_width: number;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, name: 'size_aspect_ratio' })
  size_aspect_ratio: number | null;

  // 'R' or '-'
  @Column({ length: 1, name: 'size_construction' })
  size_construction: string;

  @Column({ type: 'numeric', precision: 5, scale: 1, name: 'size_rim' })
  size_rim: number;

  @Column({ length: 30, name: 'size_raw' })
  size_raw: string;
  // ─────────────────────────────────────────────────────────────────────────

  @Column({ length: 100, nullable: true })
  pattern: string | null;

  @Column({ type: 'integer' })
  qty: number;

  // WWYY format e.g. 1423 → week 14 of 2023
  @Column({ length: 4, nullable: true, name: 'dot_code' })
  dot_code: string | null;

  @Column({ length: 2, name: 'location_country' })
  location_country: string;

  @Column({ length: 100, nullable: true, name: 'location_region' })
  location_region: string | null;

  @Column({ type: 'enum', enum: TireCondition })
  condition: TireCondition;

  // Seller's internal reference price — NEVER exposed in catalogue (§5.1)
  @Column({ type: 'text', nullable: true, name: 'price_internal_encrypted' })
  price_internal_encrypted: string | null;

  @Column({ length: 3, nullable: true, name: 'price_currency' })
  price_currency: string | null;

  // Visibility settings (§5.2)
  @Column({ type: 'text', array: true, nullable: true, name: 'visible_regions' })
  visible_regions: string[] | null;

  @Column({ default: false, name: 'exclude_own_region' })
  exclude_own_region: boolean;

  @Column({ type: 'enum', enum: AllowedRoles, default: AllowedRoles.ALL, name: 'allowed_roles' })
  allowed_roles: AllowedRoles;

  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.ACTIVE })
  status: ListingStatus;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at: Date;

  @OneToMany(() => Request, (request) => request.listing)
  requests: Request[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}
