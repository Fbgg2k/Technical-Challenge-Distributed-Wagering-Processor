import { LoggerService } from '@nestjs/common';

/** Logger estruturado em JSON: uma linha JSON por evento, sem payloads financeiros completos. */
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const line = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? '',
      message: typeof message === 'string' ? message : ((message as Error)?.message ?? JSON.stringify(message)),
      ...(extra ?? {}),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  }

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, { trace });
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }
}
