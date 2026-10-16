import pino, { type Logger } from "pino";

/**
 * Structured JSON logs for Cloud Logging (section 24.8). Fields: firm_id, user_id,
 * request_id, job_name, job_id. Never log tokens, bank details, TINs or document text (section 17).
 */
const SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "mfaSecret",
  "*.mfaSecret",
  "code",
  "*.code",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  "ein",
  "*.ein",
  "DATABASE_URL",
];

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    messageKey: "message",
    base: { service: process.env.K_SERVICE ?? base.service ?? "verilo", env: process.env.APP_ENV ?? "local", ...base },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    formatters: {
      level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT", level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
