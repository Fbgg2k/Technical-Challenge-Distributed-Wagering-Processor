import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

class MetricsService {
  readonly registry = new Registry();

  readonly transactionsByStatus = new Counter({
    name: 'wager_transactions_total',
    help: 'Transações por status',
    labelNames: ['status', 'kind'] as const,
    registers: [this.registry],
  });

  readonly duplicatesDetected = new Counter({
    name: 'wager_duplicates_detected_total',
    help: 'Replays idempotentes detectados',
    registers: [this.registry],
  });

  readonly retries = new Counter({
    name: 'wager_retries_total',
    help: 'Retries de processamento',
    labelNames: ['source'] as const,
    registers: [this.registry],
  });

  readonly dlqMessages = new Counter({
    name: 'wager_dlq_messages_total',
    help: 'Mensagens enviadas para DLQ',
    registers: [this.registry],
  });

  readonly lockConflicts = new Counter({
    name: 'wager_lock_conflicts_total',
    help: 'Conflitos de lock pessimista',
    registers: [this.registry],
  });

  readonly outboxLag = new Gauge({
    name: 'wager_outbox_lag',
    help: 'Eventos pendentes na outbox',
    registers: [this.registry],
  });

  readonly processingLatency = new Histogram({
    name: 'wager_processing_latency_seconds',
    help: 'Latência de processamento de transação',
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });

  readonly reconciliationDivergences = new Counter({
    name: 'wager_reconciliation_divergences_total',
    help: 'Divergências detectadas pela reconciliação',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}

export const metrics = new MetricsService();
