import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../../infrastructure/messaging/sqs/sqs.client';
import { Public } from '../auth/jwt-auth.guard';

@Controller('health')
export class HealthController {
  private readonly sqs: SQSClient = createSqsClient();

  constructor(private readonly em: EntityManager) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    let dbOk = false;
    let sqsOk = false;
    try {
      await this.em.getConnection().execute('select 1');
      dbOk = true;
    } catch {
      /* down */
    }
    try {
      await this.sqs.send(new ListQueuesCommand({}));
      sqsOk = true;
    } catch {
      /* down */
    }
    if (!dbOk || !sqsOk) {
      throw new ServiceUnavailableException({ status: 'not-ready', postgres: dbOk, sqs: sqsOk });
    }
    return { status: 'ready', postgres: dbOk, sqs: sqsOk };
  }
}
