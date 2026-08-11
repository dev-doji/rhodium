import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";

const traceStore = new AsyncLocalStorage<{ traceId: string }>();

export const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    // Never log secrets or raw PII / financial identifiers.
    paths: [
      "*.password",
      "*.secret",
      "*.token",
      "*.access_token",
      "accountNumber",
      "*.accountNumber",
      "authorization",
      "*.authorization",
    ],
    censor: "[redacted]",
  },
});

export type Logger = pino.Logger;

/** Run `fn` inside a trace context; all logs within carry the traceId. */
export function withTrace<T>(traceId: string, fn: () => T): T {
  return traceStore.run({ traceId }, fn);
}

export function currentTraceId(): string | undefined {
  return traceStore.getStore()?.traceId;
}

export function logger(component: string): Logger {
  return baseLogger.child({ component, get traceId() {
    return currentTraceId();
  } });
}
