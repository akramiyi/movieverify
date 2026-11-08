# ============================================================================
# MOVIEVERIFY PHASE 15.1: DISPOSABLE POSTGRESQL EXECUTION RUNBOOK (R3.1)
# File: tests/db/run_disposable_tests.ps1
# Mode: Local Disposable Docker Container (supabase/postgres:15.1.1.78)
# Zero Remote Connection: Enforced via --network none
# Concurrency Protocol: Deterministic Two-Way Advisory Handshake
# ============================================================================

param(
    [string]$Image = "supabase/postgres:15.1.1.78",
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
    Log-Step "Executing inline SQL on database '$dbName': $sql"
    docker exec $cName psql -U postgres -d $dbName -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: inline SQL command failed with exit code ${LASTEXITCODE} on SQL: $sql"
    }
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
# STEP 0: Safety Verification (Zero Remote Egress & Pre-Flight SQL Scan)
# ----------------------------------------------------------------------------
Log-Header "STEP 0: Pre-Flight Safety Verification"

# Verify SQL files do not target live Supabase
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
    # STEP 1: Launch Disposable Container with --network none & Health Check
    # ----------------------------------------------------------------------------
    Log-Header "STEP 1: Starting Isolated Disposable Container ($Image)"
    Log-Step "Running container with --network none (zero network egress, pure docker exec isolation)..."
    
    $runOut = docker run -d --name $ContainerName `
        --network none `
        -e POSTGRES_PASSWORD=postgres `
        $Image
    
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runOut)) {
        throw "FATAL: docker run failed with exit code $LASTEXITCODE."
    }

    $CreatedContainerId = $runOut.Trim()
    Log-Step "Container started successfully with ID: $CreatedContainerId"

    Log-Step "Polling PostgreSQL Readiness Health Check (pg_isready)..."
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

    # ----------------------------------------------------------------------------
    # STEP 2: Copy Test Scripts into Container Filesystem
    # ----------------------------------------------------------------------------
    Log-Header "STEP 2: Provisioning Test Files into Container"
    docker cp tests/db ${ContainerName}:/test_db
    if ($LASTEXITCODE -ne 0) {
        throw "FATAL: docker cp failed with exit code $LASTEXITCODE."
    }
    Log-Step "Copied test artifacts to ${ContainerName}:/test_db successfully."

    # ----------------------------------------------------------------------------
    # STEP 3: State 4 Historical Upgrade Verification (Isolated DB: mv_upgrade_test)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 3: Historical State 4 Upgrade Testing (Database: mv_upgrade_test)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_upgrade_test;"
    
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/fixture_state4_legacy_deliveries.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/00_disposable_auth_fixtures.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/20261102_harden_notifications_consolidated.sql"
    Exec-Psql $ContainerName "mv_upgrade_test" "/test_db/test_upgrade_runner.sql"
    Write-Host "Historical upgrade invariants verified successfully." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 4: State 0 Clean-Install & 42-Assertion pgTAP Suite (Isolated DB: mv_clean_test)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 4: Clean Install & 42-Assertion pgTAP Suite (Database: mv_clean_test)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_clean_test;"

    Exec-Psql $ContainerName "mv_clean_test" "/test_db/fixture_state0_clean.sql"
    Exec-Psql $ContainerName "mv_clean_test" "/test_db/00_disposable_auth_fixtures.sql"
    Exec-Psql $ContainerName "mv_clean_test" "/test_db/20261102_harden_notifications_consolidated.sql"
    Exec-Psql $ContainerName "mv_clean_test" "/test_db/pgtap_suite.sql"
    Write-Host "42-Assertion core pgTAP suite executed and verified successfully." -ForegroundColor Green
    Exec-Psql $ContainerName "mv_clean_test" "/test_db/test_campaign_ingestion.sql"
    Write-Host "28-Assertion campaign ingestion pgTAP suite executed and verified successfully." -ForegroundColor Green

    # ----------------------------------------------------------------------------
    # STEP 5: Concurrency Claims & Transfer Race Isolation (Isolated DB: mv_concurrency_test)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 5: Concurrency Claims & Transfer Race (Database: mv_concurrency_test)"
    Exec-Psql-Sql $ContainerName "postgres" "CREATE DATABASE mv_concurrency_test;"

    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/fixture_state0_clean.sql"
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/00_disposable_auth_fixtures.sql"
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/20261102_harden_notifications_consolidated.sql"
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/concurrency_harness.sql"

    # Step 5B: Two Genuine Parallel Sessions with Two-Way Advisory Handshake
    Log-Step "Launching Worker 1 and Worker 2 deterministic two-way handshake background jobs..."
    $job1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session1_reservation.sql 2>&1
        [PSCustomObject]@{ Session = "Worker1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $job2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session2_reservation.sql 2>&1
        [PSCustomObject]@{ Session = "Worker2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $job1 $job2 "Reservation Concurrency Claims"

    # Verify Claims Intersection (INTERSECT == 0) and Transaction Overlap Proof
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/verify_concurrency_race.sql"
    Write-Host "Reservation claims intersection (INTERSECT == 0) and transaction overlap formally proven." -ForegroundColor Green

    # Step 5D: Token-Transfer Race with Two-Way Handshake
    Log-Step "Launching Token-Transfer Session 1 and Reservation Session 2 parallel jobs..."
    $tJob1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session1_transfer_race.sql 2>&1
        [PSCustomObject]@{ Session = "TransferSession1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $tJob2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session2_reserve_race.sql 2>&1
        [PSCustomObject]@{ Session = "ReserveSession2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $tJob1 $tJob2 "Token Transfer Race"

    # Verify Transfer Race Audit & Trigger-Driven Cancellation
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/verify_transfer_race.sql"
    Write-Host "Token-transfer trigger cancellation and zero-leakage formally proven." -ForegroundColor Green

    # Step 5E: Campaign Ingestion Idempotency Race with Transaction Locking
    Log-Step "Launching Campaign Idempotency Session 1 and Session 2 parallel jobs..."
    $cJob1 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session1_campaign_idemp.sql 2>&1
        [PSCustomObject]@{ Session = "CampaignSession1"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    $cJob2 = Start-Job -ScriptBlock {
        param($c)
        $out = docker exec $c psql -U postgres -d mv_concurrency_test -v ON_ERROR_STOP=1 -f /test_db/session2_campaign_idemp.sql 2>&1
        [PSCustomObject]@{ Session = "CampaignSession2"; ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
    } -ArgumentList $ContainerName

    Wait-And-Validate-Jobs $cJob1 $cJob2 "Campaign Idempotency Race"

    # Verify Campaign Race Audit & Single Campaign Ingestion
    Exec-Psql $ContainerName "mv_concurrency_test" "/test_db/verify_campaign_idemp_race.sql"
    Write-Host "Campaign idempotency race and zero duplicate deliveries formally proven." -ForegroundColor Green

    $SuitePassed = $true

} finally {
    # ----------------------------------------------------------------------------
    # STEP 6: Teardown & Cleanup Verification (Only Owned Container Removed)
    # ----------------------------------------------------------------------------
    Log-Header "STEP 6: Teardown & Cleanup Verification"
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
        Log-Header "FINAL VERDICT: ALL DATABASE SUITES PASSED SUCCESSFULLY (100% GREEN)"
        Write-Host "All database test suites passed and container cleanup was verified." -ForegroundColor Green
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
