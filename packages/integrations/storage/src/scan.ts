import { createHash } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { GoogleAuth } from "google-auth-library";

export interface ScanResult {
  status: "CLEAN" | "INFECTED";
  /** ClamAV signature name when infected. */
  signature: string | null;
  sha256: string;
  sizeBytes: number;
}

export interface VirusScanner {
  scan(stream: Readable): Promise<ScanResult>;
}

/**
 * Client for the `clamav` HTTP wrapper (infra/images/clamav). In Cloud Run the service has
 * internal ingress and requires an ID token for the caller's service account (section 24.3).
 */
export class ClamAvHttpScanner implements VirusScanner {
  private readonly auth: GoogleAuth | null;
  constructor(
    private readonly baseUrl: string,
    opts: { useIdToken: boolean } = { useIdToken: false },
  ) {
    this.auth = opts.useIdToken ? new GoogleAuth() : null;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.auth) return {};
    const client = await this.auth.getIdTokenClient(this.baseUrl);
    const headers = await client.getRequestHeaders(this.baseUrl);
    const value = headers.get("authorization") ?? headers.get("Authorization");
    return value ? { authorization: value } : {};
  }

  async scan(stream: Readable): Promise<ScanResult> {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const tee = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      sizeBytes += chunk.length;
    });
    stream.on("error", (e) => tee.destroy(e));
    stream.pipe(tee);

    const res = await fetch(new URL("/scan", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", ...(await this.authHeaders()) },
      body: tee as unknown as ReadableStream,
      // Node fetch requires half-duplex for streamed request bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!res.ok) throw new Error(`clamav scan failed: HTTP ${res.status}`);
    const body = (await res.json()) as { status: "CLEAN" | "INFECTED"; signature?: string | null };
    if (body.status !== "CLEAN" && body.status !== "INFECTED") throw new Error("clamav returned an unknown status");
    return { status: body.status, signature: body.signature ?? null, sha256: hash.digest("hex"), sizeBytes };
  }
}
