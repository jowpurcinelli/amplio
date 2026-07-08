// Billing plans. Deliberately simple and self-host friendly: the default is a
// generous free tier, and the limit is a monthly event count. A real payment
// provider (Stripe) is not wired here; upgrading just records the chosen plan,
// so self-hosters run unrestricted and a hosted deployment can layer billing on
// top later without touching this shape.

export type PlanId = "free" | "pro" | "scale";

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly included events. null means unlimited (self-host / enterprise). */
  monthlyEvents: number | null;
  priceUsd: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", monthlyEvents: 1_000_000, priceUsd: 0 },
  pro: { id: "pro", name: "Pro", monthlyEvents: 10_000_000, priceUsd: 49 },
  scale: { id: "scale", name: "Scale", monthlyEvents: null, priceUsd: 199 },
};

export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(v: unknown): v is PlanId {
  return v === "free" || v === "pro" || v === "scale";
}

/** Monthly event allowance for a plan, or null for unlimited. */
export function planLimit(plan: PlanId): number | null {
  return PLANS[plan].monthlyEvents;
}
