/**
 * Real-services test: MinIO (S3 API) + the ClamAV HTTP wrapper from docker-compose.
 * Runs when S3_ENDPOINT and CLAMAV_URL are set (CI sets both); skipped otherwise.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ClamAvHttpScanner } from "./scan";
import { S3Storage } from "./s3";

const enabled = Boolean(process.env.S3_ENDPOINT && process.env.CLAMAV_URL);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe.runIf(enabled)("MinIO + ClamAV", () => {
  const storage = () =>
    new S3Storage({
      bucket: process.env.FILES_BUCKET ?? "verilo-files",
      endpoint: process.env.S3_ENDPOINT!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "verilo",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "verilo-secret",
    });
  const scanner = () => new ClamAvHttpScanner(process.env.CLAMAV_URL!);

  async function putViaSignedUrl(body: string) {
    const s = storage();
    const key = `test/${randomUUID()}`;
    const buf = Buffer.from(body);
    const up = await s.createSignedUpload({ key, contentType: "application/pdf", sizeBytes: buf.length });
    const res = await fetch(up.url, { method: up.method, headers: up.headers, body: buf });
    expect(res.status).toBe(200);
    return { s, key, buf };
  }

  it("a signed upload lands in the bucket and scans CLEAN", async () => {
    const { s, key, buf } = await putViaSignedUrl("%PDF-1.4 hello");
    expect(await s.head(key)).toMatchObject({ sizeBytes: buf.length });
    const r = await scanner().scan(await s.getStream(key));
    expect(r).toMatchObject({ status: "CLEAN", sizeBytes: buf.length });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    const dl = await fetch(await s.createSignedDownload({ key, filename: "hello.pdf" }));
    expect(await dl.text()).toBe("%PDF-1.4 hello");
  });

  it("the EICAR test file scans INFECTED", async () => {
    const { s, key } = await putViaSignedUrl(EICAR);
    const r = await scanner().scan(await s.getStream(key));
    expect(r.status).toBe("INFECTED");
    expect(r.signature).toMatch(/Eicar/i);
  });

  it("head() returns null for a missing object", async () => {
    expect(await storage().head(`test/${randomUUID()}`)).toBeNull();
  });
});
