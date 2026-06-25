import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';

export enum UserRole {
  DEALER = 'dealer',
  DISTRIBUTOR = 'distributor',
  ADMIN = 'admin',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  BLOCKED = 'blocked',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ name: 'password_hash' })
  password_hash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.DEALER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Column({ nullable: true, name: 'company_id' })
  company_id: string | null;

  @OneToOne(() => Company, (company) => company.user)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ default: false, name: 'gdpr_consent' })
  gdpr_consent: boolean;

  @Column({ nullable: true, name: 'gdpr_consent_at', type: 'timestamptz' })
  gdpr_consent_at: Date | null;

  @Column({ nullable: true, name: 'tos_accepted_at', type: 'timestamptz' })
  tos_accepted_at: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at: Date;
}
