import { describe, test, expect } from 'bun:test';
import { Wallet, InsufficientFundsError } from '../../src/domain/wallet/entities/wallet.entity';
import { Money } from '../../src/domain/wallet/value-objects/money.vo';

const m = (v: string) => Money.from({ amount: v, currency: 'BRL' });

function newWallet(balance = '100.00'): Wallet {
  return Wallet.open({
    id: 'w1',
    playerId: 'p1',
    initialBalance: m(balance),
  });
}

describe('Wallet', () => {
  test('abre com version 1 e saldo inicial', () => {
    const w = newWallet('100.00');
    expect(w.balance.toString()).toBe('100.00 BRL');
    expect(w.version).toBe(1);
  });

  test('debit/credit incrementam version somente quando o saldo muda', () => {
    const w = newWallet('100.00');
    w.credit(m('0.00'));
    expect(w.version).toBe(1);
    w.debit(m('50.00'));
    expect(w.version).toBe(2);
    expect(w.balance.toString()).toBe('50.00 BRL');
  });

  test('saldo nunca negativo', () => {
    const w = newWallet('50.00');
    expect(() => w.debit(m('50.01'))).toThrow(InsufficientFundsError);
    expect(w.balance.toString()).toBe('50.00 BRL');
  });

  test('conflito de moeda rejeitado', () => {
    const w = newWallet('100.00');
    expect(() => w.debit(Money.from({ amount: '10.00', currency: 'USD' }))).toThrow();
  });

  test('rehydrate não revalida', () => {
    const w = Wallet.rehydrate({
      id: 'w1',
      playerId: 'p1',
      currency: 'BRL',
      balanceAmount: '100.00',
      version: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(w.version).toBe(7);
    expect(w.balance.toString()).toBe('100.00 BRL');
  });
});
