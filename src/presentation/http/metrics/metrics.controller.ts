import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { metrics } from '../../../infrastructure/observability/metrics/metrics.service';

@Controller('metrics')
export class MetricsController {
  @Get()
  async index(@Res() res: Response) {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  }
}
