import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  token_hash: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'used_at' })
  used_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'revoked_at' })
  revoked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;
}
