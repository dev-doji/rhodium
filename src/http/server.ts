import { loadEnv } from "../config/load-env.js";
loadEnv();
import { loadConfig } from "../config/index.js";
import { buildApp, type App } from "../app.js";
import { buildPostgresApp } from "../db/prisma/postgres-app.js";
import { buildApi } from "./api.js";
import { logger } from "../lib/logger.js";

const log = logger("server");

function makeApp(): App {
  const config = loadConfig();
  if (config.DATABASE_URL) {
    log.info("using Postgres persistence");
    return buildPostgresApp();
  }
  log.warn("DATABASE_URL not set — using in-memory persistence (dev only)");
  return buildApp();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = makeApp();
  const server = buildApi(app);

  // Daily reconciliation (§2.5). Cron in prod; setInterval is fine for the MVP.
  const DAY = 24 * 3600 * 1000;
  const timer = setInterval(() => {
    app.reconciliation
      .run()
      .then((r) => log.info({ clean: r.clean, drift: r.drift.length }, "reconciliation ran"))
      .catch((err) => log.error({ err: err.message }, "reconciliation failed"));
  }, DAY);
  timer.unref();

  const http = server.listen(config.PORT, () => {
    log.info(
      {
        port: config.PORT,
        fiat: config.FIAT_ADAPTER_MODE,
        whatsapp: config.WHATSAPP_MODE,
        stablecoin: config.FEATURE_STABLECOIN_ENABLED,
      },
      "Rhodium API listening",
    );
  });

  const shutdown = (): void => {
    log.info("shutting down");
    http.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error({ err: err.message }, "failed to start");
  process.exit(1);
});
