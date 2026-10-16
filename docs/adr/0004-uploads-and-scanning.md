# ADR 0004 — Uploads: signed URL → scan → viewable

Status: accepted

1. `requestUpload` validates type (PDF, PNG, JPEG, WebP, HEIC) and size (≤ 15 MB), creates the
   `file` row (`PENDING`) and returns a signed PUT URL. The storage key is generated from ids;
   the filename never becomes part of the key. Size is enforced by the signature
   (`Content-Length` on S3, `x-goog-content-length-range` on GCS).
2. The browser uploads directly to the bucket.
3. `completeUpload` checks the object exists and matches the declared size, streams it to ClamAV,
   records `sha256`, and moves `scan_status` PENDING → CLEAN | INFECTED through the domain state
   machine (results are final). Done inline so the uploader sees the result; large-volume intake
   (M2) can move this to a pg-boss job without changing the contract.
4. Only CLEAN files get signed download URLs (section 17). INFECTED objects stay quarantined in
   the bucket (never deleted, never served).

ClamAV runs as Cloud Run service `clamav` with internal ingress; `web`/`worker` call it with an ID
token and route all egress through the VPC (Cloud NAT for the internet). The wrapper starts
listening only after `clamd` answers PING, so the TCP startup probe means "ready".
