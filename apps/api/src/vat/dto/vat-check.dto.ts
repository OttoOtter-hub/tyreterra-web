import { IsString, Length, Matches } from 'class-validator';

export class VatCheckDto {
  // ISO 3166-1 alpha-2 country code (e.g. "DE", "PL")
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter uppercase ISO code' })
  countryCode: string;

  @IsString()
  @Length(2, 20)
  vatNumber: string;
}

export interface VatCheckResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  companyName: string | null;
  address: string | null;
  checkedAt: string; // ISO timestamp
}
