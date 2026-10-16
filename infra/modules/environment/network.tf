# One VPC per environment (section 24.3). Cloud Run reaches Cloud SQL's private IP over
# Direct VPC egress. All egress goes through the VPC so that calls to the internal-only
# `clamav` service count as internal; Cloud NAT provides internet egress (Postmark, Stripe, QBO).

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "verilo-${var.env}"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.env]
}

resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "run-${var.region}"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.vpc_cidr
  private_ip_google_access = true
}

# Private services access for Cloud SQL private IP.
resource "google_compute_global_address" "sql_range" {
  project       = var.project_id
  name          = "cloudsql-private-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "sql" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_range.name]
}

resource "google_compute_router" "nat" {
  project = var.project_id
  name    = "nat-${var.region}"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "nat-${var.region}"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
