#!/bin/sh
# ---------------------------------------------------------------------------
# Entry-point for the Hearth image.
#
# The process runs as `node`, but a freshly mounted volume at /data may be owned
# by root — Apple's container runtime does not copy image ownership onto an empty
# named volume the way Docker does. Without this fix the database cannot be
# created and the server crash-loops with SQLITE_CANTOPEN.
#
# So: start as root only long enough to hand /data to `node`, then drop
# privileges via busybox `su` (deliberately not su-exec — one fewer package for
# every architecture build to fetch). If started unprivileged, just run.
# ---------------------------------------------------------------------------

set -e

# Exported, not just defaulted: the server reads the same variable, and the two
# must agree or the chown below fixes a directory the server never uses.
export DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # A no-op for named volumes (root owns them, and that is the point). On a host
  # bind mount this cannot succeed — virtiofs keeps host ownership — which is why
  # README suggests running bind mounts with --user instead.
  chown -R node:node "$DATA_DIR" || true
  # `-c 'exec …'` makes node replace the shell, so signals reach it directly.
  exec su -s /bin/sh node -c 'cd /app && exec node "${CMD_FILE:-dist-server/hearth.mjs}"'
fi

cd /app
exec node "${CMD_FILE:-dist-server/hearth.mjs}"
