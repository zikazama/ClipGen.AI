import { describe, expect, it } from 'vitest';

import { secondsPerDayFor, toMicroUsd, wouldExceed, windowBucket } from './limit-rules.js';

const HOUR = 3600_000;
const DAY = 86_400_000;

describe('windowBucket', () => {
  it('groups timestamps into fixed windows', () => {
    expect(windowBucket(0, HOUR)).toBe(0);
    expect(windowBucket(HOUR - 1, HOUR)).toBe(0);
    expect(windowBucket(HOUR, HOUR)).toBe(1);
    expect(windowBucket(2 * HOUR + 5, HOUR)).toBe(2);
  });

  it('gives every timestamp in a day the same bucket', () => {
    expect(windowBucket(0, DAY)).toBe(windowBucket(DAY - 1, DAY));
    expect(windowBucket(DAY, DAY)).toBe(windowBucket(DAY - 1, DAY) + 1);
  });
});

describe('wouldExceed', () => {
  it('allows usage exactly at the limit', () => {
    expect(wouldExceed(9, 1, 10)).toBe(false);
  });

  it('blocks usage past the limit', () => {
    expect(wouldExceed(10, 1, 10)).toBe(true);
    expect(wouldExceed(0, 11, 10)).toBe(true);
  });

  it('works for fractional budgets such as micro dollars', () => {
    expect(wouldExceed(1_000_000, 2_000_000, 3_000_000)).toBe(false);
    expect(wouldExceed(1_000_000, 2_000_001, 3_000_000)).toBe(true);
  });
});

describe('secondsPerDayFor', () => {
  const limits = { guestSecondsPerDay: 8, userSecondsPerDay: 120 };

  it('gives guests the trial limit', () => {
    expect(secondsPerDayFor({ guest: true }, limits)).toBe(8);
  });

  it('gives signed in users the full limit', () => {
    expect(secondsPerDayFor({ guest: false }, limits)).toBe(120);
    expect(secondsPerDayFor({}, limits)).toBe(120);
  });
});

describe('toMicroUsd', () => {
  it('turns dollars into integer micro dollars', () => {
    expect(toMicroUsd(1)).toBe(1_000_000);
    expect(toMicroUsd(2.65)).toBe(2_650_000);
  });

  it('rounds up so a cheap call still costs something', () => {
    expect(toMicroUsd(0.002)).toBe(2000);
    expect(toMicroUsd(0.0000001)).toBe(1);
  });
});
