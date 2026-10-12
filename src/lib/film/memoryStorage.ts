/**
 * An in-memory `FilmStorage` and a recording `Dispatcher`, for tests and for trying the film flow
 * with no Blob store or worker. Nothing here is used in production.
 */

import type { Dispatcher, FilmStorage, StoredObject } from "./service";

export class MemoryStorage implements FilmStorage {
  objects = new Map<string, { bytes: Uint8Array; uploadedAt: Date; contentType: string }>();
  now: () => Date = () => new Date();

  async getJson<T>(pathname: string): Promise<T | null> {
    const found = this.objects.get(pathname);
    return found ? (JSON.parse(Buffer.from(found.bytes).toString("utf8")) as T) : null;
  }

  async putJson(pathname: string, value: unknown, opts?: { exclusive?: boolean }): Promise<boolean> {
    if (opts?.exclusive && this.objects.has(pathname)) return false;
    this.objects.set(pathname, { bytes: Buffer.from(JSON.stringify(value)), uploadedAt: this.now(), contentType: "application/json" });
    return true;
  }

  async putBytes(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(pathname, { bytes, uploadedAt: this.now(), contentType });
  }

  async getStream(pathname: string) {
    const found = this.objects.get(pathname);
    if (!found) return null;
    return { stream: new Response(found.bytes as BodyInit).body as ReadableStream<Uint8Array>, size: found.bytes.byteLength };
  }

  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, o]) => ({ pathname, size: o.bytes.byteLength, uploadedAt: o.uploadedAt }))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));
  }

  async remove(pathnames: string[]): Promise<void> {
    for (const p of pathnames) this.objects.delete(p);
  }

  /** A clip arriving, as the browser's upload would leave it. */
  addClip(pathname: string, size: number): void {
    this.objects.set(pathname, { bytes: new Uint8Array(size), uploadedAt: this.now(), contentType: "video/mp4" });
  }
}

export class RecordingDispatcher implements Dispatcher {
  sent: Record<string, unknown>[] = [];
  on = true;
  fail: Error | null = null;

  configured(): boolean {
    return this.on;
  }

  async send(body: Record<string, unknown>): Promise<void> {
    if (this.fail) throw this.fail;
    this.sent.push(body);
  }
}
