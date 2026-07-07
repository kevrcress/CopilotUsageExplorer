import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useAppStore } from '../store';
import { formatTokens } from '@cue/core';
import { computeInsights, computeAnalytics } from '@cue/core';
import { useFilteredSessions } from '../insights';
import { recommendationIcon } from '../icons';
import type { RecommendationIconKey } from '@cue/core';

function RecIcon({ icon, className }: { icon: RecommendationIconKey; className?: string }) {
  const Icon = recommendationIcon(icon);
  return <Icon className={className} />;
}
import { DateRangeFilter } from './DateRangeFilter';
import { GettingStarted } from './GettingStarted';
import { ArrowRight, Lightbulb, Upload } from 'lucide-react';

interface DashboardProps {
  /** Total valid sessions loaded (ignores the date filter) — used to pick the first-run empty state. */
  totalLoaded: number;
  onNavigate: (tab: string) => void;
  onLoadClick: () => void;
}

export function Dashboard({ totalLoaded, onNavigate, onLoadClick }: DashboardProps) {
  const { workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel, selectSession } = useAppStore();
  const list = useFilteredSessions();

  const insights = useMemo(() => computeInsights(list), [list]);
  const analytics = useMemo(
    () => computeAnalytics(list, { workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel }),
    [list, workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel]
  );

  // First run: nothing loaded yet. Show the welcome + a prominent load button.
  if (totalLoaded === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center">
          <Button size="lg" onClick={onLoadClick}>
            <Upload className="h-4 w-4" />
            Load your Copilot debug logs
          </Button>
        </div>
        <GettingStarted />
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="space-y-4">
        <DateRangeFilter />
        <p className="text-sm text-muted-foreground">No sessions found for the selected period. Try expanding the date range.</p>
      </div>
    );
  }

  const openSession = (id: string) => {
    selectSession(id);
    onNavigate('sessions');
  };

  return (
    <div className="space-y-4">
      <DateRangeFilter />

      {/* KPI strip */}
      <div className={`grid gap-3 sm:grid-cols-2 ${insights.totalAiCredits !== null ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Total tokens</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(insights.totalTokens)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{formatTokens(insights.totalInputTokens)} in / {formatTokens(insights.totalOutputTokens)} out</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Cached input</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(insights.totalCachedTokens)}</div>
            <div className="mt-1 text-xs text-muted-foreground">reused context (discounted)</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">LLM calls</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{insights.totalLlmCalls.toLocaleString()}</div>
            <div className="mt-1 text-xs text-muted-foreground">{insights.totalToolCalls.toLocaleString()} tool calls</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Wasted tokens</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" title="Tokens spent on llm_request events that ended in error">{formatTokens(insights.totalWastedTokens)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{insights.totalFailedToolCalls} failed tool calls</div>
          </CardContent>
        </Card>
        {insights.totalAiCredits !== null && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">AI Credits</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{insights.totalAiCredits.toFixed(2)}</div>
              <div className="mt-1 text-xs text-muted-foreground">AIC across {insights.sessionCount} session{insights.sessionCount === 1 ? '' : 's'}</div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Daily trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-2 text-sm">
            Daily token usage
            <Badge variant="outline" className="text-xs font-normal">{insights.sessionCount} session{insights.sessionCount !== 1 ? 's' : ''} · {dateRangeLabel}</Badge>
          </CardTitle>
          <CardDescription>Input &amp; output tokens per day — straight from the debug logs, no estimates.</CardDescription>
        </CardHeader>
        <CardContent style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={analytics.dayRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={10} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => formatTokens(v)} width={48} />
              <Tooltip formatter={(v: number) => formatTokens(v)} contentStyle={{ fontSize: 11 }} />
              <Legend />
              <Line dataKey="input" stroke="hsl(var(--primary))" name="Input tokens" />
              <Line dataKey="output" stroke="hsl(var(--muted-foreground))" name="Output tokens" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top opportunities + top sessions */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><Lightbulb className="h-4 w-4 text-amber-500" />Top optimization opportunities</CardTitle>
            <CardDescription>Based on your actual usage patterns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {insights.findings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No notable inefficiencies detected for this period. See the Optimize tab for general tips.</p>
            ) : (
              insights.findings.slice(0, 3).map((rec, i) => (
                <div key={i} className="rounded border bg-muted/30 p-3">
                  <div className="flex items-start gap-3">
                    <RecIcon icon={rec.icon} className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{rec.title}</div>
                      <div className="text-xs font-medium text-primary">{rec.impact}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
            <Button variant="outline" size="sm" onClick={() => onNavigate('optimize')}>
              View all {insights.recommendations.length} tips <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Heaviest sessions</CardTitle>
            <CardDescription>Top sessions by total tokens · click to open the conversation</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left py-1">Started</th><th className="text-left">Session</th><th className="text-right">LLM calls</th><th className="text-right">Tokens</th></tr>
              </thead>
              <tbody>
                {analytics.top10.slice(0, 5).map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t hover:bg-accent/50" onClick={() => openSession(s.id)}>
                    <td className="py-1.5">{new Date(s.startedAt).toLocaleDateString()}</td>
                    <td><Badge variant="outline" className="font-mono text-[11px]">{s.id.slice(0, 8)}…</Badge></td>
                    <td className="text-right">{s.llmCalls}</td>
                    <td className="text-right font-medium">{formatTokens(s.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => onNavigate('sessions')}>
              Browse all sessions <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
