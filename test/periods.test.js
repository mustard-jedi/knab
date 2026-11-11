import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodFor, periodByLabel, shiftLabel, addDays, isValidDate, nextOccurrence, periodTitle,
} from '../shared/periods.js';

test('cutoff 23: Jan 23 - Feb 22', () => {
  assert.deepEqual(periodByLabel('2026-01', 23), { label: '2026-01', start: '2026-01-23', end: '2026-02-22' });
  assert.equal(periodFor('2026-01-23', 23).label, '2026-01');
  assert.equal(periodFor('2026-02-22', 23).label, '2026-01');
  assert.equal(periodFor('2026-01-22', 23).label, '2025-12');
  assert.equal(periodFor('2026-02-23', 23).label, '2026-02');
});

test('cutoff 1 is the calendar month', () => {
  assert.deepEqual(periodFor('2026-02-14', 1), { label: '2026-02', start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(periodFor('2024-02-29', 1), { label: '2024-02', start: '2024-02-01', end: '2024-02-29' });
});

test('cutoff 31 clamps to the last day of short months', () => {
  assert.deepEqual(periodByLabel('2026-01', 31), { label: '2026-01', start: '2026-01-31', end: '2026-02-27' });
  assert.deepEqual(periodByLabel('2026-02', 31), { label: '2026-02', start: '2026-02-28', end: '2026-03-30' });
  assert.equal(periodFor('2026-02-28', 31).label, '2026-02');
  assert.equal(periodFor('2026-02-27', 31).label, '2026-01');
});

test('periods tile the calendar with no gaps or overlaps', () => {
  for (const cutoff of [1, 15, 23, 29, 30, 31]) {
    let label = '2023-11';
    let prevEnd = null;
    for (let i = 0; i < 40; i++) {
      const p = periodByLabel(label, cutoff);
      if (prevEnd) assert.equal(p.start, addDays(prevEnd, 1), `cutoff ${cutoff} ${label}`);
      assert.equal(periodFor(p.start, cutoff).label, label);
      assert.equal(periodFor(p.end, cutoff).label, label);
      prevEnd = p.end;
      label = shiftLabel(label, 1);
    }
  }
});

test('labels shift across year boundaries', () => {
  assert.equal(shiftLabel('2026-01', -1), '2025-12');
  assert.equal(shiftLabel('2025-12', 1), '2026-01');
  assert.equal(shiftLabel('2026-03', -15), '2024-12');
});

test('date validation', () => {
  assert.ok(isValidDate('2024-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('23/01/2026'));
});

test('recurring dates do not drift', () => {
  assert.equal(nextOccurrence('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(nextOccurrence('2026-12-15', 'monthly', 15), '2027-01-15');
  assert.equal(nextOccurrence('2026-01-05', 'weekly', 5), '2026-01-12');
  assert.equal(nextOccurrence('2026-01-05', 'biweekly', 5), '2026-01-19');
  assert.equal(nextOccurrence('2024-02-29', 'yearly', 29), '2025-02-28');
});

test('period title', () => {
  assert.equal(periodTitle(periodByLabel('2026-01', 23)), 'Jan 23 – Feb 22, 2026');
  assert.equal(periodTitle(periodByLabel('2025-12', 23)), 'Dec 23, 2025 – Jan 22, 2026');
});
