# Cloud KMS key ring `app` (R11, section 24.5): wraps per-firm data keys and TOTP secrets.
resource "google_kms_key_ring" "app" {
  project    = var.project_id
  name       = "app"
  location   = var.region
  depends_on = [google_project_service.env]
}

resource "google_kms_crypto_key" "app" {
  name            = "app"
  key_ring        = google_kms_key_ring.app.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.kms_rotation_period
  lifecycle {
    prevent_destroy = true
  }
}
