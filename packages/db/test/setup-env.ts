// Defaults match docker-compose.yml. CI and developers can override with env vars.
process.env.TEST_MIGRATE_DATABASE_URL ??= "postgres://verilo_owner:verilo@localhost:5432/verilo_test";
process.env.TEST_DATABASE_URL ??= "postgres://verilo_runtime:verilo_runtime@localhost:5432/verilo_test";
process.env.APP_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="; // test-only key
process.env.AUTH_SECRET ??= "test-auth-secret-test-auth-secret-0123456789";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.APP_ENV ??= "test";
process.env.LOG_LEVEL ??= "silent";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
