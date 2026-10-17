# Cloud Run (section 24.3). Terraform owns configuration; CI owns the image (it deploys a
# new image digest on every merge), so image changes are ignored here.

locals {
  app_base_url = var.app_base_url != "" ? var.app_base_url : "https://web-${var.project_number}.${var.region}.run.app"
  app_env      = var.env == "production" ? "production" : "staging"

  plain_env = {
    APP_ENV              = local.app_env
    APP_BASE_URL         = local.app_base_url
    GCP_PROJECT          = var.project_id
    GCP_REGION           = var.region
    STORAGE_DRIVER       = "gcs"
    FILES_BUCKET         = google_storage_bucket.files.name
    EXPORTS_BUCKET       = google_storage_bucket.exports.name
    KMS_KEY_NAME         = google_kms_crypto_key.app.id
    CLAMAV_URL           = google_cloud_run_v2_service.clamav.uri
    CLAMAV_AUTH          = "google"
    VERTEX_MODEL         = var.vertex_model
    VERTEX_LOCATION      = var.vertex_location != "" ? var.vertex_location : var.region
    QBO_ENVIRONMENT      = var.qbo_environment
    LOG_LEVEL            = var.log_level
    INBOUND_EMAIL_DOMAIN = var.inbound_email_domain != "" ? var.inbound_email_domain : "inbound.${var.env}.verilo.invalid"
    EMAIL_FROM           = var.email_from
    MAGIC_LINK_ENABLED   = var.magic_link_enabled ? "1" : "0"
  }
  app_secrets = ["DATABASE_URL", "AUTH_SECRET", "POSTMARK_INBOUND_WEBHOOK_SECRET"]
}

# --- clamav: internal ingress only; only web and worker may invoke ---------------------------
resource "google_cloud_run_v2_service" "clamav" {
  project             = var.project_id
  name                = "clamav"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false

  template {
    service_account = google_service_account.clamav.email
    scaling {
      min_instance_count = var.clamav.min_instances
      max_instance_count = var.clamav.max_instances
    }
    max_instance_request_concurrency = 4
    timeout                          = "120s"
    containers {
      image = var.placeholder_image
      resources {
        limits   = { cpu = var.clamav.cpu, memory = var.clamav.memory }
        # clamd and freshclam run in the background; keep CPU allocated.
        cpu_idle = false
      }
      ports {
        container_port = 8080
      }
      startup_probe {
        # The HTTP front end starts listening only after clamd has loaded its signatures.
        tcp_socket {
          port = 8080
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 30
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.env]
}

# --- web --------------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "web" {
  project             = var.project_id
  name                = "web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL" # the load balancer + Cloud Armor arrive in M8
  deletion_protection = false
  # Public web app. Disabling the invoker check avoids an allUsers grant, which
  # domain-restricted-sharing org policies block.
  invoker_iam_disabled = true

  template {
    service_account = google_service_account.web.email
    scaling {
      min_instance_count = var.web.min_instances
      max_instance_count = var.web.max_instances
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }
    containers {
      image = var.placeholder_image
      resources {
        limits            = { cpu = var.web.cpu, memory = var.web.memory }
        startup_cpu_boost = var.env == "production"
      }
      ports {
        container_port = 8080
      }
      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.app_secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.generated[env.value].secret_id
              version = google_secret_manager_secret_version.generated[env.value].version
            }
          }
        }
      }
      startup_probe {
        tcp_socket {
          port = 8080
        }
        period_seconds    = 5
        failure_threshold = 24
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [
    google_project_iam_member.app,
    google_secret_manager_secret_iam_member.app,
    google_artifact_registry_repository_iam_member.run_agent_reader,
  ]
}

# --- worker (pg-boss) ----------------------------------------------------------------------------
resource "google_cloud_run_v2_worker_pool" "worker" {
  provider            = google-beta
  project             = var.project_id
  name                = "worker"
  location            = var.region
  deletion_protection = false

  scaling {
    manual_instance_count = var.worker.instances
  }

  template {
    service_account = google_service_account.worker.email
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }
    containers {
      image   = var.placeholder_image
      resources {
        limits = { cpu = var.worker.cpu, memory = var.worker.memory }
      }
      env {
        name  = "APP_ROLE"
        value = "worker"
      }
      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.app_secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.generated[env.value].secret_id
              version = google_secret_manager_secret_version.generated[env.value].version
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [
    google_project_iam_member.app,
    google_secret_manager_secret_iam_member.app,
    google_artifact_registry_repository_iam_member.run_agent_reader,
  ]
}

# --- migrate job: runs before each deploy -----------------------------------------------------------
resource "google_cloud_run_v2_job" "migrate" {
  project             = var.project_id
  name                = "migrate"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.migrate.email
      max_retries     = 0
      timeout         = "900s"
      vpc_access {
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.run.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image   = var.placeholder_image
        env {
          name  = "APP_ROLE"
          value = "migrate"
        }
        env {
          name  = "APP_ENV"
          value = local.app_env
        }
        env {
          name  = "LOG_LEVEL"
          value = var.log_level
        }
        dynamic "env" {
          for_each = toset(["DATABASE_URL", "MIGRATE_DATABASE_URL"])
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.generated[env.value].secret_id
                version = google_secret_manager_secret_version.generated[env.value].version
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
  depends_on = [
    google_project_iam_member.migrate,
    google_secret_manager_secret_iam_member.migrate,
    google_artifact_registry_repository_iam_member.run_agent_reader,
  ]
}
