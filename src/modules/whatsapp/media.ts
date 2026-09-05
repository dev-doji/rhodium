import { logger } from "../../lib/logger.js";

const log = logger("wa-media");

export interface MediaFetcherConfig {
  accessToken: string;
  graphBase?: string;
}

export interface FetchedMedia {
  bytes: Buffer;
  contentType: string;
}

/**
 * Downloads a photo a vendor sent over WhatsApp.
 *
 * Two calls, because Meta does not hand the bytes back with the webhook: the
 * message carries a media id, that id resolves to a short-lived signed URL,
 * and only then can the file be fetched — and the second request still needs
 * the bearer token, which is the part that silently returns HTML if omitted.
 */
export class MediaFetcher {
  private graphBase: string;

  constructor(
    private cfg: MediaFetcherConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.graphBase = cfg.graphBase ?? "https://graph.facebook.com/v21.0";
  }

  /**
   * Byte ceiling for a product photo.
   *
   * A vendor's phone camera easily produces 8MB, and every one of those would
   * be served to every buyer browsing her shop on a metered connection. Meta
   * caps image messages around 5MB; this refuses anything larger rather than
   * storing it, so the failure is a sentence she can act on instead of a slow
   * storefront nobody diagnoses.
   */
  static readonly MAX_BYTES = 5 * 1024 * 1024;

  private static readonly ALLOWED = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  async fetch(mediaId: string): Promise<FetchedMedia | null> {
    try {
      const metaRes = await this.fetchImpl(`${this.graphBase}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!metaRes.ok) {
        log.warn({ mediaId, status: metaRes.status }, "media lookup failed");
        return null;
      }
      const meta = (await metaRes.json()) as {
        url?: string;
        mime_type?: string;
        file_size?: number;
      };
      if (!meta.url) {
        log.warn({ mediaId }, "media lookup returned no url");
        return null;
      }

      const contentType = (meta.mime_type ?? "image/jpeg").split(";")[0]!.trim();
      if (!MediaFetcher.ALLOWED.has(contentType)) {
        log.warn({ mediaId, contentType }, "unsupported media type");
        return null;
      }
      // Checked before downloading where Meta tells us the size, so an
      // oversized file costs nothing to reject.
      if (meta.file_size && meta.file_size > MediaFetcher.MAX_BYTES) {
        log.warn({ mediaId, size: meta.file_size }, "media too large");
        return null;
      }

      // The signed URL still requires the token — without it Meta answers with
      // an HTML error page that would otherwise be stored as a "photo".
      const fileRes = await this.fetchImpl(meta.url, {
        headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!fileRes.ok) {
        log.warn({ mediaId, status: fileRes.status }, "media download failed");
        return null;
      }
      const bytes = Buffer.from(await fileRes.arrayBuffer());
      if (bytes.length > MediaFetcher.MAX_BYTES) {
        log.warn({ mediaId, size: bytes.length }, "media too large after download");
        return null;
      }
      if (bytes.length === 0) return null;

      log.info({ mediaId, bytes: bytes.length, contentType }, "media downloaded");
      return { bytes, contentType };
    } catch (err) {
      // A failed photo must never lose the product it belonged to, so this
      // reports rather than throws.
      log.warn({ mediaId, err: (err as Error).message }, "media fetch errored");
      return null;
    }
  }
}
