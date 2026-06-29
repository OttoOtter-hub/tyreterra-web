import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;
}
