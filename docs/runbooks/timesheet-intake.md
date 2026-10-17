# Timesheet intake: AI reads and the timesheet inbox (M2)

## Turn on AI reads (Gemini on Vertex AI, 24.9)
1. `terraform apply` in `infra/envs/<env>`. This sets `VERTEX_MODEL` (default `gemini-2.5-flash`)
   and `VERTEX_LOCATION` (the environment's region) on web and worker, and `sa-worker` already
   has `roles/aiplatform.user`.
2. Configure zero data retention for the project as Google documents, and record it on the trust
   page (section 17).
3. To change the model, set `vertex_model`. To use the global endpoint, set `vertex_location = "global"`.
   An empty `vertex_model` turns AI reads off: files go to manual entry.

## Connect the timesheet inbox (Postmark, section 9)
1. Read the webhook password: `gcloud secrets versions access latest --secret POSTMARK_INBOUND_WEBHOOK_SECRET --project <env project>`.
2. In the Postmark server's inbound stream, set the webhook URL to
   `https://postmark:<password>@<web host>/api/inbound-email/postmark`. Turn on "Include raw email
   content" only if you also want it in the stored payload.
3. Point the inbound domain (`INBOUND_EMAIL_DOMAIN`) at Postmark's inbound MX. Each firm's
   address is `ts-<slug>@<domain>` (shown on Home).
4. Rotating: `terraform apply -replace=module.env.random_password.inbound_webhook`, then update the
   URL in Postmark. Calls with the old password get 401, and Postmark retries them.

## Check extraction quality (8.7)
- `pnpm --filter @verilo/ai eval` with `EXTRACTOR=gemini VERTEX_MODEL=… GCP_PROJECT=… VERTEX_LOCATION=…`
  and Application Default Credentials that can call Vertex AI. It reports total-hours accuracy on
  clear images (target ≥ 98 %) and lists wrong reads that no BLOCK/WARN check caught (target: none).
  It costs money, so it isn't run in CI. `EXTRACTOR=fixture` runs it for free (perfect answers).
- `pnpm --filter @verilo/ai fixtures:generate` rebuilds the synthetic fixture set. Replace it with
  anonymized pilot screenshots (open decision 8): put each file next to a `<name>.expected.json`,
  and add it to `manifest.json`.

## Stuck items
- An extraction left RUNNING for more than 10 minutes is reclaimed the next time its job runs.
  Jobs retry 3 times with backoff.
- Emails that couldn't be matched wait in Timesheets → Unmatched. Finance assigns them to a
  timesheet there.
