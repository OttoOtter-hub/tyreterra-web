import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Listing } from './listing.entity';

// One size of a listing; position 0 is the main size (also kept in listings.size_*)
@Entity('listing_sizes')
export class ListingSize {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'listing_id' })
  listing_id: string;

  @ManyToOne(() => Listing, (listing) => listing.sizes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ type: 'varchar', length: 30, name: 'size_raw' })
  size_raw: string;

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
}
