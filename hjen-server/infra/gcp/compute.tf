# mode = "vm" — the honest first landing in Dammam.
#
# One Container-Optimized OS instance running the image from Artifact Registry,
# with DATA_DIR on a separate persistent disk. COS is chosen for a specific
# reason, not fashion: read-only root filesystem, automatic security patching,
# no package manager and no shell habits to drift. The box stops being a pet.
#
# This is single-instance ON PURPOSE. See variables.tf on run_max_instances and
# README.md §3 — the application is not yet safe to run in more than one copy.

resource "google_compute_address" "web" {
  count = var.mode == "vm" ? 1 : 0

  name         = "${var.name}-web-ip"
  region       = var.region
  address_type = "EXTERNAL"
}

# DATA_DIR lives on its own disk so the instance can be rebuilt, resized or
# re-imaged without touching customer data. Separately snapshotted below.
resource "google_compute_disk" "data" {
  count = var.mode == "vm" ? 1 : 0

  name = "${var.name}-data"
  type = "pd-balanced"
  zone = var.zone
  size = var.data_disk_gb

  labels = var.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_instance" "app" {
  count = var.mode == "vm" ? 1 : 0

  name         = "${var.name}-server"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["${var.name}-web"]
  labels       = var.labels

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 50
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.data[0].id
    device_name = "hjen-data"
    mode        = "READ_WRITE"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id

    access_config {
      nat_ip = google_compute_address.web[0].address
    }
  }

  service_account {
    email  = google_service_account.app.email
    scopes = ["cloud-platform"] # narrowed by IAM roles, not by scopes
  }

  metadata = {
    # COS reads this and runs the script on every boot.
    startup-script = templatefile("${path.module}/scripts/cos-startup.sh", {
      project_id      = var.project_id
      container_image = var.container_image
      domain          = var.domain
      secret_names    = join(" ", var.provider_secret_names)
      public_base_url = "https://${var.domain}"
    })

    google-logging-enabled    = "true"
    google-monitoring-enabled = "true"
    # OS Login: SSH is an IAM grant, not a key in someone's ~/.ssh.
    enable-oslogin = "TRUE"
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  allow_stopping_for_update = true
}

# Backups. The disk is the only copy of customer data in mode=vm — a snapshot
# schedule is not optional, it is the difference between an incident and a
# closure. Snapshots inherit the region.
resource "google_compute_resource_policy" "data_backup" {
  count = var.mode == "vm" ? 1 : 0

  name   = "${var.name}-data-daily"
  region = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "22:00" # 01:00 Riyadh — after the working day
      }
    }

    retention_policy {
      max_retention_days    = 30
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }

    snapshot_properties {
      storage_locations = [var.region]
      labels            = var.labels
    }
  }
}

resource "google_compute_disk_resource_policy_attachment" "data_backup" {
  count = var.mode == "vm" ? 1 : 0

  name = google_compute_resource_policy.data_backup[0].name
  disk = google_compute_disk.data[0].name
  zone = var.zone
}
