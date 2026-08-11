import { id } from "../../lib/ids.js";

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditSink {
  write(entry: AuditEntry): Promise<void>;
}

/** Append-only audit log on ledger + money-adjacent actions (§2.5 security). */
export class AuditService {
  constructor(private sink: AuditSink) {}
  async record(input: {
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.sink.write({ id: id("aud"), createdAt: new Date(), ...input });
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}
