import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Listing } from '../../listings/entities/listing.entity';
import { Company } from '../../companies/entities/company.entity';
import { Offer } from '../../offers/entities/offer.entity';

export enum RequestStatus {
  PENDING = 'pending',
  OFFERED = 'offered',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('requests')
export class Request {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'listing_id' })
  listing_id: string;

  @ManyToOne(() => Listing, (listing) => listing.requests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listing_id' })
  listing: Listing;

  @Column({ name: 'buyer_company_id' })
  buyer_company_id: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_company_id' })
  buyer_company: Company;

  @Column({ type: 'integer', name: 'qty_requested' })
  qty_requested: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'enum', enum: RequestStatus, default: RequestStatus.PENDING })
  status: RequestStatus;

  @OneToOne(() => Offer, (offer) => offer.request)
  offer: Offer;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}
