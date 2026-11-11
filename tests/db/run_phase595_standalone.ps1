# ============================================================================
# Phase 5.9.5 Disposable PG 17 Standalone Runner (8 Baseline -> 20261111180000)
# ============================================================================
param(
    [string]$Image           = "public.ecr.aws/supabase/postgres:17.11.0.011",
    [string]$ContainerPrefix = "mv_p595_disposable_"
)

$ErrorActionPreference = "Stop"
$ContainerName = "${ContainerPrefix}$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$CreatedContainerId = $null
$SuitePassed = $false

function Exec-Psql($cName, $dbName, $filePath) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -f $filePath 2>&1
        $exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    $text = ($out | Out-String)
    Write-Host $text
    if ($exit -ne 0 -or $text -match "(?m)^\s*not ok ") {
        throw "FATAL: psql failed (exit=$exit) on $filePath"
    }
}

function Exec-Sql($cName, $dbName, $sql) {
    docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: inline psql failed (exit=$LASTEXITCODE): $sql"
    }
}

try {
    Write-Host "[5.9.5] Starting isolated PG17 container ($Image) with --network none..."
    $CreatedContainerId = (docker run -d --name $ContainerName --network none -e POSTGRES_PASSWORD=postgres $Image).Trim()
    if (-not $CreatedContainerId) { throw "Failed to start container" }

    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        docker exec $ContainerName pg_isready -U postgres -h localhost 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            docker exec $ContainerName psql -U postgres -c "SELECT 1;" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Postgres failed readiness" }

    Exec-Sql $ContainerName "postgres" "SELECT version(); SHOW server_version;"
    $netInfo = docker exec $ContainerName ip route 2>&1
    if ($netInfo -match "default") { throw "SAFETY VIOLATION: network not isolated" }
    Write-Host "[PASS] Network isolation (--network none) verified."

    docker cp tests/db ${ContainerName}:/test_db
    docker cp supabase/migrations ${ContainerName}:/test_db/supabase_migrations

    $baseline = @(
        "/test_db/supabase_migrations/20261108000001_notification_endpoints_and_preferences.sql",
        "/test_db/supabase_migrations/20261108000002_notification_subscriptions_and_inbox.sql",
        "/test_db/supabase_migrations/20261108000003_notification_campaigns_and_queue.sql",
        "/test_db/supabase_migrations/20261108000004_notification_deliveries_and_telemetry.sql",
        "/test_db/supabase_migrations/20261108000005_notification_rpcs_and_functions.sql",
        "/test_db/supabase_migrations/20261108000006_notification_rls_and_dcl.sql",
        "/test_db/supabase_migrations/20261108000007_legacy_api_compatibility_layer.sql",
        "/test_db/supabase_migrations/20261108195246_secure_notification_views_with_invoker_rls.sql"
    )

    # DB 1: Standalone path (8 baseline -> seed inconsistent production state -> unified migration -> 38 pgTAP checks)
    Exec-Sql $ContainerName "postgres" "CREATE DATABASE mv_p595_standalone;"
    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/00_disposable_auth_fixtures.sql"
    foreach ($m in $baseline) { Exec-Psql $ContainerName "mv_p595_standalone" $m }
    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/phase595_pre_reconcile_seed.sql"
    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/supabase_migrations/20261111180000_unified_notification_dispatch_and_revocation.sql"

    # Assert seeded legacy inconsistent endpoints and preserved records
    Exec-Sql $ContainerName "mv_p595_standalone" "DO `$`$ BEGIN IF (SELECT count(*) FROM public.notification_endpoints WHERE is_active = false AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND id IN ('faa972b2-3cd7-4ed9-bb67-f931ca6a0601','59581000-0000-0000-0000-000000000002')) <> 2 THEN RAISE EXCEPTION 'Inconsistent endpoint reconciliation failed'; END IF; IF (SELECT count(*) FROM public.notification_telemetry WHERE event_nonce = 'seed_rec_1') <> 1 OR (SELECT count(*) FROM public.user_notifications WHERE delivery_id = '59583000-0000-0000-0000-000000000001') <> 1 OR (SELECT count(*) FROM public.notification_deliveries WHERE id = '59583000-0000-0000-0000-000000000001') <> 1 THEN RAISE EXCEPTION 'Data preservation check failed'; END IF; END `$`$;"

    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/phase595_standalone_verify.sql"

    # Parallel 2-session concurrency on 8 baseline -> unified migration
    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/phase595_concurrency_harness.sql"

    $j1 = Start-Job -ScriptBlock {
        param($c)
        $o = docker exec $c psql -U postgres -d mv_p595_standalone -v ON_ERROR_STOP=1 -f /test_db/phase595_s1_auth_revoke.sql 2>&1
        [PSCustomObject]@{ Session = "AuthRevokeS1"; ExitCode = $LASTEXITCODE; Output = ($o | Out-String) }
    } -ArgumentList $ContainerName
    $j2 = Start-Job -ScriptBlock {
        param($c)
        $o = docker exec $c psql -U postgres -d mv_p595_standalone -v ON_ERROR_STOP=1 -f /test_db/phase595_s2_auth_revoke.sql 2>&1
        [PSCustomObject]@{ Session = "AuthRevokeS2"; ExitCode = $LASTEXITCODE; Output = ($o | Out-String) }
    } -ArgumentList $ContainerName
    $r = @((Receive-Job -Job $j1 -Wait -AutoRemoveJob), (Receive-Job -Job $j2 -Wait -AutoRemoveJob))
    foreach ($x in $r) {
        Write-Host $x.Output
        if ($x.ExitCode -ne 0) { throw "Parallel job $($x.Session) failed (exit=$($x.ExitCode))" }
    }

    $k1 = Start-Job -ScriptBlock {
        param($c)
        $o = docker exec $c psql -U postgres -d mv_p595_standalone -v ON_ERROR_STOP=1 -f /test_db/phase595_s1_cancel_sweep.sql 2>&1
        [PSCustomObject]@{ Session = "CancelSweepS1"; ExitCode = $LASTEXITCODE; Output = ($o | Out-String) }
    } -ArgumentList $ContainerName
    $k2 = Start-Job -ScriptBlock {
        param($c)
        $o = docker exec $c psql -U postgres -d mv_p595_standalone -v ON_ERROR_STOP=1 -f /test_db/phase595_s2_cancel_sweep.sql 2>&1
        [PSCustomObject]@{ Session = "CancelSweepS2"; ExitCode = $LASTEXITCODE; Output = ($o | Out-String) }
    } -ArgumentList $ContainerName
    $r2 = @((Receive-Job -Job $k1 -Wait -AutoRemoveJob), (Receive-Job -Job $k2 -Wait -AutoRemoveJob))
    foreach ($x in $r2) {
        Write-Host $x.Output
        if ($x.ExitCode -ne 0) { throw "Parallel job $($x.Session) failed (exit=$($x.ExitCode))" }
    }

    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/phase595_conc_verify.sql"

    # Also verify preflight SQL syntax executes cleanly with 0 mutations on a disposable ledger view
    Exec-Sql $ContainerName "mv_p595_standalone" "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text); INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261108000001','baseline'),('20261108000002','baseline'),('20261108000003','baseline'),('20261108000004','baseline'),('20261108000005','baseline'),('20261108000006','baseline'),('20261108000007','baseline'),('20261108195246','baseline') ON CONFLICT DO NOTHING;"
    Exec-Psql $ContainerName "mv_p595_standalone" "/test_db/phase595_production_preflight_readonly.sql"

    $SuitePassed = $true
    Write-Host "`n[PASS] Phase 5.9.5 Standalone PG17 Verification PASSED (0 failures)." -ForegroundColor Green
} finally {
    if ($CreatedContainerId) {
        docker rm -f $CreatedContainerId | Out-Null
    }
    if (-not $SuitePassed) { exit 1 }
}
