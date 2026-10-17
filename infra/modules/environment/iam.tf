# Runtime identities (section 24.4). No service account keys anywhere.

resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "sa-web"
  display_name = "Cloud Run web"
  depends_on   = [google_project_service.env]
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "sa-worker"
  display_name = "Cloud Run worker pool"
  depends_on   = [google_project_service.env]
}

resource "google_service_account" "migrate" {
  project      = var.project_id
  account_id   = "sa-migrate"
  display_name = "Cloud Run job migrate"
  depends_on   = [google_project_service.env]
}

# Not in the 24.4 table: clamav gets its own identity with no data access, rather than the
# default compute service account.
resource "google_service_account" "clamav" {
  project      = var.project_id
  account_id   = "sa-clamav"
  display_name = "Cloud Run clamav (no data access)"
  depends_on   = [google_project_service.env]
}

locals {
  app_accounts = {
    web    = google_service_account.web
    worker = google_service_account.worker
  }
  # Project-level roles for sa-web and sa-worker (24.4).
  app_project_roles = [
    "roles/cloudsql.client",
    "roles/aiplatform.user",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]
  app_role_bindings = { for pair in setproduct(keys(local.app_accounts), local.app_project_roles) : "${pair[0]}:${pair[1]}" => {
    sa   = pair[0]
    role = pair[1]
  } }
}

resource "google_project_iam_member" "app" {
  for_each = local.app_role_bindings
  project  = var.project_id
  role     = each.value.role
  member   = local.app_accounts[each.value.sa].member
}

resource "google_project_iam_member" "migrate" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.migrate.member
}

resource "google_project_iam_member" "clamav" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.clamav.member
}

# Storage Object User on `files` and `exports` only.
resource "google_storage_bucket_iam_member" "app" {
  for_each = { for pair in setproduct(keys(local.app_accounts), ["files", "exports"]) : "${pair[0]}:${pair[1]}" => {
    sa     = pair[0]
    bucket = pair[1] == "files" ? google_storage_bucket.files.name : google_storage_bucket.exports.name
  } }
  bucket = each.value.bucket
  role   = "roles/storage.objectUser"
  member = local.app_accounts[each.value.sa].member
}

# V4 signed URLs without keys: the service account signs through the IAM signBlob API.
resource "google_service_account_iam_member" "app_sign_self" {
  for_each           = local.app_accounts
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value.member
}

# KMS Encrypter/Decrypter on the `app` key.
resource "google_kms_crypto_key_iam_member" "app" {
  for_each      = local.app_accounts
  crypto_key_id = google_kms_crypto_key.app.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = each.value.member
}

# Secret Manager Secret Accessor on named secrets only.
resource "google_secret_manager_secret_iam_member" "app" {
  for_each = { for pair in setproduct(keys(local.app_accounts), ["DATABASE_URL", "AUTH_SECRET", "POSTMARK_INBOUND_WEBHOOK_SECRET"]) : "${pair[0]}:${pair[1]}" => {
    sa     = pair[0]
    secret = pair[1]
  } }
  project   = var.project_id
  secret_id = google_secret_manager_secret.generated[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.app_accounts[each.value.sa].member
}

# sa-migrate: the database secrets only (it creates/updates the runtime role from DATABASE_URL).
resource "google_secret_manager_secret_iam_member" "migrate" {
  for_each  = toset(["DATABASE_URL", "MIGRATE_DATABASE_URL"])
  project   = var.project_id
  secret_id = google_secret_manager_secret.generated[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.migrate.member
}

# Run Invoker on `clamav` for web and worker only.
resource "google_cloud_run_v2_service_iam_member" "clamav_invoker" {
  for_each = local.app_accounts
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.clamav.name
  role     = "roles/run.invoker"
  member   = each.value.member
}

# --- CI deployer (from the shared project) -------------------------------------------------
resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${var.deployer_service_account}"
}

resource "google_service_account_iam_member" "deployer_act_as" {
  for_each = {
    web     = google_service_account.web.name
    worker  = google_service_account.worker.name
    migrate = google_service_account.migrate.name
    clamav  = google_service_account.clamav.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_service_account}"
}
