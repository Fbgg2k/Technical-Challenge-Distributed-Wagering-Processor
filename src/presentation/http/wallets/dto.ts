import { IsUUID, IsNotEmpty, IsNumberString, ValidateNested, IsString, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class MoneyDto {
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a decimal string with at most 2 decimal places' })
  amount!: string;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must be ISO-4217' })
  currency!: string;
}

export class CreateWalletDto {
  @IsUUID()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
