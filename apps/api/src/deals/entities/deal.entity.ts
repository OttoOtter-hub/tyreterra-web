import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
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

  @Column({ type: 'timestamptz', name: 'accepted_at' })
  accepted_at: Date;

  // Set when contact details are revealed to both parties (§7.2, post-Accept)
  @Column({ type: 'timestamptz', nullable: true, name: 'contact_revealed_at' })
  contact_revealed_at: Date | null;

  @OneToMany(() => Message, (message) => message.deal)
  messages: Message[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
