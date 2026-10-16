// Container entry point. One image runs as web, worker or migrate (section 24.7), chosen by
// APP_ROLE, so Cloud Run resources never need command overrides.
const role = process.env.APP_ROLE ?? "web";
const entry = { web: "../apps/web/server.js", worker: "../dist/worker.mjs", migrate: "../dist/migrate.mjs" }[role];
if (!entry) {
  console.error(JSON.stringify({ severity: "ERROR", message: `unknown APP_ROLE ${role}` }));
  process.exit(1);
}
await import(new URL(entry, import.meta.url).href);
