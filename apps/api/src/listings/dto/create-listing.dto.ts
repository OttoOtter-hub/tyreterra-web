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

  @IsInt()
  @Min(1)
  qty: number;

  // WWYY format e.g. "1423"
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'dot_code must be 4 digits WWYY' })
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
