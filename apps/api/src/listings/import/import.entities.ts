import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ImportBatchStatus = 'completed' | 'undone';
export type ImportItemAction = 'created' | 'updated' | 'deactivated';

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  skipped: number;
}

// One committed import file
@Entity('import_batches')
export class ImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'company_id' })
  company_id: string;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  user_id: string | null;

  @Column({ type: 'varchar', length: 10 })
  segment: string;

  @Column({ type: 'varchar', length: 20, default: 'completed' })
  status: ImportBatchStatus;

  @Column({ type: 'jsonb', default: {} })
  counts: ImportCounts;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'undone_at' })
  undone_at: Date | null;
}

// A listing the batch touched, with its state before the change (for undo)
@Entity('import_batch_items')
export class ImportBatchItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'batch_id' })
  batch_id: string;

  @Column({ type: 'uuid', name: 'listing_id' })
  listing_id: string;

  @Column({ type: 'varchar', length: 20 })
  action: ImportItemAction;

  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form JSON (TypeORM insert typing)
  snapshot: Record<string, any> | null;
}

// A company's column mapping for one header layout
@Entity('import_mappings')
export class ImportMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'company_id' })
  company_id: string;

  @Column({ type: 'varchar', length: 64, name: 'header_signature' })
  header_signature: string;

  @Column({ type: 'jsonb' })
  mapping: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updated_at: Date;
}
