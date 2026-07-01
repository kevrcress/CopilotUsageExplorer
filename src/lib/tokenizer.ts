/** Lazy tokenizer wrapper. Returns null tokens count if no compatible tokenizer ships.
 *  We deliberately avoid bundling tiktoken/anthropic-tokenizer up-front; the user
 *  can install them and we'll pick them up dynamically. For now we provide a
 *  cheap heuristic estimate so the system-prompt viewer has a "tokens" column.
 */

export interface TokenEstimate {
  tokens: number;
  method: 'heuristic' | 'tiktoken' | 'anthropic';
}

/** ~4 chars per token for English; close enough for sizing the system prompt. */
export function heuristicTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export async function estimateTokens(text: string, _model?: string): Promise<TokenEstimate> {
  // Hook point for future lazy-loaded tokenizers. Keep API async so callers don't need to change.
  return { tokens: heuristicTokenCount(text), method: 'heuristic' };
}
