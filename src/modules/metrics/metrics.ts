/**
 * Metrics (§1.6, §2.5, §4). Unit economics + reliability counters, with the
 * WhatsApp conversation cost tracked from day one as a first-class metric.
 * In prod, back this with StatsD/Prometheus; the surface stays the same.
 */
export interface Metrics {
  increment(name: string, by?: number): void;
  observe(name: string, value: number): void;
  snapshot(): Record<string, number>;
}

const WHATSAPP_CONVERSATION_COST_NGN = 12; // [VALIDATE] Meta per-conversation

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  observe(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[k] = v;
    for (const [k, v] of this.gauges) out[k] = v;
    const convos = this.counters.get("whatsapp_conversations_total") ?? 0;
    out["whatsapp_cost_ngn_estimate"] = convos * WHATSAPP_CONVERSATION_COST_NGN;
    return out;
  }
}
