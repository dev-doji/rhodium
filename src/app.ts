import type { AppConfig } from "./config/index.js";
import { loadConfig } from "./config/index.js";
import type { Repositories } from "./db/repositories.js";
import { createInMemoryRepositories } from "./db/memory/in-memory-repositories.js";
import type { IdempotencyStore } from "./events/idempotency.js";
import { InMemoryIdempotencyStore } from "./events/idempotency.js";
import { EventBus } from "./events/bus.js";
import { buildRegistry, type RailRegistry } from "./rails/registry.js";
import { type Clock, systemClock } from "./lib/clock.js";

import { CommerceService } from "./modules/commerce/commerce-service.js";
import { PaymentsOrchestrator } from "./modules/payments/payments-orchestrator.js";
import { wirePaymentEvents } from "./modules/payments/wiring.js";
import { LedgerService } from "./modules/ledger/ledger-service.js";
import { NotificationService } from "./modules/notification/notification-service.js";
import type { NotificationTransport } from "./modules/notification/transport.js";
import { WhatsAppService } from "./modules/whatsapp/whatsapp-service.js";
import { ConversationStore } from "./modules/whatsapp/conversation-store.js";
import { WhatsAppCloudTransport } from "./modules/whatsapp/cloud-transport.js";
import { AuthService } from "./modules/auth/auth-service.js";
import { ReconciliationJob } from "./jobs/reconciliation-job.js";
import { TractionService } from "./modules/traction/traction-service.js";
import { AuditService, InMemoryAuditSink, type AuditSink } from "./modules/audit/audit-service.js";
import { InMemoryMetrics, type Metrics } from "./modules/metrics/metrics.js";
import { InMemoryObjectStore, LocalObjectStore, type ObjectStore } from "./modules/storage/object-store.js";

export interface App {
  config: AppConfig;
  repos: Repositories;
  rails: RailRegistry;
  bus: EventBus;
  metrics: Metrics;
  commerce: CommerceService;
  payments: PaymentsOrchestrator;
  ledger: LedgerService;
  notifications: NotificationService;
  whatsapp: WhatsAppService;
  auth: AuthService;
  reconciliation: ReconciliationJob;
  traction: TractionService;
  waTransport: NotificationTransport;
}

export interface BuildAppDeps {
  config?: AppConfig;
  repos?: Repositories;
  idempotency?: IdempotencyStore;
  clock?: Clock;
  metrics?: Metrics;
  auditSink?: AuditSink;
  objectStore?: ObjectStore;
  /** Override channels (tests use CaptureTransport). Defaults to WhatsApp first. */
  notificationChannels?: NotificationTransport[];
}

/**
 * Composition root. One place wires the modular monolith together, so module
 * boundaries stay clean and everything is swappable (in-memory vs Postgres,
 * mock vs live rails, capture vs live WhatsApp) for tests and environments.
 */
export function buildApp(deps: BuildAppDeps = {}): App {
  const config = deps.config ?? loadConfig();
  const clock = deps.clock ?? systemClock;
  const repos = deps.repos ?? createInMemoryRepositories(clock);
  const idempotency = deps.idempotency ?? new InMemoryIdempotencyStore();
  const metrics = deps.metrics ?? new InMemoryMetrics();
  const auditSink = deps.auditSink ?? new InMemoryAuditSink();
  const objectStore =
    deps.objectStore ??
    (config.OBJECT_STORE_MODE === "local" ? new LocalObjectStore() : new InMemoryObjectStore());

  const bus = new EventBus(idempotency);
  const rails = buildRegistry(config);
  const audit = new AuditService(auditSink);

  const waTransport =
    (deps.notificationChannels?.find((c) => c.channel === "whatsapp")) ??
    new WhatsAppCloudTransport({
      mode: config.WHATSAPP_MODE,
      accessToken: config.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    });

  const channels = deps.notificationChannels ?? [waTransport];

  const ledger = new LedgerService(repos);
  const notifications = new NotificationService(repos, channels, metrics);
  const commerce = new CommerceService(repos, objectStore, clock);
  const payments = new PaymentsOrchestrator(repos, rails, bus, clock, metrics, audit);
  const conversations = new ConversationStore();
  const whatsapp = new WhatsAppService(
    waTransport,
    commerce,
    payments,
    ledger,
    repos,
    conversations,
    { publicBaseUrl: config.PUBLIC_BASE_URL, waNumber: config.WHATSAPP_WA_NUMBER },
  );
  const auth = new AuthService(repos, clock, async (phone, code) => {
    await waTransport.send(phone, `Your Rhodium code is ${code}. Expires in 5 min.`);
  });
  const reconciliation = new ReconciliationJob(repos, rails, metrics, { pollProvider: true });
  const traction = new TractionService(repos);

  // Wire the downstream event chain: order.paid → receipt → ledger.entry.
  wirePaymentEvents({ bus, ledger, notifications, repos });

  return {
    config,
    repos,
    rails,
    bus,
    metrics,
    commerce,
    payments,
    ledger,
    notifications,
    whatsapp,
    auth,
    reconciliation,
    traction,
    waTransport,
  };
}
