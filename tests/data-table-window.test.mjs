import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableWindow } from '../src/components/dataTableWindow.mjs';

test('2550 matching rows keep a bounded initial window and the full scroll height', () => {
  const window = getTableWindow(2550, 0, 300);
  assert.equal(window.start, 0);
  assert.ok(window.end <= 17);
  assert.equal(window.before + (window.end - window.start) * 46 + window.after, 2550 * 46);
});

test('a middle scroll includes every row intersecting the body viewport and overscan', () => {
  const window = getTableWindow(2550, 46013, 300);
  assert.ok(window.start <= Math.floor(46013 / 46) - 5);
  assert.ok(window.end >= Math.ceil((46013 + 262) / 46) + 5);
  assert.ok(window.end - window.start <= 17);
  assert.equal(window.before, window.start * 46);
});

test('the bottom window includes row 2550 without a trailing spacer', () => {
  const window = getTableWindow(2550, 2550 * 46, 300);
  assert.equal(window.end, 2550);
  assert.equal(window.after, 0);
  assert.ok(window.start <= 2544);
  assert.ok(window.end - window.start <= 17);
});

test('shrinking or empty results clamp stale scroll positions without negative spacers', () => {
  assert.deepEqual(getTableWindow(0, 100000, 300), { start: 0, end: 0, before: 0, after: 0 });
  assert.deepEqual(getTableWindow(3, 100000, 300), { start: 0, end: 3, before: 0, after: 0 });
  assert.deepEqual(getTableWindow(3, -100, 300), { start: 0, end: 3, before: 0, after: 0 });
});

test('a resized taller viewport covers its body without making the window grow with the dataset', () => {
  const window = getTableWindow(50000, 12001, 600);
  assert.ok(window.start <= Math.floor(12001 / 46));
  assert.ok(window.end >= Math.ceil((12001 + 562) / 46));
  assert.ok(window.end - window.start <= 24);
});
