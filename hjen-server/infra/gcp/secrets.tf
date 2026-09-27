# Provider credentials.
#
# Terraform creates the secret CONTAINERS and the IAM grant. It never creates a
# version: `google_secret_manager_secret_version` takes the plaintext as an
# argument, which means the key is written to Terraform state in the clear and
# to anyone who can read the state bucket. Values are added by hand — the
# command is in variables.tf, on provider_secret_names.
#
# Replication is user-managed and pinned to var.region. The default
# ("automatic") replicates secret material across Google's global fleet, which
# would put the platform's keys outside the Kingdom while the data they guard
# sits inside it.

resource "google_secret_manager_secret" "provider" {
  for_each = toset(var.provider_secret_names)

  secret_id = each.value
  labels    = var.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "app_access" {
  for_each = google_secret_manager_secret.provider

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# The workload identity. One service account, least privilege: read its own
# secrets, write its own bucket, emit logs and metrics. It is deliberately NOT
# a project editor — the default Compute Engine service account is, which is
# why we never use it.
resource "google_service_account" "app" {
  account_id   = "${var.name}-server"
  display_name = "HJEN Studio server (${var.region})"
}

resource "google_storage_bucket_iam_member" "app_data" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}

resource "google_artifact_registry_repository_iam_member" "app_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_telemetry" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.app.email}"
}
