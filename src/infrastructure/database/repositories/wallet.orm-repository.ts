import { EntityManager } from '@mikro-orm/postgresql';
import { Wallet } from '../../../domain/wallet/entities/wallet.entity';
import { WalletRepository } from '../../../domain/wallet/repositories/wallet.repository';
import { WalletOrmEntity } from '../entities/wallet.orm-entity';

export class WalletOrmRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  private toDomain(orm: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: orm.id,
      playerId: orm.playerId,
      currency: orm.currency,
      balanceAmount: orm.balanceAmount,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  async findById(id: string): Promise<Wallet | null> {
    const orm = await this.em.findOne(WalletOrmEntity, { id });
    return orm ? this.toDomain(orm) : null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const orm = await this.em.findOne(WalletOrmEntity, { playerId, currency });
    return orm ? this.toDomain(orm) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    let orm = await this.em.findOne(WalletOrmEntity, { id: wallet.id });
    if (!orm) {
      orm = this.em.create(WalletOrmEntity, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balanceAmount: wallet.balance.toDecimalString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      this.em.persist(orm);
    } else {
      orm.balanceAmount = wallet.balance.toDecimalString();
      orm.version = wallet.version;
      orm.updatedAt = wallet.updatedAt;
    }
    await this.em.flush();
  }
}
