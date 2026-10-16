# Staging environment (sections 24.1, 24.3): every merge to main deploys here.
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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "gcs" {
    prefix = "envs/staging"
  }
}

variable "tfstate_bucket" {
  description = "State bucket created by infra/shared (output tfstate_bucket)."
  type        = string
}

variable "app_base_url" {
  description = "Leave empty to use the web service's run.app URL (no custom domain in M0)."
  type        = string
  default     = ""
}

data "terraform_remote_state" "shared" {
  backend = "gcs"
  config = {
    bucket = var.tfstate_bucket
    prefix = "shared"
  }
}

locals {
  shared = data.terraform_remote_state.shared.outputs
}

provider "google" {
  project = local.shared.staging_project_id
  region  = local.shared.region
}

provider "google-beta" {
  project = local.shared.staging_project_id
  region  = local.shared.region
}

module "env" {
  source = "../../modules/environment"

  env            = "staging"
  project_id     = local.shared.staging_project_id
  project_number = local.shared.staging_project_number
  region         = local.shared.region
  app_base_url   = var.app_base_url

  artifact_registry = {
    project    = local.shared.shared_project_id
    location   = local.shared.artifact_registry_location
    repository = local.shared.artifact_registry_repository
  }
  deployer_service_account = local.shared.deployer_service_account

  # Section 24.3, staging column.
  web    = { min_instances = 0, max_instances = 3, cpu = "1", memory = "1Gi" }
  worker = { instances = 1, cpu = "1", memory = "2Gi" }
  clamav = { min_instances = 1, max_instances = 1, cpu = "1", memory = "3Gi" }
  sql = {
    tier                = "db-custom-1-3840" # smallest dedicated-core tier
    availability_type   = "ZONAL"
    backup_retained     = 7 # automated daily backups, 7 days; PITR off (24.6)
    pitr_enabled        = false
    deletion_protection = true
    disk_size_gb        = 10
  }
  files_bucket_location  = local.shared.region
  files_versioning       = false
  exports_retention_days = 30
  kms_rotation_period    = null

  qbo_environment    = "sandbox"
  magic_link_enabled = false # until a Postmark staging server exists
}

output "app_base_url" {
  value = module.env.app_base_url
}
output "web_uri" {
  value = module.env.web_uri
}
output "files_bucket" {
  value = module.env.files_bucket
}
output "service_accounts" {
  value = module.env.service_accounts
}
