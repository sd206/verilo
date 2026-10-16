# ADR 0005 — One image, three roles; Terraform owns config, CI owns the image

Status: accepted

- One container image (`Dockerfile`) runs as `web`, `worker` or `migrate`, selected by `APP_ROLE`
  (`scripts/start.mjs`). Built once per commit, tagged with the git SHA, deployed by digest.
- Terraform creates the Cloud Run resources with Google's placeholder image and ignores image
  changes; the deploy workflow sets the image. Everything else is Terraform's.
- Staging has no load balancer in M0; `web` uses its run.app URL with `invoker_iam_disabled`.
- Terraform plan on PRs uses `sa-plan` (read-only, `-refresh=false`). Applies are manual in M0.
