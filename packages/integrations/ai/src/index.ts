import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelExtractor, type Extractor } from "./extractor";
import { DisabledClient, FixtureClient } from "./fakes";
import { GeminiClient } from "./gemini";

export * from "./schema";
export * from "./prompts";
export * from "./extractor";
export * from "./fakes";
export * from "./preprocess";
export { GeminiClient } from "./gemini";

export const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

/**
 * EXTRACTOR=gemini (staging/production: VERTEX_MODEL, GCP_PROJECT, VERTEX_LOCATION or GCP_REGION),
 * EXTRACTOR=fixture (local and E2E: answers from the fixture set), otherwise disabled.
 */
export function extractorFromEnv(env: Record<string, string | undefined> = process.env): Extractor {
  const mode = env.EXTRACTOR ?? (env.VERTEX_MODEL ? "gemini" : "disabled");
  if (mode === "gemini") {
    if (!env.VERTEX_MODEL || !env.GCP_PROJECT) throw new Error("VERTEX_MODEL and GCP_PROJECT are required for EXTRACTOR=gemini");
    return new ModelExtractor(
      new GeminiClient(env.VERTEX_MODEL, { project: env.GCP_PROJECT, location: env.VERTEX_LOCATION || env.GCP_REGION || "us-central1" }),
    );
  }
  if (mode === "fixture") return new ModelExtractor(new FixtureClient(env.AI_FIXTURES_DIR ?? FIXTURES_DIR), { providerRetryDelayMs: 0 });
  return new ModelExtractor(new DisabledClient(), { providerRetryDelayMs: 0 });
}
