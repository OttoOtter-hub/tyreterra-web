import { IsEnum, IsOptional, IsString, IsInt, IsNumber, Min, Max, Length, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { TireSegment, TireCondition } from '../entities/listing.entity';

export class SearchListingDto {
  @IsOptional()
  @IsEnum(TireSegment)
  segment?: TireSegment;

  @IsOptional()
  @IsString()
  brand?: string;

  // Free-text size query ("315/80R22.5", "315 80 22,5", "31580R225", "315/80R"),
  // parsed with parsePartialSize. Takes precedence over the size_* params below.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // Structured size search — individual components
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  size_width?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  size_rim?: number;

  @IsOptional()
  @IsString()
  size_construction?: string;

  // OR raw string (parsed by the service before querying)
  @IsOptional()
  @IsString()
  size_raw?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  location_country?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  qty_min?: number;

  @IsOptional()
  @IsString()
  tire_type?: string;

  @IsOptional()
  @IsEnum(TireCondition)
  condition?: TireCondition;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  // Minimum seller star rating (1–5); excludes "New member" companies when set
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  min_rating?: number;

  // Exact ply rating, e.g. 16 for 16PR
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @Type(() => Number)
  ply_rating?: number;

  // Minimum (single) load index, e.g. 154
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  @Type(() => Number)
  load_index_min?: number;
}

export class SizeSuggestDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
