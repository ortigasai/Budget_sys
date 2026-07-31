#!/usr/bin/env bash
# Starts the local portable PostgreSQL 16 instance (no install/service required).
# Data lives outside the repo at C:\Users\<you>\pgsql16 since it's a large binary tree.
set -e

PG_HOME="/c/Users/$(whoami)/pgsql16"
PGBIN="$PG_HOME/bin"
PGDATA="$PG_HOME/data"

if [ ! -d "$PGDATA" ]; then
  echo "No data directory found at $PGDATA. Run initdb first (see README)."
  exit 1
fi

if "$PGBIN/pg_ctl.exe" -D "$PGDATA" status > /dev/null 2>&1; then
  echo "Postgres is already running."
else
  "$PGBIN/pg_ctl.exe" -D "$PGDATA" -l "$PG_HOME/server.log" -o "-p 5432" start
fi
