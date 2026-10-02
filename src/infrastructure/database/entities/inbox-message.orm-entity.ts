import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
export class InboxMessageOrmEntity {
  @PrimaryKey({ type: 'text' })
  messageId!: string;

  @PrimaryKey({ type: 'text' })
  consumerName!: string;

  @Property({ type: 'text' })
  payloadHash!: string;

  @Property({ type: 'timestamptz' })
  receivedAt!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  processedAt?: Date;
}
