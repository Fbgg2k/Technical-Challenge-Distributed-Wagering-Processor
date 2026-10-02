import { describe, test, expect } from 'bun:test';
import { Money, InvalidMoneyError } from '../../src/domain/wallet/value-objects/money.vo';

describe('Money', () => {
  test('cria com escala fixa de 2 casas', () => {
    expect(Money.from({ amount: '25.0', currency: 'BRL' }).toString()).toBe('25.00 BRL');
    expect(Money.from({ amount: '25', currency: 'BRL' }).toString()).toBe('25.00 BRL');
  });

  test('operações mantêm imutabilidade', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '5.00', currency: 'BRL' });
    const sum = a.add(b);
    expect(a.toString()).toBe('10.00 BRL');
    expect(sum.toString()).toBe('15.00 BRL');
  });

  test('add/subtract/negate', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    expect(a.add(Money.from({ amount: '2.50', currency: 'BRL' })).toString()).toBe('12.50 BRL');
    expect(a.subtract(Money.from({ amount: '2.50', currency: 'BRL' })).toString()).toBe('7.50 BRL');
    expect(a.negate().toString()).toBe('-10.00 BRL');
  });

  test('comparações', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.zero('BRL');
    expect(b.isZero()).toBe(true);
    expect(a.isPositive()).toBe(true);
    expect(b.isNegative()).toBe(false);
    expect(a.isLessThan(Money.from({ amount: '11.00', currency: 'BRL' }))).toBe(true);
    expect(a.equals(Money.from({ amount: '10.00', currency: 'BRL' }))).toBe(true);
  });

  test('rejeita NaN, Infinity, notação científica, vazio, >2 casas, string inválida', () => {
    expect(() => Money.from({ amount: 'NaN', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: 'Infinity', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '1.005', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: 'abc', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '10.00', currency: 'brl' })).toThrow(InvalidMoneyError);
  });

  test('conflito de moeda lança erro', () => {
    const brl = Money.from({ amount: '10.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });
    expect(() => brl.add(usd)).toThrow(InvalidMoneyError);
    expect(() => brl.subtract(usd)).toThrow(InvalidMoneyError);
    expect(() => brl.isLessThan(usd)).toThrow(InvalidMoneyError);
  });

  test('toJSON serializa como string decimal', () => {
    expect(Money.from({ amount: '25.00', currency: 'BRL' }).toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
  });
});
