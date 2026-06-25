import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Rating } from '../../ratings/entities/rating.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  // ISO 3166-1 alpha-2
  @Column({ length: 2, name: 'country' })
  country: string;

  @Column({ length: 30, nullable: true, name: 'vat_number' })
  vat_number: string | null;

  @Column({ default: false, name: 'vat_verified' })
  vat_verified: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'vat_verified_at' })
  vat_verified_at: Date | null;

  @Column({ length: 300, nullable: true, name: 'short_description' })
  short_description: string | null;

  // Encrypted at rest — revealed only after deal Accept
  @Column({ type: 'text', nullable: true, name: 'contact_email_encrypted' })
  contact_email_encrypted: string | null;

  @Column({ type: 'text', nullable: true, name: 'contact_phone_encrypted' })
  contact_phone_encrypted: string | null;

  @OneToOne(() => User, (user) => user.company)
  user: User;

  @OneToOne(() => Rating, (rating) => rating.company)
  rating: Rating;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}
