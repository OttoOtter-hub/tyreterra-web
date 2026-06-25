import { IsEnum } from 'class-validator';
import { UserRole } from '../../auth/entities/user.entity';

export class SetRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
