import { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessageOrmEntity } from '../entities/inbox-message.orm-entity';

export class InboxMessageOrmRepository {
  constructor(private readonly em: EntityManager) {}

  async find(messageId: string, consumerName: string): Promise<InboxMessageOrmEntity | null> {
    return this.em.findOne(InboxMessageOrmEntity, { messageId, consumerName });
  }

  async saveProcessed(props: {
    messageId: string;
    consumerName: string;
    payloadHash: string;
    receivedAt: Date;
  }): Promise<void> {
    const orm = this.em.create(InboxMessageOrmEntity, {
      messageId: props.messageId,
      consumerName: props.consumerName,
      payloadHash: props.payloadHash,
      receivedAt: props.receivedAt,
      processedAt: new Date(),
    });
    this.em.persist(orm);
    await this.em.flush();
  }
}
