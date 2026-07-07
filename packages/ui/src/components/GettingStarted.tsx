import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Activity, BarChart3, FolderOpen, FileText, Settings as SettingsIcon, MessageSquare } from 'lucide-react';

export function GettingStarted() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome to Copilot Usage Explorer</h2>
        <p className="mt-2 text-muted-foreground">
          A local tool for analyzing GitHub Copilot debug logs to understand your token usage and read back your sessions as a chat.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is this tool?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Copilot Usage Explorer helps you analyze your GitHub Copilot usage by processing local debug logs (JSONL files)
            that Copilot generates during your coding sessions. It provides insights into:
          </p>
          <ul className="ml-6 list-disc space-y-1 text-sm">
            <li>Token usage (input/output) across all your sessions</li>
            <li>Model distribution (which AI models you're using most)</li>
            <li>Each session as a readable chat, side-by-side with its raw JSON</li>
            <li>Usage patterns over time</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <p className="font-medium">0. Enable debug file logging in VS Code</p>
            <p className="ml-4 text-sm text-muted-foreground">
              Before debug logs are available, you need to enable file logging in VS Code. Open VS Code settings and enable:
            </p>
            <div className="ml-4">
              <a
                href="vscode://settings/github.copilot.chat.agentDebugLog.fileLogging.enabled"
                className="inline-flex items-center rounded-md bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100 dark:hover:bg-blue-800"
              >
                github.copilot.chat.agentDebugLog.fileLogging.enabled
              </a>
            </div>
            <p className="ml-4 text-xs text-muted-foreground mt-1">
              Click the setting name above to open it directly in VS Code, or search for it manually in Settings.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-medium">1. Ingest your debug logs</p>
            <p className="ml-4 text-sm text-muted-foreground">
              Load JSONL files from your local Copilot debug log directory. The tool parses these files and stores
              session data locally in your browser (using IndexedDB).
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-medium">2. Review and analyze</p>
            <p className="ml-4 text-sm text-muted-foreground">
              Browse sessions, view detailed information, and analyze usage patterns. All processing happens locally
              in your browser—no data is sent to any server.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-medium">3. Read back your conversations</p>
            <p className="ml-4 text-sm text-muted-foreground">
              Open any session to see it rendered as a chat — user prompts, assistant replies, and tool calls — with the
              raw JSON turns available side-by-side. Token counts are shown per session and per model, straight from the log.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tab Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Activity className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Load logs (top-right button)</p>
              <p className="text-sm text-muted-foreground">
                Click <strong>Load logs</strong> in the header to import debug logs from your file system. Re-click anytime
                to pull in newly written sessions.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <BarChart3 className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Dashboard</p>
              <p className="text-sm text-muted-foreground">
                Your at-a-glance home: total tokens, the daily usage trend, your heaviest sessions, and the top few things
                worth optimizing.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <FolderOpen className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Sessions</p>
              <p className="text-sm text-muted-foreground">
                Browse all imported sessions. Click any session to open its Conversation view — a readable chat with the
                raw JSON turns alongside — plus token counts and timing data.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <FileText className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Optimize</p>
              <p className="text-sm text-muted-foreground">
                Usage-pattern recommendations for cutting token usage, plus per-model and per-workspace breakdowns and
                tool-call totals.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <SettingsIcon className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Settings</p>
              <p className="text-sm text-muted-foreground">
                Manage your data, export sessions, and give your workspaces friendly names.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Reading a session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            The Conversation view is the heart of a session:
          </p>
          <ol className="ml-6 list-decimal space-y-2 text-sm">
            <li>
              <span className="font-medium">Open a session from the Sessions tab</span>
              <span className="ml-2 text-muted-foreground">
                — It opens on the Conversation tab by default
              </span>
            </li>
            <li>
              <span className="font-medium">Read it as a chat</span>
              <span className="ml-2 text-muted-foreground">
                — User prompts, assistant replies, and tool calls in order
              </span>
            </li>
            <li>
              <span className="font-medium">Toggle the split</span>
              <span className="ml-2 text-muted-foreground">
                — Show the raw JSON turns beside the chat, or collapse either pane
              </span>
            </li>
            <li>
              <span className="font-medium">Check the token strip</span>
              <span className="ml-2 text-muted-foreground">
                — Per-session turns, LLM calls, and input/output tokens
              </span>
            </li>
          </ol>
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-xs text-amber-900 dark:text-amber-100">
              <strong>Note:</strong> Token counts come straight from the debug log, exactly as Copilot recorded them.
              For actual billing (AI Credits / cost), check GitHub's own usage UI — those numbers aren't in the debug files.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="pb-8 text-center text-sm text-muted-foreground">
        <p>Ready to get started? Click <strong>Load logs</strong> in the top-right to import your first debug logs.</p>
      </div>
    </div>
  );
}
