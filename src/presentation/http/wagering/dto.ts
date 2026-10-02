import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WagerTransactionKind } from '../../../domain/wagering/enums/wager-kind.enum';

export class MoneyInputDto {
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  amount!: string;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must be ISO-4217' })
  currency!: string;
}

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyInputDto)
  money!: MoneyInputDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
