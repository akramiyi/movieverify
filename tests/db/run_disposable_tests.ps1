# ============================================================================
# MOVIEVERIFY PHASE 2 RELEASE: DISPOSABLE POSTGRESQL 17 EXECUTION RUNBOOK (R4.0)
# File: tests/db/run_disposable_tests.ps1
# Mode: Local Disposable Docker Container (public.ecr.aws/supabase/postgres:17.11.0.011)
# Zero Remote Connection: Enforced via --network none
# Concurrency Protocol: Deterministic Two-Way Advisory Handshake
#
# Phase 2 corrections from R3.1:
#   - Default image updated to public.ecr.aws/supabase/postgres:17.11.0.011 (PG 17.11)
#   - Applies all 8 versioned release migrations sequentially (not consolidated Phase 1.5 SQL)
#   - Separate rollback test database (mv_rollback_test) for rollback_notifications.sql
#   - Legacy Phase 1.5 upgrade test preserved as a separately named stage
#   - Migration exit codes checked individually with -v ON_ERROR_STOP=1
# ============================================================================

param(
    [string]$Image           = "public.ecr.aws/supabase/postgres:17.11.0.011",
    [string]$ContainerPrefix = "mv_disposable_"
)

$ErrorActionPreference = "Stop"

function Log-Header($msg) {
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "`n[$time] ========================================================" -ForegroundColor Cyan
    Write-Host "[$time] $msg" -ForegroundColor Cyan
    Write-Host "[$time] ========================================================" -ForegroundColor Cyan
}

function Log-Step($msg) {
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "[$time] --> $msg" -ForegroundColor Gray
}

function Exec-Psql($cName, $dbName, $filePath) {
    Log-Step "Executing psql on database '$dbName': $filePath"
    docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -f $filePath
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: psql command failed with exit code ${LASTEXITCODE} on file: $filePath"
    }
}

function Exec-Psql-Sql($cName, $dbName, $sql) {
    Log-Step "Executing inline SQL on database '$dbName'"
    docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: inline SQL command failed with exit code ${LASTEXITCODE}"
    }
}

function Apply-Phase2-Migrations($cName, $dbName) {
    Log-Step "Applying 8 Phase 2 release migrations to '$dbName'..."
    $migrations = @(
        "/test_db/supabase_migrations/20261108000001_notification_endpoints_and_preferences.sql",
        "/test_db/supabase_migrations/20261108000002_notification_subscriptions_and_inbox.sql",
        "/test_db/supabase_migrations/20261108000003_notification_campaigns_and_queue.sql",
        "/test_db/supabase_migrations/20261108000004_notification_deliveries_and_telemetry.sql",
        "/test_db/supabase_migrations/20261108000005_notification_rpcs_and_functions.sql",
        "/test_db/supabase_migrations/20261108000006_notification_rls_and_dcl.sql",
        "/test_db/supabase_migrations/20261108000007_legacy_api_compatibility_layer.sql",
        "/test_db/supabase_migrations/20261108195246_secure_notification_views_with_invoker_rls.sql"
    )
    $i = 1
    foreach ($m in $migrations) {
        Log-Step "  Migration $i/8: $m"
        docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -f $m
        if ($LASTEXITCODE -ne 0) {
            throw "FATAL: Migration $i failed on '$dbName': $m (exit code $LASTEXITCODE)"
        }
        Write-Host "  [OK] Migration $i applied successfully." -ForegroundColor Green
        $i++
    }
    Write-Host "All 8 Phase 2 release migrations applied to '$dbName'." -ForegroundColor Green
}

function Apply-Full-Notification-Migrations($cName, $dbName, [bool]$includePhase54 = $true) {
    Apply-Phase2-Migrations $cName $dbName
    $extra = @(
        "/test_db/supabase_migrations_superseded/20261110150000_notification_dispatch_hardening_and_concurrency.sql",
        "/test_db/supabase_migrations_superseded/20261111000000_endpoint_revocation_security_remediation.sql",
        "/test_db/supabase_migrations/20261111120000_smart_notification_automation_engine.sql"
    )
    if ($includePhase54) {
        $extra += "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql"
    }
    foreach ($m in $extra) {
        Log-Step "  Post-Phase2 Migration on '$dbName': $m"
        docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -f $m
        if ($LASTEXITCODE -ne 0) {
            throw "FATAL: Migration failed on '$dbName': $m (exit code $LASTEXITCODE)"
        }
        Write-Host "  [OK] Applied $(Split-Path $m -Leaf)" -ForegroundColor Green
    }
}

