/**
 * Teste de carga — `bun run test:load`
 *
 * Ambiente:
 *   LOAD_URL            (default http://localhost:3000)
 *   LOAD_CONCURRENCY    (default 50 workers)
 *   LOAD_DURATION_MS    (default 30000)
 *   LOAD_AMOUNT         (default 1.00)
 *
 * Metodologia: N workers disparam POST /wagering/transactions com
 * Idempotency-Key única até o tempo esgotar. Ao final, imprime JSON com
 * throughput, p50/p95/p99, taxa de erro, conflitos de concorrência e
 * outbox lag (lido de /metrics), além da reconciliação final
 * (wallet.balance == saldo do ledger).
 */

const URL_BASE = process.env.LOAD_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 50);
const DURATION_MS = Number(process.env.LOAD_DURATION_MS ?? 30_000);
const AMOUNT = process.env.LOAD_AMOUNT ?? '1.00';

interface LatencySample {
  ns: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[idx];
}

async function createWallet(playerId: string, initial = '100000.00') {
  const res = await fetch(`${URL_BASE}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount: initial, currency: 'BRL' },
    }),
  });
  if (!res.ok) throw new Error(`create wallet failed: ${res.status}`);
  return (await res.json()) as { id: string };
}

async function main() {
  const playerId = crypto.randomUUID();
  const { id: walletId } = await createWallet(playerId);

  const latencies: number[] = [];
  const counters = {
    processed: 0,
    rejected: 0,
    conflict: 0,
    errors: 0,
  };
  const lock = { value: false };
  const push = (ok: boolean, status: number, ns: number) => {
    latencies.push(ns);
    if (status === 409) counters.conflict++;
    else if (status >= 500) counters.errors++;
    else if (ok) counters.processed++;
    else counters.rejected++;
  };

  const deadline = Date.now() + DURATION_MS;
  let seq = 0;

  async function worker() {
    while (Date.now() < deadline) {
      const key = `${playerId}:${process.pid}:${seq++}`;
      const body = JSON.stringify({
        providerId: 'load-test',
        externalTransactionId: key,
        playerId,
        walletId,
        roundId: `round-${seq}`,
        gameId: 'load-chimp',
        kind: 'BET',
        money: { amount: AMOUNT, currency: 'BRL' },
      });
      const start = process.hrtime.bigint();
      try {
        const res = await fetch(`${URL_BASE}/wagering/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body,
        });
        const ns = Number(process.hrtime.bigint() - start);
        const ok = res.ok;
        push(ok, res.status, ns);
        if (!res.ok && res.status >= 500) {
          await res.text();
        }
      } catch {
        const ns = Number(process.hrtime.bigint() - start);
        push(false, 500, ns);
      }
    }
  }

  console.error(
    JSON.stringify({ phase: 'start', url: URL_BASE, concurrency: CONCURRENCY, durationMs: DURATION_MS, walletId }),
  );

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const seconds = DURATION_MS / 1000;

  // outbox lag a partir de /metrics
  let outboxLag = -1;
  try {
    const m = await fetch(`${URL_BASE}/metrics`);
    const text = await m.text();
    const match = text.match(/^wager_outbox_lag\s+(\d+)/m);
    if (match) outboxLag = Number(match[1]);
  } catch {
    /* métricas indisponíveis */
  }

  // consistência final
  const recon = await fetch(`${URL_BASE}/wallets/${walletId}/reconciliation`, {
    method: 'POST',
  });
  const reconciliation = await recon.json();

  const report = {
    environment: { url: URL_BASE, concurrency: CONCURRENCY, durationMs: DURATION_MS, amount: AMOUNT },
    requests: total,
    throughputRps: Number((total / seconds).toFixed(2)),
    latencyMs: {
      p50: Number((percentile(latencies, 50) / 1e6).toFixed(2)),
      p95: Number((percentile(latencies, 95) / 1e6).toFixed(2)),
      p99: Number((percentile(latencies, 99) / 1e6).toFixed(2)),
    },
    results: counters,
    errorRate: total > 0 ? Number(((counters.errors + counters.conflict) / total).toFixed(4)) : 0,
    concurrencyConflicts: counters.conflict,
    outboxLag,
    reconciliation,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main();
