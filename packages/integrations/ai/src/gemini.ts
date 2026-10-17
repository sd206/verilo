/** Gemini on Vertex AI (sections 3, 24.9). Credentials: the worker's service account (ADC). */
import { GoogleGenAI } from "@google/genai";
import { ProviderError, type ModelClient } from "./extractor";

/** USD per million tokens (input, output). Used for the cost log (8.1); confirm against billing. */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

export class GeminiClient implements ModelClient {
  private readonly ai: GoogleGenAI;

  constructor(
    readonly model: string,
    opts: { project: string; location: string },
  ) {
    this.ai = new GoogleGenAI({ vertexai: true, project: opts.project, location: opts.location });
  }

  async generate(req: { file: { pages: Buffer[] }; prompt: string; jsonSchema: unknown }) {
    let res;
    try {
      res = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [
              { text: req.prompt },
              ...req.file.pages.map((p) => ({ inlineData: { mimeType: "image/jpeg", data: p.toString("base64") } })),
            ],
          },
        ],
        config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: req.jsonSchema },
      });
    } catch (e) {
      throw new ProviderError(`Vertex AI request failed: ${(e as Error).message}`, { cause: e });
    }
    const text = res.text;
    if (!text) throw new ProviderError("Vertex AI returned no text");
    const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
    const price = PRICES[this.model] ?? { input: 0, output: 0 };
    return { text, inputTokens, outputTokens, costMicros: Math.round(inputTokens * price.input + outputTokens * price.output) };
  }
}
