import { Controller, Get, Post, Body, Param, HttpCode, Query } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateWalletDto } from './dto';
import { CreateWalletUseCase } from '../../../application/wallets/create-wallet.use-case';
import { GetWalletUseCase } from '../../../application/wallets/get-wallet.use-case';
import { GetWalletLedgerUseCase } from '../../../application/wallets/get-wallet-ledger.use-case';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly em: EntityManager) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateWalletDto) {
    const useCase = new CreateWalletUseCase(this.em);
    return useCase.execute(dto);
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const useCase = new GetWalletLedgerUseCase(this.em);
    return useCase.execute(walletId, cursor, limit ? Number(limit) : 50);
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string) {
    const useCase = new GetWalletUseCase(this.em);
    return useCase.execute(walletId);
  }
}
