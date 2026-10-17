import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: [
    "@verilo/auth",
    "@verilo/db",
    "@verilo/domain",
    "@verilo/email",
    "@verilo/ai",
    "@verilo/jobs",
    "@verilo/storage",
  ],
  serverExternalPackages: ["@node-rs/argon2", "pg", "pg-boss", "pino", "@google-cloud/storage", "@google-cloud/kms", "@google/genai", "sharp", "@napi-rs/canvas", "pdfjs-dist", "heic-convert"],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
