import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  event_type: string;

  @Column({ type: 'varchar', nullable: true, name: 'actor_id' })
  actor_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true, name: 'target_id' })
  target_id: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'target_type' })
  target_type: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
