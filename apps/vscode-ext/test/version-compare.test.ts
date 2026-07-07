import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/version-compare';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns >0 when a is newer (major/minor/patch)', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
  });

  it('returns <0 when a is older', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('treats missing trailing parts as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });

  it('treats non-numeric parts as 0 rather than throwing', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersions('rc.1.0', '0.1.0')).toBe(0);
  });
});
