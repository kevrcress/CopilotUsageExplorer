// Model tiers, matching the "Model Selection" framing used when presenting:
// Lightweight (quick/simple), Versatile (most dev work), Frontier (use sparingly).

export type ModelTier = 'frontier' | 'versatile' | 'lightweight';

/** Bucket a model id into a usage tier by name. Order matters: check the
 *  cheap "mini/flash/haiku" markers first so e.g. "gpt-5 mini" doesn't match
 *  the broader "gpt-5" versatile rule. */
export function modelTier(model: string): ModelTier {
  const m = model.toLowerCase();
  if (m.includes('mini') || m.includes('flash') || m.includes('haiku')) return 'lightweight';
  if (m.includes('opus') || m.includes('gpt-5.5')) return 'frontier';
  if (m.includes('sonnet') || m.includes('codex') || m.includes('gpt-5') || (m.includes('gemini') && m.includes('pro'))) return 'versatile';
  return 'lightweight';
}

export function tierLabel(tier: ModelTier): string {
  return tier === 'frontier' ? 'Frontier' : tier === 'versatile' ? 'Versatile' : 'Lightweight';
}

/** Badge color for a tier — frontier reads as "expensive, use sparingly". */
export function tierBadgeVariant(tier: ModelTier): 'destructive' | 'default' | 'outline' {
  return tier === 'frontier' ? 'destructive' : tier === 'versatile' ? 'default' : 'outline';
}
