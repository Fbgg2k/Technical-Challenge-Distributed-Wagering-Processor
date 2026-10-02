import { NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletOrmRepository } from '../../infrastructure/database/repositories/wallet.orm-repository';

export class GetWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string) {
    const repo = new WalletOrmRepository(this.em);
    const wallet = await repo.findById(walletId);
    if (!wallet) {
      throw new NotFoundException('wallet not found');
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
