# Network. One VPC, one subnet, in-region only.
#
# Egress matters here more than ingress. Every generation this platform makes
# leaves the Kingdom — OpenAI, Anthropic, BytePlus, Kling are all foreign
# endpoints (config.js: OPENAI_BASE, ANTHROPIC_ENDPOINT). Cloud NAT gives that
# egress a single stable source IP, which is what provider allow-lists and the
# security-readiness questionnaire both want to see.

resource "google_compute_network" "vpc" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "app" {
  name                     = "${var.name}-app-${var.region}"
  ip_cidr_range            = "10.20.0.0/20"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

# Cloud Run direct VPC egress needs its own subnet to draw instance addresses
# from. Created in both modes so switching mode does not require a network edit.
resource "google_compute_subnetwork" "run" {
  name                     = "${var.name}-run-${var.region}"
  ip_cidr_range            = "10.20.16.0/22"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

resource "google_compute_router" "nat" {
  name    = "${var.name}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_address" "nat" {
  name         = "${var.name}-nat-ip"
  region       = var.region
  address_type = "EXTERNAL"
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.name}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.nat.self_link]
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Public ingress, mode=vm. TLS terminates on the box (Caddy + Let's Encrypt),
# which is what the current Frankfurt demo box already does — parity, not a new
# pattern. When the platform goes multi-instance, this pair of rules is replaced
# by a regional external Application Load Balancer with a proxy-only subnet;
# a GLOBAL load balancer would front the service from Google POPs outside the
# Kingdom and quietly weaken the residency claim, so it must stay regional.
resource "google_compute_firewall" "web" {
  count = var.mode == "vm" ? 1 : 0

  name          = "${var.name}-allow-web"
  network       = google_compute_network.vpc.name
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${var.name}-web"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}

# SSH via IAP only — 35.235.240.0/20 is Google's IAP TCP-forwarding range. No
# port 22 open to the internet, and no SSH key material in this repo: access is
# an IAM grant that can be revoked centrally.
resource "google_compute_firewall" "iap_ssh" {
  count = var.mode == "vm" ? 1 : 0

  name          = "${var.name}-allow-iap-ssh"
  network       = google_compute_network.vpc.name
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["${var.name}-web"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}
