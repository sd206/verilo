output "org_id" {
  value = data.google_organization.org.org_id
}
output "region" {
  value = var.region
}
output "shared_project_id" {
  value = google_project.shared.project_id
}
output "staging_project_id" {
  value = google_project.staging.project_id
}
output "staging_project_number" {
  value = google_project.staging.number
}
output "tfstate_bucket" {
  value = google_storage_bucket.tfstate.name
}
output "artifact_registry" {
  description = "Image path prefix, e.g. <this>/app:<sha>"
  value       = "${google_artifact_registry_repository.containers.location}-docker.pkg.dev/${google_project.shared.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}
output "artifact_registry_location" {
  value = google_artifact_registry_repository.containers.location
}
output "artifact_registry_repository" {
  value = google_artifact_registry_repository.containers.name
}
output "deployer_service_account" {
  value = google_service_account.deployer.email
}
output "plan_service_account" {
  value = google_service_account.plan.email
}
output "workload_identity_provider" {
  description = "Set as the GitHub Actions variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}
