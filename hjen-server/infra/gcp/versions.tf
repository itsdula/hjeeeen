# Provider + state. State lives in a GCS bucket IN THE SAME REGION as the
# platform — Terraform state contains resource metadata about a sovereign
# deployment and must not be the one thing that leaves the Kingdom.
#
# Bootstrap the state bucket once, by hand, before the first init:
#   gcloud storage buckets create gs://hjen-tfstate-me-central2 \
#     --project=<project> --location=me-central2 --uniform-bucket-level-access
#   gcloud storage buckets update gs://hjen-tfstate-me-central2 --versioning
#
#   terraform init -backend-config="bucket=hjen-tfstate-me-central2" \
#                  -backend-config="prefix=platform"

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
