import { IsUUID, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateRequestDto {
  @IsUUID()
  listing_id: string;

  @IsInt()
  @Min(1)
  qty_requested: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
