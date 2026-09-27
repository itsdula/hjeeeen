output "region" {
  description = "Where the platform and every byte of its state actually run."
  value       = var.region
}

output "public_ip" {
  description = "mode=vm — point the DOMAIN's A record here BEFORE first boot, or Caddy's certificate request fails and the box serves nothing."
  value       = var.mode == "vm" ? google_compute_address.web[0].address : null
}

output "egress_ip" {
  description = "The single source IP every outbound provider call leaves from. Give this to provider allow-lists and to the security questionnaire."
  value       = google_compute_address.nat.address
}

output "run_url" {
  description = "mode=run — the service's own URL, for smoke tests only."
  value       = var.mode == "run" ? google_cloud_run_v2_service.app[0].uri : null
}

output "image_repository" {
  description = "Push target for the container build."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "data_bucket" {
  value = google_storage_bucket.data.name
}

output "service_account" {
  value = google_service_account.app.email
}

output "secrets_awaiting_values" {
  description = "Terraform created these containers empty. Add a version to each one that the deployment actually needs — command in variables.tf."
  value       = sort([for s in google_secret_manager_secret.provider : s.secret_id])
}
