#!/bin/sh
# Start clamd (and freshclam) using the official image's init, then the HTTP front end.
# If either process exits, the container exits so Cloud Run restarts it.
set -eu
/init &
INIT_PID=$!
node /app/server.mjs &
NODE_PID=$!
while kill -0 "$INIT_PID" 2>/dev/null && kill -0 "$NODE_PID" 2>/dev/null; do sleep 5; done
echo '{"severity":"ERROR","message":"clamd or http front end exited"}'
kill "$INIT_PID" "$NODE_PID" 2>/dev/null || true
exit 1
