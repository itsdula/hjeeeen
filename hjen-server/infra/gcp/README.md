# HJEN Studio — Dammam (GCP `me-central2`)

Infrastructure-as-code for running the HJEN Studio server inside the Kingdom, on
Google Cloud's Dammam region.

Two modes, one root module:

| `mode` | Shape | Status |
|---|---|---|
| `vm` (default) | One Container-Optimized OS instance + persistent disk + Caddy TLS | **Deployable.** Preserves today's runtime semantics exactly. |
| `run` | Cloud Run v2 + GCS volume + direct VPC egress | **Written, not safe yet.** Gated on §3. |

---

## 1. The gate — read this before anything else

**The obstacle to GCP Dammam is commercial, not technical. It is one signature.**

Google's own documentation states that a customer with a **KSA billing address**
must purchase Google Cloud through **CNTXT** — Google's exclusive reseller in the
Kingdom — and that this applies to **the Dammam region *and every other Google
Cloud region***. There is no self-serve path for a Saudi-billed entity, anywhere
on Google Cloud. Verified again 2026-08-27; unchanged since the 2026-07-22
finding recorded in the Platform Operations Guide.

Three consequences, stated plainly:

1. **Nothing in this directory can be applied until the CNTXT master agreement
   is signed and a billing account is linked.** `terraform apply` will fail at
   the first API call. This is not a bug in the code.
2. **You cannot even rehearse on a cheap foreign region** under the hjen.ai
   entity, because the exclusivity is not region-scoped — it is billing-address
   scoped. Rehearsal needs either the CNTXT account, or a non-KSA-billed test
   entity, which is its own legal question.
3. **The dormant `hjen-platform` GCP organisation is not a head start.** It has
   no billing account, and attaching one is the exact step that requires CNTXT.

**AWS is the contrast, and the reason the current position is AWS-first:** the
AWS Saudi region is self-serve, and HJEN already holds account `206017086599`
with root MFA enabled and zero root access keys. Nothing here argues against
that decision. This directory exists so that "we are on AWS" is a *choice we
keep making*, not a wall we back into — the day CNTXT clears, Dammam is a
`terraform apply`, not a rewrite.

**What to do with this, today:** send CNTXT a request with a concrete
technical ask attached — region `me-central2`, services Compute Engine,
Cloud Run, Cloud Storage, Secret Manager, Artifact Registry, Cloud NAT — and
this repository as evidence the workload is defined. A reseller quotes faster
against a spec than against an enquiry. The channel has been open for months
without movement; a specced request is the thing that has not been tried.

---

## 2. What actually gets deployed

- **VPC** with in-region subnets, **Cloud NAT** on a fixed IP — every provider
  call leaves the platform from one auditable address.
- **Artifact Registry** in `me-central2` — the platform does not pull its own
  container from outside the Kingdom on boot.
- **Secret Manager** with **user-managed replication pinned to `me-central2`**.
  The default (`automatic`) would replicate key material across Google's global
  fleet — keys outside the Kingdom guarding data inside it. Terraform creates the
  containers and the IAM grant, never the values: a secret passed through
  Terraform is a secret in plaintext state.
- **GCS bucket** in-region, versioned, soft-delete 7d, `prevent_destroy`.
- **Compute Engine** (`mode=vm`) on Container-Optimized OS: read-only root, no
  package manager, auto-patched, SSH by IAP + OS Login only — no port 22 to the
  internet, no keys in the repo. Data on a separate persistent disk with a
  **daily snapshot schedule, 30-day retention**.
- **Cloud Run v2** (`mode=run`), behind §3.

### The residency claim, honestly

Pinning storage to Dammam lets you say *"your files never leave the Kingdom"* and
mean it. It does **not** let you say *"your data never leaves the Kingdom."*

Every generation this platform makes is an outbound call to a foreign endpoint —
`api.openai.com`, `api.anthropic.com`, BytePlus, Kling (`config.js`). The prompt
goes out; the image comes back. That is the architecture, and it is the right
architecture under the no-middlemen law, but it means the sovereign story has a
hop in it.

Say it first, in the sales room, before a procurement officer finds it: *storage,
accounts, billing records and audit logs are resident in Dammam; model inference
is performed by named foreign processors under DPA; and **NDA Mode is the answer
for work that cannot leave** — because that content never reaches us at all.*
A sovereignty claim that survives one question is worth more than one that
doesn't survive two.

---

## 3. What must change in the app before this is a *cloud platform*

This is the part no cloud provider fixes for you. Today the server is a **single
process that owns a filesystem** — which is not a criticism, it is the correct
design for a gated demo, and it is written down honestly in the code's own
comments. But it means the platform is not yet horizontally scalable on *any*
provider. Dammam does not change that. Neither does Riyadh.

Four things pin it, all verified in the source:

