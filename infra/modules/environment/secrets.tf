# Secret Manager (section 24.5). Values are pinned by version on Cloud Run.

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

# Basic-auth password for the Postmark inbound webhook (section 9). Postmark is configured with
# https://postmark:<secret>@<web host>/api/inbound-email/postmark.
resource "random_password" "inbound_webhook" {
  length  = 40
  special = false
}

moved {
  from = google_secret_manager_secret.external["POSTMARK_INBOUND_WEBHOOK_SECRET"]
  to   = google_secret_manager_secret.generated["POSTMARK_INBOUND_WEBHOOK_SECRET"]
}

locals {
  generated_secrets = {
    DATABASE_URL                    = local.database_url
    MIGRATE_DATABASE_URL            = local.migrate_database_url
    AUTH_SECRET                     = random_password.auth_secret.result
    POSTMARK_INBOUND_WEBHOOK_SECRET = random_password.inbound_webhook.result
  }
  # Created empty; versions are added by hand (or a later milestone) when the account exists.
  # Never mounted until they have a version.
  external_secrets = [
    "POSTMARK_SERVER_TOKEN",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
  ]
}

resource "google_secret_manager_secret" "generated" {
  for_each  = local.generated_secrets
  project   = var.project_id
  secret_id = each.key
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.env]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.generated[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret" "external" {
  for_each  = toset(local.external_secrets)
  project   = var.project_id
  secret_id = each.value
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.env]
}
