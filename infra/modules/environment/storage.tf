# Buckets `files` and `exports` (section 24.3). Uniform access, no public access.

resource "google_storage_bucket" "files" {
  project                     = var.project_id
  name                        = "${var.project_id}-files"
  location                    = var.files_bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = var.files_versioning
  }

  # Browsers PUT to signed URLs and GET signed downloads from the app's origin.
  cors {
    origin          = [local.app_base_url]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "x-goog-content-length-range"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.env]
}

resource "google_storage_bucket" "exports" {
  project                     = var.project_id
  name                        = "${var.project_id}-exports"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = var.exports_retention_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.env]
}
