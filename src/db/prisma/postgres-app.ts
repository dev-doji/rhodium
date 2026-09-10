import { buildApp, type App } from "../../app.js";
import { loadConfig } from "../../config/index.js";
import { PostgresSharedStore } from "../../modules/state/shared-store.js";
import { prisma } from "./client.js";
import { createPrismaRepositories } from "./prisma-repositories.js";
import { PrismaIdempotencyStore, PrismaAuditSink } from "./prisma-idempotency.js";
import { PostgresObjectStore } from "../../modules/storage/object-store.js";

/**
 * Production composition: the same modular monolith wired to Postgres instead
 * of the in-memory stores. Everything else (rails, services, event chain) is
 * byte-for-byte identical to the test/demo wiring.
 */
export function buildPostgresApp(): App {
  const config = loadConfig();
  const db = prisma();
  return buildApp({
    config,
    repos: createPrismaRepositories(db),
    // Shared across instances, so a rate limit and a one-time code mean the
    // same thing on all of them.
    sharedState: new PostgresSharedStore(db),
    idempotency: new PrismaIdempotencyStore(db),
    auditSink: new PrismaAuditSink(db),
  });
}
