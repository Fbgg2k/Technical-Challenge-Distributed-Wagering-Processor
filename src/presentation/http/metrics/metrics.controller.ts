import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { metrics } from '../../../infrastructure/observability/metrics/metrics.service';
import { Public } from '../auth/jwt-auth.guard';

@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  async index(@Res() res: Response) {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  }
}
