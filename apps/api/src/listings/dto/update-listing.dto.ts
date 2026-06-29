import {
  IsEnum,
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  IsNumber,
  IsPositive,
  Min,
  MaxLength,
  MinLength,
  Length,
  Matches,
  ArrayMinSize,
} from 'class-validator';
import { TireSegment, TireCondition, AllowedRoles } from '../entities/listing.entity';

export class UpdateListingDto {
  // Size re-parses size_width/size_rim/size_construction when provided
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  size?: string;
  @IsOptional()
  @IsEnum(TireSegment)
  segment?: TireSegment;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pattern?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tire_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  load_index?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  origin_country?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;

  @IsOptional()
  @IsString()
  @Matches(/^20[0-2]\d$/, { message: 'dot_code must be a year 200x–202x' })
  dot_code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  location_country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location_region?: string;

  @IsOptional()
  @IsEnum(TireCondition)
  condition?: TireCondition;

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
