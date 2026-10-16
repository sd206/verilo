#!/usr/bin/env bash
# One-time bootstrap of the shared and staging projects (section 24.11, M0 row).
#
# Run by a person with, on the solidrocksolutions.co organization:
#   Project Creator, Billing Account User + Billing Account Costs Manager (for budgets),
#   Organization Viewer, and Security Admin (to grant org-level viewer to sa-plan).
#
# After this, GitHub Actions takes over: pull requests run `terraform plan`, merges to main
# deploy to staging. Later Terraform changes are applied by an eng admin with the same
# commands as step 3/4 (applies are not automated in M0).
set -euo pipefail

: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY=owner/repo}"
cd "$(dirname "$0")"

echo "== 1. shared: first apply with local state"
pushd shared >/dev/null
cat > backend_override.tf <<'HCL'
terraform {
  backend "local" {}
}
HCL
terraform init -input=false
terraform apply -input=false -var "github_repository=${GITHUB_REPOSITORY}"
BUCKET=$(terraform output -raw tfstate_bucket)

echo "== 2. shared: move state into gs://${BUCKET}"
rm backend_override.tf
terraform init -input=false -migrate-state -force-copy -backend-config="bucket=${BUCKET}"
rm -f terraform.tfstate terraform.tfstate.backup
popd >/dev/null

echo "== 3. staging"
pushd envs/staging >/dev/null
terraform init -input=false -backend-config="bucket=${BUCKET}"
terraform apply -input=false -var "tfstate_bucket=${BUCKET}"
popd >/dev/null

echo "== 4. GitHub repository variables (Settings → Secrets and variables → Actions → Variables)"
pushd shared >/dev/null
cat <<TXT
GCP_WIF_PROVIDER   = $(terraform output -raw workload_identity_provider)
GCP_DEPLOYER_SA    = $(terraform output -raw deployer_service_account)
GCP_PLAN_SA        = $(terraform output -raw plan_service_account)
GCP_REGION         = $(terraform output -raw region)
GCP_STAGING_PROJECT= $(terraform output -raw staging_project_id)
ARTIFACT_REGISTRY  = $(terraform output -raw artifact_registry)
TFSTATE_BUCKET     = ${BUCKET}
TXT
popd >/dev/null
pushd envs/staging >/dev/null
echo "STAGING_URL        = $(terraform output -raw app_base_url)"
popd >/dev/null