function Apply-Combined-Production-Sequence($cName, $dbName) {
    Apply-Phase2-Migrations $cName $dbName
    # Phase 5.9.7 Intended Production Sequence (strictly excludes B5D 20261110150000 and B5E 20261111000000)
    $combined = @(
        "/test_db/supabase_migrations/20261111120000_smart_notification_automation_engine.sql",
        "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql",
        "/test_db/supabase_migrations/20261111180000_unified_notification_dispatch_and_revocation.sql"
    )
    foreach ($m in $combined) {
        Log-Step "  Production Sequence Migration on '$dbName': $m"
        docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -f $m
        if ($LASTEXITCODE -ne 0) {
            throw "FATAL: Combined production sequence migration failed on '$dbName': $m (exit code $LASTEXITCODE)"
        }
        Write-Host "  [OK] Applied $(Split-Path $m -Leaf)" -ForegroundColor Green
    }
}

function Run-Parallel-Sql-Pair($cName, $dbName, $s1File, $s2File, $label) {
    Log-Step "Launching parallel psql pair for $label ($s1File vs $s2File)..."
    $j1 = Start-Job -ScriptBlock {
        param($c, $db, $f)
        $out = docker exec $c psql -U postgres -d $db -v ON_ERROR_STOP=1 -f $f 2>&1
        [PSCustomObject]@{ Session = $f; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $cName, $dbName, $s1File
    $j2 = Start-Job -ScriptBlock {
        param($c, $db, $f)
        $out = docker exec $c psql -U postgres -d $db -v ON_ERROR_STOP=1 -f $f 2>&1
        [PSCustomObject]@{ Session = $f; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $cName, $dbName, $s2File
    Wait-And-Validate-Jobs $j1 $j2 $label
}

function Wait-And-Validate-Jobs($job1, $job2, [string]$suiteName) {
    Log-Step "Awaiting background jobs for $suiteName (30s timeout)..."
    $finished = Wait-Job $job1, $job2 -Timeout 30
    if ($null -eq $finished -or $job1.State -ne 'Completed' -or $job2.State -ne 'Completed') {
        Stop-Job $job1, $job2 -ErrorAction SilentlyContinue
        throw "FATAL: Background jobs for $suiteName timed out or did not complete. Job1 State=$($job1.State), Job2 State=$($job2.State)"
    }

    $res1 = Receive-Job $job1
    $res2 = Receive-Job $job2
    Remove-Job $job1, $job2

    if ($null -eq $res1 -or $null -eq $res2) {
        throw "FATAL: Missing background job execution results for $suiteName."
    }

    if ($res1.ExitCode -ne 0) {
        Write-Host $res1.Output -ForegroundColor Red
        throw "FATAL: Job 1 ($($res1.Session)) failed with exit code $($res1.ExitCode)."
    }
    if ($res2.ExitCode -ne 0) {
        Write-Host $res2.Output -ForegroundColor Red
        throw "FATAL: Job 2 ($($res2.Session)) failed with exit code $($res2.ExitCode)."
    }

    Log-Step "Both parallel sessions for $suiteName completed with exit code 0."
}

# ----------------------------------------------------------------------------
# STEP 0: Safety Verification (Zero Remote Egress, Image Availability, Pre-Flight SQL Scan)
# ----------------------------------------------------------------------------
Log-Header "STEP 0: Pre-Flight Safety Verification"

# Verify the required PG17 Docker image is present locally
Log-Step "Verifying Docker image is present locally: $Image"
$imgCheck = docker image inspect $Image 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "BLOCKED: Docker image '$Image' is NOT present locally. Do not download from an unverified source. Load the image manually and retry."
}
Write-Host "Docker image verified locally: $Image" -ForegroundColor Green

# Verify PostgreSQL 17 is the target (from image tag)
if ($Image -notmatch "17\.") {
    throw "BLOCKED: Image '$Image' does not appear to be a PostgreSQL 17 image. Phase 2 requires PG17."
}

# Verify SQL files do not target live Supabase production
$sqlFiles = Get-ChildItem -Path "tests/db" -Filter "*.sql"
foreach ($f in $sqlFiles) {
    $content = Get-Content $f.FullName -Raw
    if ($content -match "jbfqwxcymldhyembzjpv|supabase\.co") {
        throw "SAFETY VIOLATION: Remote Supabase URL detected in $($f.Name)! Execution aborted."
    }
}
Write-Host "Pre-flight scan passed: 0 remote Supabase connection strings found in tests/db/*.sql." -ForegroundColor Green

# Generate Unique Disposable Container Name
$uniqueSuffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$ContainerName = "${ContainerPrefix}${uniqueSuffix}"
Log-Step "Generated unique disposable container name: $ContainerName"

# Verify container name does not collide with pre-existing containers
$existing = docker ps -a -q -f "name=^/${ContainerName}$"
if ($existing) {
    throw "SAFETY ERROR: Container '$ContainerName' already exists. Refusing to delete or overwrite pre-existing container."
}

$CreatedContainerId = $null
$SuitePassed = $false
$CleanupPassed = $false

try {
    # ----------------------------------------------------------------------------
    # STEP 1: Launch Disposable PostgreSQL 17 Container with --network none
    # ----------------------------------------------------------------------------
    Log-Header "STEP 1: Starting Isolated Disposable PostgreSQL 17 Container"
    Log-Step "Image: $Image"
    Log-Step "Network: --network none (zero external connectivity)"

    $runOut = docker run -d --name $ContainerName `
        --network none `
        -e POSTGRES_PASSWORD=postgres `
        $Image

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runOut)) {
        throw "FATAL: docker run failed with exit code $LASTEXITCODE."
    }

    $CreatedContainerId = $runOut.Trim()
    Log-Step "Container started: $CreatedContainerId"

    Log-Step "Polling PostgreSQL Readiness (pg_isready)..."
    $maxAttempts = 30
    $ready = $false
    for ($i = 1; $i -le $maxAttempts; $i++) {
        docker exec $ContainerName pg_isready -U postgres -h localhost 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            Write-Host "PostgreSQL is ready (attempt $i)." -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not $ready) {
        throw "FATAL: PostgreSQL failed to become ready within $maxAttempts seconds."
    }

    # Verify actual PostgreSQL version
    Log-Step "Verifying PostgreSQL server version..."
    docker exec $ContainerName psql -U postgres -c "SELECT version(); SHOW server_version;"
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: Could not query PostgreSQL version."
    }

    # Verify network isolation: no default gateway
    Log-Step "Verifying network isolation (--network none)..."
    $netMode = docker inspect -f "NetworkMode={{.HostConfig.NetworkMode}} Networks={{json .NetworkSettings.Networks}}" $ContainerName
    Write-Host "  $netMode" -ForegroundColor Gray
    $netInfo = docker exec $ContainerName ip route 2>&1
    if ($netInfo -match "default") {
        throw "SAFETY VIOLATION: Container has a default network gateway! --network none was not enforced."
    }
    Write-Host "Network isolation verified: no default gateway present." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 2: Copy Test Scripts and Migrations into Container Filesystem
    # ----------------------------------------------------------------------------
    Log-Header "STEP 2: Provisioning Test Files and Migrations into Container"
    docker cp tests/db ${ContainerName}:/test_db
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: docker cp of tests/db failed."
    }

    # Copy migrations into the container
    docker cp supabase/migrations ${ContainerName}:/test_db/supabase_migrations
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: docker cp of supabase/migrations failed."
    }
    docker cp supabase/migrations_superseded ${ContainerName}:/test_db/supabase_migrations_superseded
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: docker cp of supabase/migrations_superseded failed."
    }
    Log-Step "Copied test artifacts and migrations (active + superseded archive) to ${ContainerName}:/test_db successfully."

    # ----------------------------------------------------------------------------
    # STEP 3: Legacy Phase 1.5 Historical Upgrade Verification (mv_upgrade_test)
    # (Preserved separately — does NOT use Phase 2 migrations)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 3: Legacy Phase 1.5 Historical Upgrade Testing (Database: mv_upgrade_test)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_upgrade_test;"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/fixture_state4_legacy_deliveries.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/00_disposable_auth_fixtures.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/20261102_harden_notifications_consolidated.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/test_upgrade_runner.sql"
    Write-Host "Legacy Phase 1.5 historical upgrade invariants verified successfully." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 4: Phase 2 Clean Install + 42-Assertion pgTAP Suite (mv_phase2_clean)
    # Applies all 8 versioned release migrations.
    # ----------------------------------------------------------------------------
    Log-Header "STEP 4A: Phase 2 Clean Install + 42-Assertion pgTAP Suite (Database: mv_phase2_clean)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase2_clean;"
    Exec-Psql $ContainerName "mv_phase2_clean" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Phase2-Migrations $ContainerName "mv_phase2_clean"
    Exec-Psql $ContainerName "mv_phase2_clean" "/test_db/pgtap_suite.sql"
    Write-Host "42-Assertion Phase 2 pgTAP suite passed." -ForegroundColor Green

    Log-Header "STEP 4B: Phase 2 Campaign Ingestion Suite (Database: mv_phase2_campaign)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase2_campaign;"
    Exec-Psql $ContainerName "mv_phase2_campaign" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Phase2-Migrations $ContainerName "mv_phase2_campaign"
    Exec-Psql $ContainerName "mv_phase2_campaign" "/test_db/test_campaign_ingestion.sql"
    Write-Host "28-Assertion Phase 2 campaign ingestion suite passed." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 5: Phase 2 Concurrency Tests (mv_phase2_concurrency)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 5: Phase 2 Concurrency Claims & Transfer Race (Database: mv_phase2_concurrency)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase2_concurrency;"
    Exec-Psql $ContainerName "mv_phase2_concurrency" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Phase2-Migrations $ContainerName "mv_phase2_concurrency"
    Exec-Psql $ContainerName "mv_phase2_concurrency" "/test_db/concurrency_harness.sql"

    # Step 5B: Two Genuine Parallel Sessions — Reservation Concurrency
    Log-Step "Launching Worker 1 and Worker 2 deterministic two-way handshake background jobs..."
    $job1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session1_reservation.sql 2>&1
        [PSCustomObject]@{ Session = "Worker1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $job2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session2_reservation.sql 2>&1
        [PSCustomObject]@{ Session = "Worker2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $job1 $job2 "Reservation Concurrency Claims"

    # Verify Claims Intersection (INTERSECT == 0) and Transaction Overlap Proof
    Exec-Psql $ContainerName "mv_phase2_concurrency" "/test_db/verify_concurrency_race.sql"
    Write-Host "Reservation claims INTERSECT == 0 and transaction overlap formally proven." -ForegroundColor Green

    # Step 5D: Endpoint Deactivation Transfer Race
    Log-Step "Launching Endpoint-Deactivation Session 1 and Reservation Session 2 parallel jobs..."
    $tJob1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session1_transfer_race.sql 2>&1
        [PSCustomObject]@{ Session = "TransferSession1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $tJob2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session2_reserve_race.sql 2>&1
        [PSCustomObject]@{ Session = "ReserveSession2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $tJob1 $tJob2 "Endpoint Deactivation Race"

    Exec-Psql $ContainerName "mv_phase2_concurrency" "/test_db/verify_transfer_race.sql"
    Write-Host "Endpoint deactivation transfer race and zero-leakage formally proven." -ForegroundColor Green

    # Step 5E: Campaign Idempotency Race
    Log-Step "Launching Campaign Idempotency Session 1 and Session 2 parallel jobs..."
    $cJob1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session1_campaign_idemp.sql 2>&1
        [PSCustomObject]@{ Session = "CampaignSession1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $cJob2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_phase2_concurrency -v ON_ERROR_STOP=1 -f /test_db/session2_campaign_idemp.sql 2>&1
        [PSCustomObject]@{ Session = "CampaignSession2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $cJob1 $cJob2 "Campaign Idempotency Race"

    Exec-Psql $ContainerName "mv_phase2_concurrency" "/test_db/verify_campaign_idemp_race.sql"
    Write-Host "Campaign idempotency race and zero duplicate deliveries formally proven." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 6: Phase 2 Rollback Verification (Separate Database: mv_rollback_test)
    # Must use a separate DB — rollback drops Phase 2 objects with RESTRICT.
    # ----------------------------------------------------------------------------
    Log-Header "STEP 6: Phase 2 Rollback Verification (Database: mv_rollback_test)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_rollback_test;"
    Exec-Psql $ContainerName "mv_rollback_test" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Phase2-Migrations $ContainerName "mv_rollback_test"
    Log-Step "Executing rollback_notifications.sql on mv_rollback_test..."
    Exec-Psql $ContainerName "mv_rollback_test" "/test_db/rollback_notifications.sql"
    Write-Host "Phase 2 rollback verified: all notification objects removed without CASCADE." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 8: Phase 5.7 Stage 2 & 3 — Full 12-Migration Sequence + Schema/ACL Suite
    # ----------------------------------------------------------------------------
    Log-Header "STEP 8: Phase 5.7 Full 12-Migration Stack + Schema/ACL/Trigger Suite (mv_phase57_main)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_main;"
    Exec-Psql $ContainerName "mv_phase57_main" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_main" $true
    Log-Step "Executing Stage 3 pgTAP verification on 'mv_phase57_main'..."
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $p57SchemaOut = docker exec $ContainerName psql -U postgres -d mv_phase57_main -v ON_ERROR_STOP=1 -f /test_db/phase57_schema_acl_verify.sql 2>&1
        $p57Exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    $p57SchemaText = ($p57SchemaOut | Out-String)
    Write-Host $p57SchemaText
    if ($p57Exit -ne 0 -or $p57SchemaText -match "(?m)^\s*not ok ") {
        throw "FATAL: Phase 5.7 Stage 3 pgTAP suite reported one or more failed assertions!"
    }
    Write-Host "Phase 5.7 Stage 2 & 3 Schema/ACL/Trigger pgTAP suite (36/36) passed." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 9: Phase 5.7 Stage 4 — Genuine Parallel Concurrency Verification
    # ----------------------------------------------------------------------------
    Log-Header "STEP 9: Phase 5.7 Genuine Parallel PG17 Concurrency Suite (mv_phase57_conc)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_conc;"
    Exec-Psql $ContainerName "mv_phase57_conc" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_conc" $true
    Exec-Psql $ContainerName "mv_phase57_conc" "/test_db/phase57_concurrency_harness.sql"

    Run-Parallel-Sql-Pair $ContainerName "mv_phase57_conc" "/test_db/phase57_s1_cap.sql" "/test_db/phase57_s2_cap.sql" "Lock 1001 max_daily_push"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase57_conc" "/test_db/phase57_s1_idemp.sql" "/test_db/phase57_s2_idemp.sql" "Lock 1002 Campaign Idempotency"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase57_conc" "/test_db/phase57_s1_lockorder.sql" "/test_db/phase57_s2_lockorder.sql" "H-4 Telemetry vs Cancel Lock Order"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase57_conc" "/test_db/phase57_s1_b5e.sql" "/test_db/phase57_s2_b5e.sql" "B5E Reservation Concurrency"
    Exec-Psql $ContainerName "mv_phase57_conc" "/test_db/phase57_concurrency_verify.sql"
    Write-Host "Phase 5.7 Stage 4 Concurrency & Fencing Verification passed." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 10: Phase 5.7 Stage 5 — Telemetry Preservation (Cases 1, 2, 3A, 3B, 3C)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 10: Phase 5.7 Telemetry Preservation Verification (5 Isolated Cases)"
    # Case 1: No duplicate deliveries
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_t1;"
    Exec-Psql $ContainerName "mv_phase57_t1" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_t1" $false
    Exec-Psql $ContainerName "mv_phase57_t1" "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql"
    Write-Host "[PASS] Stage 5 Case 1 (no duplicates) passed." -ForegroundColor Green

    # Case 2: Duplicate deliveries without telemetry
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_t2;"
    Exec-Psql $ContainerName "mv_phase57_t2" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_t2" $false
    Exec-Psql $ContainerName "mv_phase57_t2" "/test_db/phase57_telemetry_c2_seed.sql"
    Exec-Psql $ContainerName "mv_phase57_t2" "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql"
    Exec-Psql $ContainerName "mv_phase57_t2" "/test_db/phase57_telemetry_c2_verify.sql"

    # Case 3A: Duplicate deliveries with clean non-colliding telemetry
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_t3a;"
    Exec-Psql $ContainerName "mv_phase57_t3a" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_t3a" $false
    Exec-Psql $ContainerName "mv_phase57_t3a" "/test_db/phase57_telemetry_c3a_seed.sql"
    Exec-Psql $ContainerName "mv_phase57_t3a" "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql"
    Exec-Psql $ContainerName "mv_phase57_t3a" "/test_db/phase57_telemetry_c3a_verify.sql"

    function Assert-Migration-Fails-Closed($ContainerName, $Database, $ExpectedRegex, $CaseLabel) {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $out = docker exec $ContainerName psql -U postgres -d $Database -v ON_ERROR_STOP=1 -f /test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEap
        }
        $outStr = ($out | Out-String)
        if ($exitCode -eq 0 -or $outStr -notmatch $ExpectedRegex) {
            throw "FATAL: $CaseLabel should have failed closed with regex '$ExpectedRegex'! Exit=$exitCode Output: $outStr"
        }
        Exec-Psql $ContainerName $Database "/test_db/phase57_telemetry_rollback_verify.sql"
    }

    # Case 3B: Duplicate deliveries with telemetry nonce collision (MUST fail-closed, 0 rows deleted)
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_t3b;"
    Exec-Psql $ContainerName "mv_phase57_t3b" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_t3b" $false
    Exec-Psql $ContainerName "mv_phase57_t3b" "/test_db/phase57_telemetry_c3b_seed.sql"
    Log-Step "Expecting MV409 fail-closed abort on Case 3B (telemetry nonce collision)..."
    Assert-Migration-Fails-Closed $ContainerName "mv_phase57_t3b" "Telemetry .* collision detected" "Case 3B collision"
    Write-Host "[PASS] Stage 5 Case 3B (telemetry collision) failed closed cleanly with 0 rows lost." -ForegroundColor Green

    # Case 3C: Duplicate deliveries with ambiguous recipient mismatch (MUST fail-closed, 0 rows deleted)
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase57_t3c;"
    Exec-Psql $ContainerName "mv_phase57_t3c" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Full-Notification-Migrations $ContainerName "mv_phase57_t3c" $false
    Exec-Psql $ContainerName "mv_phase57_t3c" "/test_db/phase57_telemetry_c3c_seed.sql"
    Log-Step "Expecting MV409 fail-closed abort on Case 3C (ambiguous recipient attribution)..."
    Assert-Migration-Fails-Closed $ContainerName "mv_phase57_t3c" "Ambiguous recipient attribution" "Case 3C recipient mismatch"
    Write-Host "[PASS] Stage 5 Case 3C (recipient mismatch) failed closed cleanly with 0 rows lost." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 11: Phase 5.9.7 Exact Combined Production Sequence Verification
    #          8 Baselines -> Phase 5.2 (120000) -> Phase 5.4 (150000) -> Unified (180000)
    #          (Excludes B5D 20261110150000 and B5E 20261111000000)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 11A: Phase 5.9.7 Combined Production Sequence & Data Preservation (mv_phase597_combined)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase597_combined;"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Phase2-Migrations $ContainerName "mv_phase597_combined"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/phase597_pre_reconcile_seed.sql"

    Log-Step "Verifying read-only preflight SQL runs cleanly on disposable 8-baseline schema (mv_phase597_combined)..."
    Exec-Psql-Sql $ContainerName "mv_phase597_combined" "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text); INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261108000001','baseline'),('20261108000002','baseline'),('20261108000003','baseline'),('20261108000004','baseline'),('20261108000005','baseline'),('20261108000006','baseline'),('20261108000007','baseline'),('20261108195246','baseline') ON CONFLICT DO NOTHING;"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/phase595_production_preflight_readonly.sql"

    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/supabase_migrations/20261111120000_smart_notification_automation_engine.sql"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/supabase_migrations/20261111150000_smart_notification_critical_remediation.sql"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/supabase_migrations/20261111180000_unified_notification_dispatch_and_revocation.sql"

    Log-Step "Executing 50-assertion combined PG17 pgTAP suite on 'mv_phase597_combined'..."
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $p597Out = docker exec $ContainerName psql -U postgres -d mv_phase597_combined -v ON_ERROR_STOP=1 -f /test_db/phase597_combined_verify.sql 2>&1
        $p597Exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    $p597Text = ($p597Out | Out-String)
    Write-Host $p597Text
    if ($p597Exit -ne 0 -or $p597Text -match "(?m)^\s*not ok ") {
        throw "FATAL: Phase 5.9.7 combined pgTAP suite reported one or more failed assertions!"
    }

    Log-Step "Verifying read-only preflight SQL runs cleanly on combined schema (mv_phase597_combined)..."
    Exec-Psql-Sql $ContainerName "mv_phase597_combined" "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text); INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261108000001','baseline'),('20261108000002','baseline'),('20261108000003','baseline'),('20261108000004','baseline'),('20261108000005','baseline'),('20261108000006','baseline'),('20261108000007','baseline'),('20261108195246','baseline') ON CONFLICT DO NOTHING;"
    Exec-Psql $ContainerName "mv_phase597_combined" "/test_db/phase595_production_preflight_readonly.sql"

    Log-Header "STEP 11B: Phase 5.9.7 Combined Genuine Two-Session Concurrency Suite (mv_phase597_conc)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_phase597_conc;"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/00_disposable_auth_fixtures.sql"
    Apply-Combined-Production-Sequence $ContainerName "mv_phase597_conc"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase57_concurrency_harness.sql"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase595_concurrency_harness.sql"

    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase57_s1_cap.sql" "/test_db/phase57_s2_cap.sql" "597 Combined Lock 1001 max_daily_push"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase57_s1_idemp.sql" "/test_db/phase57_s2_idemp.sql" "597 Combined Lock 1002 Campaign Idempotency"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase57_s1_lockorder.sql" "/test_db/phase57_s2_lockorder.sql" "597 Combined H-4 Telemetry vs Cancel Lock Order"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase57_s1_b5e.sql" "/test_db/phase57_s2_b5e.sql" "597 Combined B5E Reservation & Dispatch Fencing"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase595_s1_auth_revoke.sql" "/test_db/phase595_s2_auth_revoke.sql" "597 Combined Revocation vs Authorize FOR SHARE"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase595_s1_cancel_sweep.sql" "/test_db/phase595_s2_cancel_sweep.sql" "597 Combined Cancel vs Deterministic Sweep"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase57_concurrency_verify.sql"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase595_conc_verify.sql"

    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase5910_concurrency_harness.sql"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase5910_s1_a1.sql" "/test_db/phase5910_s2_a1.sql" "5910-A1 Cancel Holds Rows While Sweep Skips & Mutates"
    Run-Parallel-Sql-Pair $ContainerName "mv_phase597_conc" "/test_db/phase5910_s1_a2.sql" "/test_db/phase5910_s2_a2.sql" "5910-A2 Reverse Delivery Lock Holder vs Cancel Waiter"
    Exec-Psql $ContainerName "mv_phase597_conc" "/test_db/phase5910_conc_verify.sql"
    Write-Host "[PASS] Phase 5.9.10 Combined Production Sequence (50 pgTAP + 8 parallel concurrency races incl. A1 & A2) PASSED." -ForegroundColor Green

    $SuitePassed = $true

} finally {
    # ----------------------------------------------------------------------------
    # STEP 7: Teardown & Cleanup Verification (Only Owned Container Removed)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 7: Teardown & Cleanup Verification"
    if ($CreatedContainerId) {
        Log-Step "Removing confirmed owned disposable container: $ContainerName ($CreatedContainerId)..."
        $rmOut = docker rm -f $CreatedContainerId 2>&1
        $rmExit = $LASTEXITCODE
        if ($rmExit -ne 0) {
            Write-Host "CLEANUP ERROR: docker rm -f exited with code ${rmExit} - $rmOut" -ForegroundColor Red
            $CleanupPassed = $false
        } else {
            # Verification: Confirm container no longer exists
            $checkRemaining = docker ps -a -q -f "id=$CreatedContainerId"
            if ($checkRemaining) {
                Write-Host "CLEANUP VERIFICATION FAILED: Container $CreatedContainerId still exists!" -ForegroundColor Red
                $CleanupPassed = $false
            } else {
                Write-Host "Cleanup verified: Container $CreatedContainerId confirmed deleted." -ForegroundColor Green
                $CleanupPassed = $true
            }
        }
    } else {
        Log-Step "No container was created in this session; skipping container removal."
        $CleanupPassed = $true
    }

    if ($SuitePassed -and $CleanupPassed) {
        Log-Header "FINAL VERDICT: ALL PHASE 2 DATABASE SUITES PASSED SUCCESSFULLY (100% GREEN)"
        Write-Host "All Phase 2 release database test suites passed and container cleanup was verified." -ForegroundColor Green
    } else {
        Write-Host "`nEXECUTION HALTED WITH FAILURES:" -ForegroundColor Red
        if (-not $SuitePassed) {
            Write-Host " - Database test suites DID NOT pass or were aborted." -ForegroundColor Red
        }
        if (-not $CleanupPassed) {
            Write-Host " - Container cleanup FAILED! Remaining container ID: $CreatedContainerId" -ForegroundColor Red
        }
        exit 1
    }
}
