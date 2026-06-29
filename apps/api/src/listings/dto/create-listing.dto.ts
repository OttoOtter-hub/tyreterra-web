import {
  IsEnum,
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
  MaxLength,
  MinLength,
  Length,
  Matches,
  ArrayMinSize,
} from 'class-validator';
import { TireSegment, TireCondition, AllowedRoles } from '../entities/listing.entity';

export class CreateListingDto {
  @IsEnum(TireSegment)
  segment: TireSegment;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand: string;

  // Free-text size — parsed by TireSizeParser in the service
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  size: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pattern?: string;

  // TBR: steer|drive|trailer|all_position  PCR: summer|winter_friction|winter_stud|all_season  MH: pneumatic|solid
  @IsOptional()
  @IsString()
  @MaxLength(30)
  tire_type?: string;

  // e.g. "12PR", "173D", "173D/178A8"
  @IsOptional()
  @IsString()
  @MaxLength(30)
  load_index?: string;

  // Country of manufacture, e.g. "India", "Serbia", "Japan"
  @IsOptional()
  @IsString()
  @MaxLength(100)
  origin_country?: string;

  @IsInt()
  @Min(1)
  qty: number;

  // Year of production, e.g. "2023"
  @IsOptional()
  @IsString()
  @Matches(/^20[0-2]\d$/, { message: 'dot_code must be a year 200x–202x' })
  dot_code?: string;

  // ISO 3166-1 alpha-2
  @IsString()
  @Length(2, 2)
  location_country: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location_region?: string;

  @IsEnum(TireCondition)
  condition: TireCondition;

  // Visibility (§5.2) — optional; defaults mean visible to all
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  visible_regions?: string[];

  @IsOptional()
  @IsBoolean()
  exclude_own_region?: boolean;

  @IsOptional()
  @IsEnum(AllowedRoles)
  allowed_roles?: AllowedRoles;
}
