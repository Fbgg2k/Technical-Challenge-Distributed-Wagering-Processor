import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { mikroOrmConfig } from './infrastructure/database/mikro-orm.config';
import { WalletsController } from './presentation/http/wallets/wallets.controller';
import { WageringController } from './presentation/http/wagering/wagering.controller';
import { WagerTransactionConsumer } from './presentation/messaging/consumers/wager-transaction.consumer';
import { OutboxPublisher } from './infrastructure/messaging/outbox/outbox-publisher.service';
import { PendingReferenceWorker } from './infrastructure/messaging/outbox/pending-reference.worker';
import { HealthController } from './presentation/http/health/health.controller';
import { MetricsController } from './presentation/http/metrics/metrics.controller';
import { AuthModule } from './presentation/http/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRoot(mikroOrmConfig),
    AuthModule.register(),
  ],
  controllers: [WalletsController, WageringController, HealthController, MetricsController],
  providers: [WagerTransactionConsumer, OutboxPublisher, PendingReferenceWorker],
})
export class AppModule {}
