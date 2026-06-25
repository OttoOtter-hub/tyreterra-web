import { IsNumber, IsOptional, IsString, IsPositive, Length, MaxLength } from 'class-validator';

export class CreateOfferDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string; // defaults to 'EUR'

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms_text?: string;
}
