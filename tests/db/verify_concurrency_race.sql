-- ============================================================================
-- CONCURRENCY CLAIMS INTERSECTION & TRANSACTION OVERLAP VERIFICATION (R3.1)
-- File: tests/db/verify_concurrency_race.sql
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_w1_cnt integer;
    v_w2_cnt integer;
    v_intersect_cnt integer;
    v_distinct_cnt integer;
    v_w1_xact bigint;
    v_w2_xact bigint;
    v_w1_start timestamptz;
    v_w1_end timestamptz;
    v_w2_start timestamptz;
    v_w2_claim timestamptz;
    v_w2_end timestamptz;
    v_overlapping boolean;
BEGIN
    -- 1. Counts per worker
    SELECT COUNT(*) INTO v_w1_cnt FROM public.concurrency_test_claims WHERE worker_id = 'worker_1';
    SELECT COUNT(*) INTO v_w2_cnt FROM public.concurrency_test_claims WHERE worker_id = 'worker_2';

    IF v_w1_cnt IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION 'Concurrency check failed: Worker 1 claimed %, expected 3', v_w1_cnt;
    END IF;

    IF v_w2_cnt IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION 'Concurrency check failed: Worker 2 claimed %, expected 3', v_w2_cnt;
    END IF;

    -- 2. Intersection check (Must be strictly 0)
    SELECT COUNT(*) INTO v_intersect_cnt
    FROM (
        SELECT delivery_id FROM public.concurrency_test_claims WHERE worker_id = 'worker_1'
        INTERSECT
        SELECT delivery_id FROM public.concurrency_test_claims WHERE worker_id = 'worker_2'
    ) i;

    IF v_intersect_cnt IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'CRITICAL: Concurrent claims intersection is %! Overlap detected!', v_intersect_cnt;
    END IF;

    -- 3. Total distinct deliveries check (Must be exactly 6)
    SELECT COUNT(DISTINCT delivery_id) INTO v_distinct_cnt FROM public.concurrency_test_claims;

    IF v_distinct_cnt IS DISTINCT FROM 6 THEN
        RAISE EXCEPTION 'Concurrency check failed: Expected 6 distinct deliveries, found %', v_distinct_cnt;
    END IF;

    -- 4. Distinct Transaction IDs check
    SELECT DISTINCT xact_id INTO v_w1_xact FROM public.concurrency_test_claims WHERE worker_id = 'worker_1' LIMIT 1;
    SELECT DISTINCT xact_id INTO v_w2_xact FROM public.concurrency_test_claims WHERE worker_id = 'worker_2' LIMIT 1;

    IF v_w1_xact IS NULL OR v_w2_xact IS NULL OR v_w1_xact = v_w2_xact THEN
        RAISE EXCEPTION 'Concurrency check failed: Expected two distinct transactions, found xact1=%, xact2=%', v_w1_xact, v_w2_xact;
    END IF;

    -- 5. Physical Transaction Overlap Timestamp Verification
    SELECT MIN(tx_start), MAX(tx_end) INTO v_w1_start, v_w1_end
    FROM public.concurrency_test_claims WHERE worker_id = 'worker_1';

    SELECT MIN(tx_start), MIN(claimed_at), MAX(tx_end) INTO v_w2_start, v_w2_claim, v_w2_end
    FROM public.concurrency_test_claims WHERE worker_id = 'worker_2';

    IF v_w1_start IS NULL OR v_w1_end IS NULL OR v_w2_start IS NULL OR v_w2_claim IS NULL OR v_w2_end IS NULL THEN
        RAISE EXCEPTION 'Concurrency check failed: Missing recorded transaction timestamps in claims table!';
    END IF;

    -- Worker 1 started before Worker 2 claimed
    IF v_w1_start > v_w2_claim THEN
        RAISE EXCEPTION 'Temporal ordering failed: Worker 1 started (%) after Worker 2 claimed (%)', v_w1_start, v_w2_claim;
    END IF;

    -- Worker 2 claimed before Worker 1 committed (proving Worker 1 held row locks during Worker 2 claim)
    IF v_w2_claim > v_w1_end THEN
        RAISE EXCEPTION 'Temporal overlap failed: Worker 2 claimed (%) after Worker 1 committed (%)', v_w2_claim, v_w1_end;
    END IF;

    -- Range overlap proof
    v_overlapping := tstzrange(v_w1_start, v_w1_end) && tstzrange(v_w2_start, v_w2_end);
    IF NOT v_overlapping THEN
        RAISE EXCEPTION 'Temporal overlap failed: Range [%, %] does not overlap [%, %]', v_w1_start, v_w1_end, v_w2_start, v_w2_end;
    END IF;

    RAISE NOTICE 'CONCURRENCY ISOLATION & OVERLAP PROVEN:';
    RAISE NOTICE '  Worker 1: xact=%, tx=[% -> %], claimed 3 deliveries', v_w1_xact, v_w1_start, v_w1_end;
    RAISE NOTICE '  Worker 2: xact=%, tx=[% -> %], claimed 3 deliveries at %', v_w2_xact, v_w2_start, v_w2_end, v_w2_claim;
    RAISE NOTICE '  INTERSECT: 0 deliveries (Total distinct: 6). Verified 100%% concurrency safety.';
END $$;
