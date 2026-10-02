import { createHash } from 'crypto';

/**
 * payloadHash = SHA-256 sobre o JSON canônico (chaves ordenadas recursivamente)
 * do subconjunto de campos de negócio da transação. O header Idempotency-Key e
 * metadados de transporte NÃO entram no hash.
 */
export function canonicalPayloadHash(input: Record<string, unknown>): string {
  const canonical = stableStringify(input);
  return createHash('sha256').update(canonical).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
