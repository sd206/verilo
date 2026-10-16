terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.45, < 8.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.45, < 8.0"
    }
  }

  # State lives in the bucket this module creates. The first apply runs with local state
  # (bootstrap.sh adds a backend override), then the state is migrated here.
  backend "gcs" {
    prefix = "shared"
  }
}

provider "google" {
  region = var.region
}

# Budgets use the Billing Budget API, which needs a quota project.
provider "google" {
  alias                 = "billing"
  region                = var.region
  user_project_override = true
  billing_project       = google_project.shared.project_id
}
