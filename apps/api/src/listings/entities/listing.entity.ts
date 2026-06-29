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
  PCR = 'PCR',
  OTR = 'OTR',
  AGRI = 'AGRI',
  MH = 'MH',
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

  @Column({ type: 'varchar', name: 'company_id' })
  company_id: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'enum', enum: TireSegment })
  segment: TireSegment;

  @Column({ type: 'varchar', length: 100 })
  brand: string;

  // ── Parsed size fields (§4.2) ─────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20, name: 'size_format' })
  size_format: string;

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'size_width' })
  size_width: number;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, name: 'size_aspect_ratio' })
  size_aspect_ratio: number | null;

  @Column({ type: 'varchar', length: 1, name: 'size_construction' })
  size_construction: string;

  @Column({ type: 'numeric', precision: 5, scale: 1, name: 'size_rim' })
  size_rim: number;

  @Column({ type: 'varchar', length: 30, name: 'size_raw' })
  size_raw: string;
  // ─────────────────────────────────────────────────────────────────────────

  // Subtype per segment: TBR→steer/drive/trailer/all_position, PCR→summer/winter_friction/winter_stud/all_season, MH→pneumatic/solid
  @Column({ type: 'varchar', length: 30, nullable: true, name: 'tire_type' })
  tire_type: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pattern: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'load_index' })
  load_index: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'origin_country' })
  origin_country: string | null;

  @Column({ type: 'integer' })
  qty: number;

  @Column({ type: 'varchar', length: 4, nullable: true, name: 'dot_code' })
  dot_code: string | null;

  @Column({ type: 'varchar', length: 2, name: 'location_country' })
  location_country: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'location_region' })
  location_region: string | null;

  @Column({ type: 'enum', enum: TireCondition })
  condition: TireCondition;

  @Column({ type: 'text', nullable: true, name: 'price_internal_encrypted' })
  price_internal_encrypted: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true, name: 'price_currency' })
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
