import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { mikroOrmConfig } from './infrastructure/database/mikro-orm.config';
import { WalletsController } from './presentation/http/wallets/wallets.controller';
import { WageringController } from './presentation/http/wagering/wagering.controller';
import { WagerTransactionConsumer } from './presentation/messaging/consumers/wager-transaction.consumer';
import { OutboxPublisher } from './infrastructure/messaging/outbox/outbox-publisher.service';
import { PendingReferenceWorker } from './infrastructure/messaging/outbox/pending-reference.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [WalletsController, WageringController],
  providers: [WagerTransactionConsumer, OutboxPublisher, PendingReferenceWorker],
})
export class AppModule {}
