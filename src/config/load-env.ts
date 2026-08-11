import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader (no dependency). Loads key=value lines into process.env
 * WITHOUT overriding variables already set in the real environment — so the
 * shell / CI / container config always wins over the file. Call this at the top
 * of every runnable entrypoint (server, demo, smoke tests) before loadConfig().
 * Tests deliberately do NOT call it: they set process.env themselves.
 */
export function loadEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
