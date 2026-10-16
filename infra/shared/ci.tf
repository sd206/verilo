# Workload Identity Federation for GitHub Actions (section 24.4: no key files anywhere).
#
#   sa-deployer  merges to main: push images, run migrate, deploy Cloud Run (step 2 of 24.7)
#   sa-plan      pull requests: read-only `terraform plan` (step 1 of 24.7)

resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.shared.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.shared]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.shared.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.repo_ref"   = "assertion.repository + '@' + assertion.ref"
  }
  # Only tokens from this repository are accepted at all.
  attribute_condition = "assertion.repository == '${var.github_repository}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  project      = google_project.shared.project_id
  account_id   = "sa-deployer"
  display_name = "GitHub Actions deployer (main branch only)"
}

resource "google_service_account" "plan" {
  project      = google_project.shared.project_id
  account_id   = "sa-plan"
  display_name = "GitHub Actions terraform plan (read-only)"
}

# Deployer: only workflows running on refs/heads/main of the repository.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repo_ref/${var.github_repository}@refs/heads/main"
}

# Plan: any ref of the repository (pull requests from the repository itself; forks get no token).
resource "google_service_account_iam_member" "plan_wif" {
  service_account_id = google_service_account.plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# --- deployer roles (section 24.4) ----------------------------------------------------------
resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  project    = google_project.shared.project_id
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# Vulnerability scan of each image before deploy (24.7: block on critical findings).
resource "google_project_iam_member" "deployer_scanning" {
  project = google_project.shared.project_id
  role    = "roles/ondemandscanning.admin"
  member  = google_service_account.deployer.member
}

# Run Admin in staging and Service Account User on the runtime accounts are granted in
# envs/staging (they need the runtime service accounts to exist).

# --- plan roles: read everything Terraform manages, never write ----------------------------
resource "google_project_iam_member" "plan_viewer" {
  for_each = {
    shared  = google_project.shared.project_id
    staging = google_project.staging.project_id
  }
  project = each.value
  role    = "roles/viewer"
  member  = google_service_account.plan.member
}

resource "google_project_iam_member" "plan_security_reviewer" {
  for_each = {
    shared  = google_project.shared.project_id
    staging = google_project.staging.project_id
  }
  project = each.value
  role    = "roles/iam.securityReviewer"
  member  = google_service_account.plan.member
}

resource "google_organization_iam_member" "plan_org_viewer" {
  org_id = data.google_organization.org.org_id
  role   = "roles/resourcemanager.organizationViewer"
  member = google_service_account.plan.member
}

resource "google_storage_bucket_iam_member" "plan_state_reader" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.plan.member
}
