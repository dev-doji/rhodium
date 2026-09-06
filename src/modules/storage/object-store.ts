import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { id } from "../../lib/ids.js";

/** Product images land here. Local fs in dev; S3-compatible in prod. */
export interface ObjectStore {
  put(bytes: Buffer, contentType: string): Promise<{ url: string }>;
}

/**
 * Disk-backed. Fine for local development, WRONG for Render: its filesystem is
 * ephemeral, so an image written here survives until the next deploy and then
 * 404s with the product still pointing at it. Production uses the Postgres
 * store below.
 */
export class LocalObjectStore implements ObjectStore {
  constructor(private dir = "media-store") {}
  async put(bytes: Buffer, contentType: string): Promise<{ url: string }> {
    await mkdir(this.dir, { recursive: true });
    const ext = contentType.split("/")[1] ?? "bin";
    const name = `${id("img")}.${ext}`;
    await writeFile(join(this.dir, name), bytes);
    return { url: `/media/${name}` };
  }
}

/** Test/demo double — records puts without touching disk. */
export class InMemoryObjectStore implements ObjectStore {
  readonly puts: { contentType: string; size: number; url: string }[] = [];
  async put(bytes: Buffer, contentType: string): Promise<{ url: string }> {
    const url = `mem://${id("img")}`;
    this.puts.push({ contentType, size: bytes.length, url });
    return { url };
  }
}

/**
 * Product images in Postgres.
 *
 * Not where object storage belongs in general — there is no CDN in front of a
 * database, and bytes in rows are awkward to back up. It is chosen because it
 * is the only DURABLE store this deployment already has: the alternative was
 * a disk that silently discards a vendor's photo at the next deploy, which is
 * what happened. The 5MB ceiling enforced when the photo is fetched from
 * WhatsApp is what keeps this bounded.
 */
export class PostgresObjectStore implements ObjectStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) {}

  async put(bytes: Buffer, contentType: string): Promise<{ url: string }> {
    const ext = (contentType.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gi, "");
    const objectId = `${id("img")}.${ext}`;
    await this.db.mediaObject.create({
      data: { id: objectId, contentType, bytes, size: bytes.length },
    });
    // Same URL shape the disk store produced, so nothing downstream changes
    // and images stored before this keep the same address.
    return { url: `/media/${objectId}` };
  }

  async get(objectId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const row = await this.db.mediaObject.findUnique({ where: { id: objectId } });
    if (!row) return null;
    return { bytes: Buffer.from(row.bytes), contentType: row.contentType };
  }
}
