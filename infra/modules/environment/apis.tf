resource "google_project_service" "env" {
  for_each = toset([
    "aiplatform.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sql-component.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Make sure the Cloud Run service agent exists so it can be granted image pull access.
resource "google_project_service_identity" "run" {
  provider   = google-beta
  project    = var.project_id
  service    = "run.googleapis.com"
  depends_on = [google_project_service.env]
}

# Cloud Run in this project pulls images from the shared Artifact Registry.
resource "google_artifact_registry_repository_iam_member" "run_agent_reader" {
  project    = var.artifact_registry.project
  location   = var.artifact_registry.location
  repository = var.artifact_registry.repository
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_project_service_identity.run.email}"
}
