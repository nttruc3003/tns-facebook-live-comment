import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesLotto, parseLottoNumbers } from '../src/lotto.js';

test('Lotto matches three distinct called numbers in any order', () => {
  const called = parseLottoNumbers('15 20 25 35 46 78')!;
  assert.equal(matchesLotto(['35', '20', '15'], called), true);
  for (const values of [
    ['35', '20', ''],
    ['35', '20', '99'],
    ['35', '35', '20'],
  ])
    assert.equal(matchesLotto(values, called), false);
  assert.equal(matchesLotto(['05', '20', '15'], ['5', '20', '15']), true);
  assert.equal(matchesLotto(['5', '05', '15'], ['5', '15', '20']), false);
  assert.deepEqual(parseLottoNumbers('05, 5; 20 15'), ['5', '20', '15']);
  for (const invalid of ['', '15 abc', '-5 20', '3.5'])
    assert.equal(parseLottoNumbers(invalid), null);
});
