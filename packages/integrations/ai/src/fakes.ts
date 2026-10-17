/**
 * Non-production model clients. `ScriptedClient` replays queued responses (unit and integration
 * tests). `FixtureClient` answers from the fixture set by the original file's sha256 (local dev
 * and E2E, so the flows work without Vertex AI). `DisabledClient` fails every read, which routes
 * files to manual entry.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ProviderError, type FileRef, type ModelClient } from "./extractor";

export type Scripted = string | object | Error;

export class ScriptedClient implements ModelClient {
  readonly model = "scripted";
  readonly calls: { prompt: string; file: FileRef }[] = [];
  private queue: Scripted[] = [];
  /** Used once the queue is empty. */
  fallback: ((file: FileRef) => Scripted) | null = null;

  push(...responses: Scripted[]) {
    this.queue.push(...responses);
    return this;
  }

  async generate(req: { file: FileRef; prompt: string }) {
    this.calls.push({ prompt: req.prompt, file: req.file });
    const next = this.queue.shift() ?? this.fallback?.(req.file);
    if (next === undefined) throw new ProviderError("ScriptedClient has no response queued");
    if (next instanceof Error) throw next;
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return { text, inputTokens: 1000, outputTokens: 200, costMicros: 800 };
  }
}

export class FixtureClient implements ModelClient {
  readonly model = "fixture";
  private readonly bySha = new Map<string, string>();

  constructor(fixturesDir: string) {
    if (!existsSync(fixturesDir)) return;
    for (const name of readdirSync(fixturesDir)) {
      if (!name.endsWith(".expected.json")) continue;
      const base = name.replace(/\.expected\.json$/, "");
      const doc = readdirSync(fixturesDir).find((f) => f.startsWith(`${base}.`) && !f.endsWith(".json"));
      if (!doc) continue;
      const sha = createHash("sha256").update(readFileSync(path.join(fixturesDir, doc))).digest("hex");
      this.bySha.set(sha, readFileSync(path.join(fixturesDir, name), "utf8"));
    }
  }

  async generate(req: { file: FileRef }) {
    const text = req.file.sha256 ? this.bySha.get(req.file.sha256) : undefined;
    if (!text) throw new ProviderError("No fixture matches this file");
    return { text, inputTokens: 0, outputTokens: 0, costMicros: 0 };
  }
}

export class DisabledClient implements ModelClient {
  readonly model = "disabled";
  async generate(): Promise<never> {
    throw new ProviderError("AI extraction isn't configured in this environment");
  }
}
