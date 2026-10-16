output "app_base_url" {
  value = local.app_base_url
}
output "web_uri" {
  value = google_cloud_run_v2_service.web.uri
}
output "clamav_uri" {
  value = google_cloud_run_v2_service.clamav.uri
}
output "files_bucket" {
  value = google_storage_bucket.files.name
}
output "exports_bucket" {
  value = google_storage_bucket.exports.name
}
output "kms_key" {
  value = google_kms_crypto_key.app.id
}
output "sql_instance" {
  value = google_sql_database_instance.main.connection_name
}
output "service_accounts" {
  value = {
    web     = google_service_account.web.email
    worker  = google_service_account.worker.email
    migrate = google_service_account.migrate.email
    clamav  = google_service_account.clamav.email
  }
}
