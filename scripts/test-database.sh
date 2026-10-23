#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
# Isolated disposable Postgres; never runs against a configured/live database.
container="poker-db-test-${RANDOM}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=poker-test postgres:17-alpine >/dev/null
# The image first starts a temporary Unix-socket-only server for initialization.
# Wait for an authenticated TCP query so bootstrap cannot race its shutdown.
postgres_ready=false
for attempt in {1..60}; do
  if docker exec -e PGPASSWORD=poker-test -e PGCONNECT_TIMEOUT=2 "$container" \
    psql -h 127.0.0.1 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 1
done
if [[ "$postgres_ready" != true ]]; then
  echo 'Timed out waiting for the final PostgreSQL server to accept authenticated TCP queries.' >&2
  docker logs "$container" >&2 || true
  exit 1
fi
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/security.sql
# Two connections race at the same revision. The first holds the group lock while
# the second waits, then the second must reject instead of overwriting the winner.
auth_sql="set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';"
group_id=$(docker exec "$container" psql -U postgres -qAt -c "$auth_sql select poker_create_group('Race')->>'id';")
race_dir=$(mktemp -d)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$race_dir"' EXIT
docker exec "$container" psql -U postgres -qAt -v ON_ERROR_STOP=1 -c "$auth_sql begin; select 1 from poker_private.groups where false;" >"$race_dir/forbidden" 2>&1 && { echo 'Private table access unexpectedly permitted'; exit 1; }
docker exec "$container" psql -U postgres -qAt -v ON_ERROR_STOP=1 -c "begin; select 1 from poker_private.groups where id='$group_id' for update; select pg_sleep(2); $auth_sql select poker_save_group('$group_id',0,'20000000-0000-0000-0000-000000000001',poker_group('$group_id')->'data'); commit;" >"$race_dir/first" 2>&1 &
first_pid=$!
for attempt in {1..30}; do
  sleeping=$(docker exec "$container" psql -U postgres -qAt -c "select count(*) from pg_stat_activity where wait_event='PgSleep';")
  if [[ "$sleeping" == "1" ]]; then break; fi
  sleep 0.1
done
if [[ "$sleeping" != "1" ]]; then cat "$race_dir/first"; echo 'Race setup failed'; exit 1; fi
if docker exec "$container" psql -U postgres -qAt -v ON_ERROR_STOP=1 -c "$auth_sql select poker_save_group('$group_id',0,'20000000-0000-0000-0000-000000000002',poker_group('$group_id')->'data');" >"$race_dir/second" 2>&1; then
  echo 'Concurrent stale save unexpectedly succeeded'; exit 1
fi
wait "$first_pid"
if ! grep -Fq 'Revision conflict' "$race_dir/second"; then cat "$race_dir/second"; exit 1; fi
revision=$(docker exec "$container" psql -U postgres -qAt -c "$auth_sql select poker_group('$group_id')->>'revision';")
[[ "$revision" == "1" ]] || { echo "Expected one committed save, got revision $revision"; exit 1; }
echo 'Concurrent Postgres save conflict test passed'
