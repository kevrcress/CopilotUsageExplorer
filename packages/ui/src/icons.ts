import type { LucideIcon } from 'lucide-react';
import {
  TrendingDown, Zap, MessageSquare, Wrench, AlertTriangle, Layers, Target, Lightbulb,
} from 'lucide-react';
import type { RecommendationIconKey } from '@cue/core';

const ICONS: Record<RecommendationIconKey, LucideIcon> = {
  'trending-down': TrendingDown,
  'zap': Zap,
  'message-square': MessageSquare,
  'wrench': Wrench,
  'alert-triangle': AlertTriangle,
  'layers': Layers,
  'target': Target,
  'lightbulb': Lightbulb,
};

/** Map a core recommendation icon key to its lucide component. */
export function recommendationIcon(key: RecommendationIconKey): LucideIcon {
  return ICONS[key] ?? Lightbulb;
}
