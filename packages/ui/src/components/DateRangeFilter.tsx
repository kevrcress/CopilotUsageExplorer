import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { useAppStore } from '../store';

interface Preset {
  label: string;
  start: number | null;
  end: number | null;
}

function buildPresets(): Preset[] {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  return [
    { label: 'This Month', start: new Date(y, mo, 1).getTime(), end: null },
    { label: 'Last Month', start: new Date(y, mo - 1, 1).getTime(), end: new Date(y, mo, 0, 23, 59, 59, 999).getTime() },
    { label: 'Last 3 Months', start: new Date(y, mo - 2, 1).getTime(), end: null },
    { label: 'Last 6 Months', start: new Date(y, mo - 5, 1).getTime(), end: null },
    { label: 'All Time', start: null, end: null },
  ];
}

function fromDateInput(val: string, endOfDay = false): number {
  const [y, m, d] = val.split('-').map(Number);
  if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function DateRangeFilter() {
  const { dateRangeLabel, setDateRange } = useAppStore();
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const presets = buildPresets();
  const isPresetActive = presets.some((p) => p.label === dateRangeLabel);

  function applyPreset(p: Preset) {
    setDateRange(p.start, p.end, p.label);
    setShowCustom(false);
  }

  function applyCustomRange() {
    if (!customFrom && !customTo) return;
    const start = customFrom ? fromDateInput(customFrom) : null;
    const end = customTo ? fromDateInput(customTo, true) : null;
    const label = `${customFrom || '…'} → ${customTo || 'now'}`;
    setDateRange(start, end, label);
    setShowCustom(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 px-3 py-2">
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium text-muted-foreground">Period:</span>
      {presets.map((p) => (
        <Button
          key={p.label}
          size="sm"
          variant={dateRangeLabel === p.label ? 'default' : 'outline'}
          className="h-6 px-2 text-xs"
          onClick={() => applyPreset(p)}
        >
          {p.label}
        </Button>
      ))}
      <Button
        size="sm"
        variant={showCustom || !isPresetActive ? 'default' : 'outline'}
        className="h-6 px-2 text-xs"
        onClick={() => setShowCustom((v) => !v)}
      >
        Custom…
      </Button>
      {!isPresetActive && !showCustom && (
        <span className="ml-1 text-xs text-muted-foreground">{dateRangeLabel}</span>
      )}
      {showCustom && (
        <div className="flex items-center gap-2 ml-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-6 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-6 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button size="sm" className="h-6 px-2 text-xs" onClick={applyCustomRange}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
