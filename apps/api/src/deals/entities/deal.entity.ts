import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

export enum DealStatus {
  PENDING_PICKUP = 'pending_pickup',
  COMPLETED      = 'completed',
}
import { Offer } from '../../offers/entities/offer.entity';
import { Message } from '../../messages/entities/message.entity';

@Entity('deals')
export class Deal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'offer_id' })
  offer_id: string;

  @OneToOne(() => Offer, (offer) => offer.deal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Column({ type: 'varchar', length: 20, default: DealStatus.PENDING_PICKUP })
  status: DealStatus;

  @Column({ type: 'timestamptz', name: 'accepted_at' })
  accepted_at: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completed_at: Date | null;

  // Set when contact details are revealed to both parties (§7.2, post-Accept)
  @Column({ type: 'timestamptz', nullable: true, name: 'contact_revealed_at' })
  contact_revealed_at: Date | null;

  @OneToMany(() => Message, (message) => message.deal)
  messages: Message[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
