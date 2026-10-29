import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TireCondition, TireSegment } from '../entities/listing.entity';
import { FIELD_TYPES, FieldType, MULTI_COLUMN_TYPES } from './columns';
import { MAX_COLUMNS, MAX_DATA_ROWS } from './file-reader';

// Column index → field type; one column per type except size / comment / ignore
function IsColumnMapping() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isColumnMapping',
      target: object.constructor,
      propertyName,
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_COLUMNS) return false;
          const used = new Set<string>();
          for (const [k, t] of entries) {
            if (!/^\d{1,2}$/.test(k) || +k >= MAX_COLUMNS) return false;
            if (!(FIELD_TYPES as readonly unknown[]).includes(t)) return false;
            if (!MULTI_COLUMN_TYPES.includes(t as FieldType) && used.has(t as string)) return false;
            used.add(t as string);
          }
          return true;
        },
        defaultMessage: () =>
          'mapping must map column numbers to field types, with each field (except size, comment and ignore) used once',
      },
    });
}

export class AnalyzeImportDto {
  @IsEnum(TireSegment)
  segment: TireSegment;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sheet?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DATA_ROWS + 100)
  header_row?: number;
}

export class ImportDefaultsDto {
  @IsOptional()
  @IsEnum(TireCondition)
  condition?: TireCondition;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  location_country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location_region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tire_type?: string;
}

/** Sent as the JSON `options` field of the multipart preview request */
export class PreviewImportDto {
  @IsEnum(TireSegment)
  segment: TireSegment;

  @IsString()
  @MaxLength(100)
  sheet: string;

  @IsInt()
  @Min(0)
  @Max(MAX_DATA_ROWS + 100)
  header_row: number;

  @IsColumnMapping()
  mapping: Record<string, FieldType>;

  @ValidateNested()
  @Type(() => ImportDefaultsDto)
  defaults: ImportDefaultsDto;

  @IsIn(['update', 'skip_existing'])
  update_mode: 'update' | 'skip_existing';
}

export class CommitRowDto {
  @IsInt()
  @Min(0)
  row: number;

  // Checked field by field in the service, like a listing from the form
  @IsObject()
  data: Record<string, unknown>;

  // Text the parser did not understand; only echoed into the errors file
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  unrecognized?: string | null;
}

export class CommitImportDto {
  @IsEnum(TireSegment)
  segment: TireSegment;

  @IsIn(['update', 'skip_existing'])
  update_mode: 'update' | 'skip_existing';

  @IsArray()
  @ArrayMaxSize(MAX_DATA_ROWS)
  @ValidateNested({ each: true })
  @Type(() => CommitRowDto)
  rows: CommitRowDto[];

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  // Deactivating listings the file does not mention needs the flag and the
  // number of listings the user saw in the summary; the server re-counts
  @IsOptional()
  @IsBoolean()
  deactivate_missing?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  expected_deactivate?: number;

  // The column mapping to remember for files with this header
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  header_signature?: string;

  @IsOptional()
  @IsColumnMapping()
  mapping?: Record<string, FieldType>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DATA_ROWS + 100)
  header_row?: number;
}
