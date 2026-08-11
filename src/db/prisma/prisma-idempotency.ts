import type { PrismaClient } from "@prisma/client";
import type { IdempotencyStore } from "../../events/idempotency.js";
import type { AuditSink, AuditEntry } from "../../modules/audit/audit-service.js";

/**
 * Postgres-backed idempotency: a unique primary key on `processed_event` means
 * a second reserve() of the same key hits a unique-violation and returns false.
 * This survives process restarts — the in-memory store does not.
 */
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private db: PrismaClient) {}
  async reserve(key: string): Promise<boolean> {
    try {
      await this.db.processedEvent.create({ data: { key } });
      return true;
    } catch {
      return false; // unique violation => already processed
    }
  }
  async seen(key: string): Promise<boolean> {
    const row = await this.db.processedEvent.findUnique({ where: { key } });
    return row != null;
  }
}

export class PrismaAuditSink implements AuditSink {
  constructor(private db: PrismaClient) {}
  async write(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: entry.id,
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: (entry.metadata ?? {}) as object,
        createdAt: entry.createdAt,
      },
    });
  }
}
