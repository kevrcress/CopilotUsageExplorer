import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { formatTokens } from '@/lib/tokens';
import { modelTier, tierBadgeVariant } from '@/lib/models';
import { computeInsights, computeAnalytics, useFilteredSessions } from '@/lib/insights';
import { DateRangeFilter } from '@/components/DateRangeFilter';

export function Optimize() {
  const { workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel } = useAppStore();
  const list = useFilteredSessions();

  const insights = useMemo(() => computeInsights(list), [list]);
  const analytics = useMemo(
    () => computeAnalytics(list, { workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel }),
    [list, workspaceNames, dateRangeStart, dateRangeEnd, dateRangeLabel]
  );

  if (!insights) return (
    <div className="space-y-4">
      <DateRangeFilter />
      <p className="text-sm text-muted-foreground">No sessions found for the selected period. Try expanding the date range.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <DateRangeFilter />

      {/* Recommendations — the headline */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Optimization tips</CardTitle>
            {insights.totalAiCredits !== null && (
              <Badge variant="outline" className="text-xs font-normal">{insights.totalAiCredits.toFixed(2)} AIC this period</Badge>
            )}
          </div>
          <CardDescription>
            {insights.findings.length > 0
              ? `${insights.findings.length} opportunit${insights.findings.length === 1 ? 'y' : 'ies'} detected from your actual usage, plus general tips.`
              : 'No notable inefficiencies detected for this period — here are general tips.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {insights.recommendations.map((rec, i) => (
              <div key={i} className="rounded border bg-muted/30 p-3">
                <div className="flex items-start gap-3">
                  <rec.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{rec.title}</div>
                    <div className="text-xs text-muted-foreground whitespace-pre-line">{rec.text}</div>
                    <div className="text-xs font-medium text-primary">{rec.impact}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Model usage with tiers */}
      <Card>
        <CardHeader>
          <CardTitle>Model usage</CardTitle>
          <CardDescription>
            Which models you used and how many tokens each consumed. Models you didn't explicitly choose (e.g. a mini model for
            title generation) are automatic background calls by Copilot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Model</th>
                <th className="text-left">Tier</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Input</th>
                <th className="text-right">Output</th>
                <th className="text-right">Avg input/call</th>
              </tr>
            </thead>
            <tbody>
              {insights.modelRows.map((m) => (
                <tr key={m.model} className="border-t">
                  <td className="py-1.5 font-mono">{m.model}</td>
                  <td><Badge variant={tierBadgeVariant(modelTier(m.model))}>{m.tier}</Badge></td>
                  <td className="text-right">{m.calls}</td>
                  <td className="text-right">{formatTokens(m.inputTokens)}</td>
                  <td className="text-right">{formatTokens(m.outputTokens)}</td>
                  <td className="text-right">{formatTokens(m.avgInputPerCall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {insights.bgModels.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              <strong>Background calls detected:</strong>{' '}
              {insights.bgModels.map((b) => `${b.model} (${b.calls} calls, ${formatTokens(b.totalTokens)} tokens)`).join('; ')}.
              These are automatic (title generation, embeddings, etc.) — not triggered by your model selection.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Where the tokens go: by model / by workspace */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Tokens by model</CardTitle><CardDescription>{dateRangeLabel}</CardDescription></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.modelRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="model" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => formatTokens(v)} width={48} />
                <Tooltip formatter={(v: number) => formatTokens(v)} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="tokens" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Tokens by workspace</CardTitle><CardDescription>{dateRangeLabel} · friendly names from Settings</CardDescription></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.wsRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="workspace" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => formatTokens(v)} width={48} />
                <Tooltip formatter={(v: number) => formatTokens(v)} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="tokens" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tool usage */}
      <Card>
        <CardHeader>
          <CardTitle>Tool usage</CardTitle>
          <CardDescription>
            Every tool call adds tokens: the invocation itself plus the result text get appended to conversation context.
            More tool calls = more context = more tokens for subsequent messages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-1 text-xs md:grid-cols-2">
            {insights.toolRows.map((t) => (
              <div key={t.tool} className="flex items-center justify-between border-b py-1">
                <span className="font-mono">{t.tool}</span>
                <span>
                  <strong>{t.calls}</strong>
                  {t.failed > 0 && <span className="ml-1 text-destructive">({t.failed} failed)</span>}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
