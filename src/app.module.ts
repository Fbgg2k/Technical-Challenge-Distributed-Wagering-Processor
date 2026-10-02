import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { mikroOrmConfig } from './infrastructure/database/mikro-orm.config';
import { WalletsController } from './presentation/http/wallets/wallets.controller';
import { WageringController } from './presentation/http/wagering/wagering.controller';
import { WagerTransactionConsumer } from './presentation/messaging/consumers/wager-transaction.consumer';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [WalletsController, WageringController],
  providers: [WagerTransactionConsumer],
})
export class AppModule {}
