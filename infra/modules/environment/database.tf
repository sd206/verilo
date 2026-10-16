# Cloud SQL for PostgreSQL 16, Enterprise edition, private IP only (section 24.3).
resource "google_sql_database_instance" "main" {
  project             = var.project_id
  name                = "verilo-${var.env}"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.sql.deletion_protection

  settings {
    edition           = "ENTERPRISE"
    tier              = var.sql.tier
    availability_type = var.sql.availability_type
    disk_type         = "PD_SSD"
    disk_size         = var.sql.disk_size_gb
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "08:00" # 03:00 Central
      point_in_time_recovery_enabled = var.sql.pitr_enabled
      backup_retention_settings {
        retained_backups = var.sql.backup_retained
      }
    }

    insights_config {
      query_insights_enabled = true
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 9 # 04:00 Central
    }
  }

  depends_on = [google_service_networking_connection.sql]
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = "verilo"
}

# Owner role: owns the schema; used only by the migrate job (MIGRATE_DATABASE_URL).
resource "random_password" "db_owner" {
  length  = 40
  special = false
}

resource "google_sql_user" "owner" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = "verilo_owner"
  password = random_password.db_owner.result
}

# Runtime role (DATABASE_URL): created by the migrate job as a non-owner member of
# verilo_app, so row-level security applies to it (R3).
resource "random_password" "db_runtime" {
  length  = 40
  special = false
}

locals {
  db_host = google_sql_database_instance.main.private_ip_address
  # Encrypted over the private network; Cloud SQL's per-instance CA isn't verified by node-postgres here.
  database_url         = "postgres://verilo_runtime:${random_password.db_runtime.result}@${local.db_host}:5432/verilo?sslmode=no-verify"
  migrate_database_url = "postgres://verilo_owner:${random_password.db_owner.result}@${local.db_host}:5432/verilo?sslmode=no-verify"
}
