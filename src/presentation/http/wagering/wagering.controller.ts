import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Headers,
  BadRequestException,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SubmitTransactionDto } from './dto';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case';
import { WagerTransactionOrmRepository } from '../../../infrastructure/database/repositories/wager-transaction.orm-repository';

@Controller()
export class WageringController {
  constructor(private readonly em: EntityManager) {}

  @Post('wagering/transactions')
  @HttpCode(200)
  async submit(
    @Body() dto: SubmitTransactionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const useCase = new ProcessWagerTransactionUseCase(this.em);
    return useCase.execute({ ...dto, idempotencyKey });
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string) {
    const repo = new WagerTransactionOrmRepository(this.em);
    const tx = await repo.findById(transactionId);
    if (!tx) throw new NotFoundException('transaction not found');
    return tx;
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const repo = new WagerTransactionOrmRepository(this.em);
    const tx = await repo.findByProviderAndExternalId(providerId, externalTransactionId);
    if (!tx) throw new NotFoundException('transaction not found');
    return tx;
  }
}
