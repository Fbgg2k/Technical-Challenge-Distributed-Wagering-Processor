import { describe, expect, test } from 'bun:test';
import { canonicalPayloadHash, stableStringify } from '../../src/application/shared/payload-hash';

describe('canonical payload hash', () => {
  test('ordena chaves recursivamente e omite campos undefined', () => {
    expect(stableStringify({ z: 1, nested: { b: 2, a: 1 }, omitted: undefined })).toBe(
      '{"nested":{"a":1,"b":2},"z":1}',
    );
  });

  test('a ordem das propriedades não altera o hash do payload de negócio', () => {
    const first = canonicalPayloadHash({
      providerId: 'provider-a',
      money: { amount: '10.00', currency: 'BRL' },
      roundId: 'round-1',
    });
    const reordered = canonicalPayloadHash({
      roundId: 'round-1',
      money: { currency: 'BRL', amount: '10.00' },
      providerId: 'provider-a',
    });

    expect(first).toBe(reordered);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
