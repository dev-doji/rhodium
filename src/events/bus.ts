import type { DomainEvent, DomainEventName } from "./types.js";
import type { IdempotencyStore } from "./idempotency.js";
import { logger } from "../lib/logger.js";

type Handler = (event: DomainEvent) => Promise<void>;

const log = logger("event-bus");

/**
 * Minimal durable-shaped event queue with:
 *  - idempotent dispatch (a replayed event with the same key is dropped),
 *  - bounded retry with backoff,
 *  - a dead-letter list for events that exhaust retries.
 *
 * In prod, swap the in-process loop for SQS/PubSub or Redis+BullMQ behind
 * this same `publish` surface. The idempotency semantics stay identical.
 */
export class EventBus {
  private handlers = new Map<DomainEventName, Handler[]>();
  readonly deadLetters: { key: string; event: DomainEvent; error: string }[] =
    [];

  constructor(
    private idempotency: IdempotencyStore,
    private opts: { maxAttempts?: number } = {},
  ) {}

  on(name: DomainEventName, handler: Handler): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  /**
   * Publish an event. `idempotencyKey` dedupes at the *business event* level:
   * the same order.paid replayed (e.g. duplicate webhook) is processed once.
   */
  async publish(idempotencyKey: string, event: DomainEvent): Promise<void> {
    const fresh = await this.idempotency.reserve(idempotencyKey);
    if (!fresh) {
      log.info({ idempotencyKey, event: event.name }, "duplicate event dropped");
      return;
    }
    const handlers = this.handlers.get(event.name) ?? [];
    const maxAttempts = this.opts.maxAttempts ?? 3;

    for (const handler of handlers) {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt++;
        try {
          await handler(event);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt >= maxAttempts) {
            log.error(
              { idempotencyKey, event: event.name, attempt, err: msg },
              "handler exhausted retries -> dead letter",
            );
            this.deadLetters.push({ key: idempotencyKey, event, error: msg });
            break;
          }
          log.warn(
            { idempotencyKey, event: event.name, attempt, err: msg },
            "handler failed, retrying",
          );
          await sleep(2 ** attempt * 10);
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
