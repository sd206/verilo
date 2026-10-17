# One environment (staging now; production in M8 with different values — section 24.11:
# "staging and production are created from the same Terraform with only variables differing").

variable "env" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production"
  }
}

variable "project_id" {
  type = string
}

variable "project_number" {
  type = string
}

variable "region" {
  type = string
}

variable "artifact_registry" {
  description = "Shared Artifact Registry repository."
  type = object({
    project    = string
    location   = string
    repository = string
  })
}

variable "deployer_service_account" {
  description = "GitHub Actions deployer (from the shared project)."
  type        = string
}

variable "app_base_url" {
  description = "Public URL of the web app. Empty: the web service's run.app URL."
  type        = string
  default     = ""
}

# --- sizing (section 24.3) ----------------------------------------------------------------
variable "web" {
  type = object({ min_instances = number, max_instances = number, cpu = string, memory = string })
}

variable "worker" {
  type = object({ instances = number, cpu = string, memory = string })
}

variable "clamav" {
  type = object({ min_instances = number, max_instances = number, cpu = string, memory = string })
}

variable "sql" {
  type = object({
    tier                = string
    availability_type   = string # ZONAL or REGIONAL
    backup_retained     = number
    pitr_enabled        = bool
    deletion_protection = bool
    disk_size_gb        = number
  })
}

variable "files_bucket_location" {
  description = "Regional in staging; US multi-region in production."
  type        = string
}

variable "files_versioning" {
  type    = bool
  default = false
}

variable "exports_retention_days" {
  type = number
}

variable "kms_rotation_period" {
  description = "e.g. 7776000s (90 days); null for no automatic rotation."
  type        = string
  default     = null
}

# --- app configuration (section 24.5) ---------------------------------------------------------
variable "qbo_environment" {
  type    = string
  default = "sandbox"
}

variable "vertex_model" {
  description = "Gemini model on Vertex AI for extraction (open decision 7; chosen in M2). Empty turns AI reads off."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "vertex_location" {
  description = "Vertex AI location for Gemini calls. Empty means the environment's region (24.9: same project and region)."
  type        = string
  default     = ""
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "inbound_email_domain" {
  type    = string
  default = ""
}

variable "email_from" {
  type    = string
  default = "Verilo <no-reply@verilo.invalid>"
}

variable "magic_link_enabled" {
  description = "Needs Postmark (POSTMARK_SERVER_TOKEN secret). Off until then."
  type        = bool
  default     = false
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/24"
}

variable "placeholder_image" {
  description = "Image used only on first create; CI deploys the real image (Terraform ignores image changes)."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
