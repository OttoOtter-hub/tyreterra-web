import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Request } from '../../requests/entities/request.entity';
import { Deal } from '../../deals/entities/deal.entity';

export enum OfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id' })
  request_id: string;

  // One offer per request (UNIQUE enforced at DB level in migration)
  @OneToOne(() => Request, (request) => request.offer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: Request;

  // AES-256-GCM ciphertext — decrypted only when shown to buyer (§7.2)
  @Column({ type: 'text', name: 'price_encrypted' })
  price_encrypted: string;

  @Column({ length: 3, default: 'EUR' })
  currency: string;

  @Column({ type: 'text', nullable: true, name: 'terms_text' })
  terms_text: string | null;

  @Column({ type: 'enum', enum: OfferStatus, default: OfferStatus.PENDING })
  status: OfferStatus;

  @OneToOne(() => Deal, (deal) => deal.offer)
  deal: Deal;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}
