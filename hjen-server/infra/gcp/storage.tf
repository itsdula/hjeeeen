# Blob storage + the image registry, both pinned to Dammam.

# Artifact Registry. The image must live in-region too: pulling the platform's
# own container from a foreign registry on every boot is an availability
# dependency outside the Kingdom, which is exactly what the sovereign
# deployment is supposed to remove.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "HJEN Studio server images (Dammam)."
  labels        = var.labels
}

# Object storage for account blobs.
#
# mode=vm  — not on the hot path yet; used for backups of the persistent disk.
# mode=run — mounted at /data via a Cloud Run GCS volume. READ THE WARNING in
#            run.tf before relying on that: the code assumes atomic rename and
#            GCS FUSE does not provide it.
resource "google_storage_bucket" "data" {
  name                        = "${var.name}-data-${var.project_id}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = var.labels

  versioning {
    enabled = true
  }

  # Customer data. Deletion must be a deliberate, argued act, never a
  # `terraform destroy` side effect.
  lifecycle {
    prevent_destroy = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800 # 7 days
  }
}
