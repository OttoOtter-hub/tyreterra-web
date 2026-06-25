import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ApprovalAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class ApproveUserDto {
  @IsEnum(ApprovalAction)
  action: ApprovalAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string; // Required when action = reject
}
