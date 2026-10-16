# Section 24.2: projects under one organization and billing account.
# This root creates the shared and staging projects and the CI identity; the staging
# resources themselves live in envs/staging. Production is added in M8.

data "google_organization" "org" {
  domain = var.org_domain
}

locals {
  shared_project_id  = "${var.project_prefix}-shared"
  staging_project_id = "${var.project_prefix}-staging"
}

resource "google_project" "shared" {
  name            = "Verilo shared"
  project_id      = local.shared_project_id
  org_id          = data.google_organization.org.org_id
  billing_account = var.billing_account
  labels          = { app = "verilo", env = "shared" }
  auto_create_network = false
}

resource "google_project" "staging" {
  name            = "Verilo staging"
  project_id      = local.staging_project_id
  org_id          = data.google_organization.org.org_id
  billing_account = var.billing_account
  labels          = { app = "verilo", env = "staging" }
  auto_create_network = false
}

resource "google_project_service" "shared" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "containerscanning.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "ondemandscanning.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])
  project            = google_project.shared.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Terraform state bucket (shared) ----------------------------------------------
resource "google_storage_bucket" "tfstate" {
  project                     = google_project.shared.project_id
  name                        = "${local.shared_project_id}-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.shared]
}

# --- Artifact Registry (container images) ---------------------------------------------
resource "google_artifact_registry_repository" "containers" {
  project       = google_project.shared.project_id
  location      = var.region
  repository_id = "containers"
  format        = "DOCKER"
  description   = "Verilo images: app (web/worker/migrate) and clamav"
  docker_config {
    immutable_tags = true
  }
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 50
    }
  }
  depends_on = [google_project_service.shared]
}

# --- people (section 24.4: groups, not individual grants) --------------------------------
resource "google_project_iam_member" "admins" {
  for_each = var.eng_admins_group == "" ? {} : {
    shared  = google_project.shared.project_id
    staging = google_project.staging.project_id
  }
  project = each.value
  role    = "roles/owner"
  member  = "group:${var.eng_admins_group}"
}

resource "google_project_iam_member" "readonly" {
  for_each = var.eng_readonly_group == "" ? {} : {
    shared  = google_project.shared.project_id
    staging = google_project.staging.project_id
  }
  project = each.value
  role    = "roles/viewer"
  member  = "group:${var.eng_readonly_group}"
}

# --- budgets (sections 24.8, 24.10) ---------------------------------------------------------
resource "google_billing_budget" "project" {
  provider = google.billing
  for_each = {
    shared  = { number = google_project.shared.number, usd = var.budget_shared_usd }
    staging = { number = google_project.staging.number, usd = var.budget_staging_usd }
  }
  billing_account = var.billing_account
  display_name    = "verilo-${each.key}"
  budget_filter {
    projects = ["projects/${each.value.number}"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(each.value.usd)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  depends_on = [google_project_service.shared]
}
