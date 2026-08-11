import { buildApp, type App } from "../../app.js";
import { loadConfig } from "../../config/index.js";
import { prisma } from "./client.js";
import { createPrismaRepositories } from "./prisma-repositories.js";
import { PrismaIdempotencyStore, PrismaAuditSink } from "./prisma-idempotency.js";

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
    idempotency: new PrismaIdempotencyStore(db),
    auditSink: new PrismaAuditSink(db),
  });
}
