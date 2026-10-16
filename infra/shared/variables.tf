variable "org_domain" {
  description = "Google Cloud organization domain."
  type        = string
  default     = "solidrocksolutions.co"
}

variable "billing_account" {
  description = "Billing account for all projects."
  type        = string
  default     = "017CE5-553A7B-1BF9F5"
}

variable "project_prefix" {
  description = "Projects are <prefix>-shared, <prefix>-staging (and <prefix>-prod in M8). Project IDs are global; change this if they are taken."
  type        = string
  default     = "verilo"
}

variable "region" {
  description = "Region for all regional resources (section 24.2). us-south1 unless a required service is missing there; then us-central1 for everything."
  type        = string
  default     = "us-south1"
}

variable "github_repository" {
  description = "GitHub repository (owner/repo) allowed to use Workload Identity Federation."
  type        = string
}

variable "eng_admins_group" {
  description = "Google group email for engineering admins (section 24.4). Empty to skip."
  type        = string
  default     = ""
}

variable "eng_readonly_group" {
  description = "Google group email for read-only engineers. Empty to skip."
  type        = string
  default     = ""
}

variable "budget_shared_usd" {
  description = "Monthly budget for the shared project, USD (alerts at 50/90/100%)."
  type        = number
  default     = 50
}

variable "budget_staging_usd" {
  description = "Monthly budget for the staging project, USD (alerts at 50/90/100%)."
  type        = number
  default     = 150
}
