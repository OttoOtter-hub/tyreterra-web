import {
  IsEmail,
  IsEnum,
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsBoolean,
  Equals,
  Length,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  password: string;

  @IsEnum([UserRole.DEALER, UserRole.DISTRIBUTOR], {
    message: 'Role must be dealer or distributor',
  })
  role: UserRole.DEALER | UserRole.DISTRIBUTOR;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  company_name: string;

  // ISO 3166-1 alpha-2 (e.g. "DE", "PL", "FR")
  @IsString()
  @Length(2, 2, { message: 'Country must be a 2-letter ISO code' })
  country: string;

  // Optional — non-EU companies may omit (§2.2)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vat_number?: string;

  @IsBoolean()
  @Equals(true, { message: 'GDPR consent is required' })
  gdpr_consent: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Terms of Service acceptance is required' })
  tos_accepted: boolean;
}
