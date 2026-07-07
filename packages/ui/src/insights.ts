import { useMemo } from 'react';
import type { ParsedSession } from '@cue/core';
import { useAppStore } from './store';

const MIN_VALID_TS = new Date('2020-01-01').getTime();

/** Apply the active date-range filter (and drop epoch-0 / invalid sessions). */
export function useFilteredSessions(): ParsedSession[] {
  const { sessions, dateRangeStart, dateRangeEnd } = useAppStore();
  return useMemo(() => {
    const effectiveEnd = dateRangeEnd ?? Date.now();
    return Object.values(sessions).filter((s) => {
      if (s.startedAt <= MIN_VALID_TS) return false;
      if (dateRangeStart !== null && s.startedAt < dateRangeStart) return false;
      if (s.startedAt > effectiveEnd) return false;
      return true;
    });
  }, [sessions, dateRangeStart, dateRangeEnd]);
}