**(a) Render jobs live in process memory.**
`server.js:192` `imageJobs`, `server.js:202` `frameJobs`, `server.js:331`
`storyboardJobs` are module-level `Map`s. Submit at `server.js:1264` writes to
the map; the poll at `server.js:1272` reads it and deletes on delivery. With two
instances behind any load balancer, the poll lands on the instance that never ran
the job: the customer sees a failure, and has already been billed for a render
that succeeded. **This is the single blocker to `max_instances > 1`.**
*Fix:* move job state to Postgres (or Memorystore Redis, in-region) keyed by
jobId, with the result blob written to GCS and the row holding a pointer.

**(b) Rate limiting is per-instance.**
`scheduler.js:27` `buckets` and `server.js:107` `_signupHits`. `scheduler.js`
already documents this: *"Single Node process → in-memory is correct today;
multi-instance later needs shared state (Redis)."* At N instances, provider rate
limits are exceeded N-fold and the signup throttle is trivially bypassed.
*Fix:* Memorystore Redis in `me-central2`, same migration as (a).

**(c) Crash-safe writes depend on atomic `rename(2)`.**
`cloudstore.js:52`, `cloudstore.js:64`, `store.js:40`, `breakdown/ingest.js:77`
all write to a temp path then `renameSync` — deliberately, so a reader never sees
a half-written file (`cloudstore.js:44`). **GCS FUSE does not provide atomic
rename**; it copies and deletes. Mounting the bucket at `/data` therefore
reintroduces exactly the torn-read the code was written to prevent.
*Fix:* the storage layer talks to the GCS API directly with generation
preconditions, instead of pretending object storage is a filesystem.
`cloudstore.js:5` already anticipates this move.

**(d) Two system binaries are undeclared dependencies.**
`convert` (`cloudstore.js:35`, `:350`) and `ffmpeg` (`cloudstore.js:403`,
`breakdown/ingest.js:20`). `package.json` says "zero runtime dependencies",
which is true of npm and false of the machine. Now pinned in the `Dockerfile` —
**this one is fixed.**

**Sequence.** (d) is done. (a) and (b) are one Redis/Postgres task and unlock
multi-instance on any cloud. (c) is the largest and is only required for
`mode=run`. Until (a)–(c) land, `mode=vm` is not a compromise — it is the
correct deployment, and `run_max_instances = 1` is a correctness constraint
rather than a budget one.

---

## 4. Runbook — first deploy

Prerequisites: CNTXT agreement signed (§1), billing account linked, `terraform`
and `gcloud` installed, DNS for `var.domain` under your control.

```bash
# 0. APIs
gcloud services enable compute.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  storage.googleapis.com --project=<project>

# 1. Terraform state bucket (once, in-region — see versions.tf)
gcloud storage buckets create gs://hjen-tfstate-me-central2 \
  --project=<project> --location=me-central2 --uniform-bucket-level-access

# 2. Build and push the image. --platform is not optional on Apple Silicon:
#    an arm64 image will not boot on the VM.
cd ../..                                   # → server/
( cd ../app && npm run build:web ) && rm -rf webapp-dist && cp -R ../app/dist webapp-dist
TAG="$(date +%Y-%m-%d)-$(git rev-parse --short HEAD)"
REPO="me-central2-docker.pkg.dev/<project>/hjen"
gcloud auth configure-docker me-central2-docker.pkg.dev
docker buildx build --platform linux/amd64 -t "$REPO/server:$TAG" --push .

# 3. Infrastructure
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars   # set project_id, domain, image=$TAG
terraform init -backend-config="bucket=hjen-tfstate-me-central2" \
               -backend-config="prefix=platform"
terraform validate
terraform plan          # read every line; -auto-approve is banned here
terraform apply

# 4. Secret values — by hand, never through Terraform
printf %s "sk-..." | gcloud secrets versions add OPENAI_API_KEY \
  --project=<project> --data-file=-
#   ...repeat for each name in `terraform output secrets_awaiting_values`

# 5. DNS, then boot
terraform output public_ip     # → A record for app.hjen.ai, wait for propagation
gcloud compute instances reset hjen-server --zone=me-central2-a   # re-runs startup

# 6. Verify
curl -sS https://app.hjen.ai/health
```

**Rollback** is a tag change: set `container_image` to the previous digest and
`terraform apply`. The data disk is untouched by instance replacement, and is
`prevent_destroy`.

---

## 5. Verification status — what is proven and what is not

Stated exactly, because "it works on my machine" is not available as a defence
and this was written on a machine with none of the tooling installed.

| Item | Status |
|---|---|
| §3 (a)–(d) app blockers | **Verified.** Read from the source; every line number cited is real. |
| CNTXT exclusivity (§1) | **Verified** against Google's public documentation, 2026-08-27. |
| Cloud Run available in `me-central2` | **Verified** against Google's region documentation. |
| `Dockerfile` builds | **NOT verified** — no Docker on this machine. |
| Terraform parses / plans | **NOT verified** — no `terraform` binary on this machine. Run `terraform validate` first; expect to fix argument names against the provider version you resolve. |
| First boot succeeds | **NOT verified.** `scripts/cos-startup.sh` is the piece most likely to need a second pass — check `journalctl -u google-startup-scripts` on the box. |

Treat everything in the bottom half of that table as a first draft that compiles
in the author's head. The first `terraform validate` is the real review.
