import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Deal } from '../../deals/entities/deal.entity';
import { Company } from '../../companies/entities/company.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'deal_id' })
  deal_id: string;

  @ManyToOne(() => Deal, (deal) => deal.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ name: 'sender_company_id' })
  sender_company_id: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_company_id' })
  sender_company: Company;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'file_url' })
  file_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'file_name' })
  file_name: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
