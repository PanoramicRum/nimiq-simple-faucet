import { describe, expect, it } from 'vitest';
import {
  isValidNimiqAddress,
  normalizeNimiqAddress,
} from '../src/nimiqAddress.js';

describe('nimiqAddress helpers', () => {
  it('normalizes lowercase and extra spacing', () => {
    expect(normalizeNimiqAddress('  nq31   qaka 1u1h c1bj pqck bl16 sl5v ql4g ktev  ')).toBe(
      'NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV',
    );
  });

  it('accepts valid grouped and compact forms', () => {
    expect(isValidNimiqAddress('NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV')).toBe(true);
    expect(isValidNimiqAddress('NQ31QAKA1U1HC1BJPQCKBL16SL5VQL4GKTEV')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidNimiqAddress('')).toBe(false);
    expect(isValidNimiqAddress('NQ31 QAKA')).toBe(false);
    expect(isValidNimiqAddress('NO31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV')).toBe(false);
    expect(isValidNimiqAddress('NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTE!')).toBe(false);
  });
});
