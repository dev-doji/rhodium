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
  const seen = new Set<string>();
  const duplicates: string[] = [];
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
    // The FIRST occurrence wins, which is the opposite of what most people
    // assume when they append an override to the bottom of a file. A duplicate
    // that silently loses is how someone ends up running against LIVE Paystack
    // and LIVE OnSwitch while believing they had set everything to mock.
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    if (process.env[key] === undefined) process.env[key] = value;
  }

  if (duplicates.length) {
    const list = [...new Set(duplicates)].join(", ");
    process.stderr.write(
      `[env] ${path} sets these more than once: ${list}. The FIRST value wins — ` +
        "the later one is ignored. Delete the duplicate so the file says what it does.\n",
    );
  }
}
