import type { Flag } from "./types.js";

/** Deterministic hash of a string into [0, 1). FNV-1a, no dependencies. */
function hash01(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
}

export interface FlagEvaluation {
  on: boolean;
  variant: string | null;
}

/**
 * Evaluate a flag for a unit (usually a user or device id). Deterministic and
 * stable: the same flag + unit always resolves the same way, so rollouts and
 * experiment assignments are sticky without server state.
 *
 * rollout gates inclusion (0-100%). Included units with variants get a
 * weighted variant; without variants they are simply on.
 */
export function evaluateFlag(flag: Flag, unit: string): FlagEvaluation {
  if (!flag.enabled) return { on: false, variant: null };

  const frac = Math.max(0, Math.min(100, flag.rollout)) / 100;
  if (hash01(`${flag.key}:${unit}`) >= frac) return { on: false, variant: null };

  const variants = flag.variants ?? [];
  if (variants.length === 0) return { on: true, variant: null };

  const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (total <= 0) return { on: true, variant: variants[0]!.key };

  let r = hash01(`${flag.key}:variant:${unit}`) * total;
  for (const v of variants) {
    r -= Math.max(0, v.weight);
    if (r < 0) return { on: true, variant: v.key };
  }
  return { on: true, variant: variants[variants.length - 1]!.key };
}
