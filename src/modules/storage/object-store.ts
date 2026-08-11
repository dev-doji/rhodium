import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { id } from "../../lib/ids.js";

/** Product images land here. Local fs in dev; S3-compatible in prod. */
export interface ObjectStore {
  put(bytes: Buffer, contentType: string): Promise<{ url: string }>;
}

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
