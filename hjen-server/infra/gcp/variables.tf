variable "project_id" {
  description = "GCP project id. Under the CNTXT reseller agreement this project is created inside the CNTXT-linked billing account — see infra/gcp/README.md, 'The gate'."
  type        = string
}

variable "region" {
  description = "me-central2 is Dammam, Saudi Arabia. Every stateful resource below is pinned to it — that pinning IS the data-residency claim."
  type        = string
  default     = "me-central2"
}

variable "zone" {
  description = "Dammam has three zones: me-central2-a/-b/-c. Single-zone is correct for mode=vm phase 1 (the app is single-instance anyway); revisit at the same time as the multi-instance work."
  type        = string
  default     = "me-central2-a"
}

variable "mode" {
  description = <<-EOT
    Which compute shape to deploy.

      "vm"  — one Compute Engine instance + a persistent disk, running the
              container. Preserves TODAY'S semantics exactly: real POSIX
              filesystem (the code depends on atomic rename — cloudstore.js:52,
              cloudstore.js:64, store.js:40), one process (the in-memory job
              maps stay correct). This is the honest first landing in Dammam.

      "run" — Cloud Run v2. The target state, and NOT safe to scale past one
              instance until the shared-state work in README.md §3 is done.
              Read that section before raising max_instances.
  EOT
  type        = string
  default     = "vm"

  validation {
    condition     = contains(["vm", "run"], var.mode)
    error_message = "mode must be \"vm\" or \"run\"."
  }
}

variable "name" {
  description = "Resource name prefix."
  type        = string
  default     = "hjen"
}

variable "domain" {
  description = "Public hostname this deployment answers on (e.g. app.hjen.ai). In mode=vm, Caddy obtains a Let's Encrypt certificate for it on boot, so the DNS A record must already point at the reserved static IP."
  type        = string
}

variable "container_image" {
  description = "Full Artifact Registry image ref, e.g. me-central2-docker.pkg.dev/<project>/hjen/server:<sha>. Deploy by digest or immutable tag — never :latest, or you cannot say what is running."
  type        = string
}

variable "machine_type" {
  description = "mode=vm only. The server runs ImageMagick and ffmpeg in-process-tree; 4 vCPU is the floor for concurrent renders."
  type        = string
  default     = "e2-standard-4"
}

variable "data_disk_gb" {
  description = "mode=vm only. Persistent disk for DATA_DIR (accounts, blobs, oplog)."
  type        = number
  default     = 200
}

variable "provider_secret_names" {
  description = <<-EOT
    Names of the Secret Manager secrets holding provider credentials. Terraform
    creates the SECRETS (the containers) and grants read access — it never
    creates the VERSIONS, because a secret value passed through Terraform is a
    secret written to Terraform state in plaintext. Add values by hand:

      printf %s "sk-..." | gcloud secrets versions add OPENAI_API_KEY \
        --project=<project> --data-file=-
  EOT
  type        = list(string)
  default = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "ARK_API_KEY",
    "KLING_API_KEY",
    "CLERK_SECRET_KEY",
    "ADMIN_TOKEN",
    "PADDLE_API_KEY",
    "PADDLE_WEBHOOK_SECRET",
    "MOYASAR_SECRET_KEY",
    "MOYASAR_WEBHOOK_SECRET",
    "QOYOD_API_KEY",
  ]
}

variable "run_max_instances" {
  description = <<-EOT
    mode=run only. DEFAULT 1, DELIBERATELY.

    server.js keeps render jobs in process-local Maps (imageJobs :192,
    frameJobs :202, storyboardJobs :331). Submit lands on instance A, the poll
    lands on instance B, the render is lost and the customer is charged for it.
    scheduler.js:27 and server.js:107 have the same shape: per-instance rate
    limits multiply by instance count.

    Raising this above 1 before README.md §3 is done is not a scaling change,
    it is a correctness regression.
  EOT
  type        = number
  default     = 1
}

variable "labels" {
  type    = map(string)
  default = {
    system     = "hjen-platform"
    managed-by = "terraform"
  }
}
