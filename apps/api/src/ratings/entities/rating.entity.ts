import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';

@Entity('ratings')
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id' })
  company_id: string;

  @OneToOne(() => Company, (company) => company.rating)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  // Rates stored as 0.0000–1.0000
  @Column({ type: 'numeric', precision: 5, scale: 4, name: 'response_rate', default: 0 })
  response_rate: number;

  @Column({ type: 'numeric', precision: 5, scale: 4, name: 'accept_rate', default: 0 })
  accept_rate: number;

  @Column({ type: 'numeric', precision: 5, scale: 4, name: 'cancel_rate', default: 0 })
  cancel_rate: number;

  // Minimum 5 interactions required; null = "New member"
  @Column({ type: 'integer', name: 'interaction_count', default: 0 })
  interaction_count: number;

  // 1.0–5.0 rounded to 0.5; null when interaction_count < 5
  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true, name: 'score' })
  score: number | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'calculated_at' })
  calculated_at: Date;
}
