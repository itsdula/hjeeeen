# mode = "run" — Cloud Run v2 in Dammam. The target state, deployed here so the
# path is real code rather than a slide, but read both warnings before using it.
#
# WARNING 1 — CONCURRENCY. max_instances defaults to 1 because three render-job
# maps and two rate-limit maps are process-local (server.js:192, :202, :331,
# :107; scheduler.js:27). scheduler.js says so itself in a comment. More than
# one instance loses paid renders. README.md §3 is the work that lifts this.
#
# WARNING 2 — FILESYSTEM. The GCS volume below makes the bucket look like a
# directory, but Cloud Storage FUSE does NOT give atomic rename, and the storage
# layer depends on exactly that for crash-safe writes:
#     cloudstore.js:52  resize → renameSync(tmp, cached)
#     cloudstore.js:64  writeJson → renameSync(tmp, f)
#     store.js:40       renameSync(tmp, f)
#     breakdown/ingest.js:77 frame extraction → renameSync
# Under FUSE a rename is a copy-then-delete: not atomic, and a reader can see a
# half-written file — the precise failure cloudstore.js:44 says it prevents.
# So mode=run is NOT production-safe until the storage layer writes to the GCS
# API directly (compare-and-swap on generation number) instead of through a
# filesystem. That is the same work item as §3.
#
# Cloud Run is confirmed available in me-central2. The blocker is our code, not
# the region.

resource "google_cloud_run_v2_service" "app" {
  count = var.mode == "run" ? 1 : 0

  name     = "${var.name}-server"
  location = var.region
  labels   = var.labels

  # Open, because this module deploys no load balancer — see WARNING 1: there is
  # no reason to build a front door for a service that cannot yet run in more
  # than one copy. When §3 lands and this goes multi-instance, put a REGIONAL
  # external Application Load Balancer in front, flip this to
  # INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER, and keep it regional: a global load
  # balancer would serve a sovereign workload from Google POPs outside the
  # Kingdom.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.app.email

    scaling {
      min_instance_count = 1 # cold start pays for sharp + onnxruntime init
      max_instance_count = var.run_max_instances
    }

    # Direct VPC egress: provider calls leave through Cloud NAT's fixed IP.
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }

    volumes {
      name = "data"
      gcs {
        bucket    = google_storage_bucket.data.name
        read_only = false
      }
    }

    containers {
      image = var.container_image

      ports {
        container_port = 8787
      }

      volume_mounts {
        name       = "data"
        mount_path = "/data"
      }

      resources {
        limits = {
          cpu    = "4"
          memory = "8Gi"
        }
        # ImageMagick and ffmpeg run outside the request lifecycle; CPU must not
        # be throttled between requests or a background render stalls.
        cpu_idle = false
      }

      env {
        name  = "DATA_DIR"
        value = "/data"
      }

      env {
        name  = "PUBLIC_BASE_URL"
        value = "https://${var.domain}"
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.provider

        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = "/health"
          port = 8787
        }
      }
    }

    # Renders are long. The default 300s cuts a paid generation in half.
    timeout = "900s"
  }

  depends_on = [google_secret_manager_secret_iam_member.app_access]
}
