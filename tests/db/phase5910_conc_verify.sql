\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    v_s1 record;
    v_s2 record;
    v_d1 record;
    v_d2 record;
    v_d3 record;
    v_d4 record;
    v_d5 record;
    v_d6 record;
    v_ca_status text;
    v_cb_status text;
    v_cc_status text;
    v_deadlocks integer := 0;
BEGIN
    -- ========================================================================
    -- Verify Test A1: Cancel holds d1, d3 while Sweep skips them and sweeps d2, d4
    -- ========================================================================
    SELECT * INTO v_s1 FROM public.p5910_conc_audit WHERE suite = 'a1_cancel_sweep' AND session_name = 's1_cancel_holder';
    SELECT * INTO v_s2 FROM public.p5910_conc_audit WHERE suite = 'a1_cancel_sweep' AND session_name = 's2_sweep';

    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'A1 requires two distinct transaction IDs';
    END IF;
    IF v_s1.deadlock_detected OR v_s2.deadlock_detected OR v_s1.sqlstate <> '00000' OR v_s2.sqlstate <> '00000' THEN
        RAISE EXCEPTION 'A1 unexpected SQLSTATE/deadlock: s1=(%, %), s2=(%, %)', v_s1.sqlstate, v_s1.deadlock_detected, v_s2.sqlstate, v_s2.deadlock_detected;
    END IF;
    IF NOT (v_s1.tx_start < v_s2.tx_end AND v_s2.tx_start < v_s1.tx_end) THEN
        RAISE EXCEPTION 'A1 transactions did NOT genuinely overlap! s1=[%..%], s2=[%..%]', v_s1.tx_start, v_s1.tx_end, v_s2.tx_start, v_s2.tx_end;
    END IF;
    IF NOT COALESCE((v_s2.metrics->>'s1_row_lock_active')::boolean, false) THEN
        RAISE EXCEPTION 'A1 S2 did not observe S1 active RowShareLock/RowExclusiveLock on notification_deliveries';
    END IF;
    IF COALESCE((v_s2.metrics->>'eligible_before')::integer, -1) <> 4 THEN
        RAISE EXCEPTION 'A1 expected eligible_before=4, got %', v_s2.metrics;
    END IF;
    IF COALESCE((v_s2.metrics->>'swept')::integer, -1) <> 2 THEN
        RAISE EXCEPTION 'A1 expected swept=2 exactly, got %', v_s2.metrics;
    END IF;
    IF COALESCE((v_s2.metrics->>'skipped_by_skip_locked')::integer, -1) <> 2 THEN
        RAISE EXCEPTION 'A1 expected skipped_by_skip_locked=2, got %', v_s2.metrics;
    END IF;
    IF COALESCE((v_s1.metrics->'cancel_result'->>'cancelled_deliveries')::integer, -1) <> 2 THEN
        RAISE EXCEPTION 'A1 expected campA cancelled_deliveries=2, got %', v_s1.metrics;
    END IF;

    SELECT delivery_status, retry_count INTO v_d1 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000001';
    SELECT delivery_status, retry_count INTO v_d2 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000002';
    SELECT delivery_status, retry_count INTO v_d3 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000003';
    SELECT delivery_status, retry_count INTO v_d4 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000004';
    SELECT status INTO v_ca_status FROM public.notification_campaigns WHERE id = '595a2000-0000-0000-0000-000000000001';
    SELECT status INTO v_cb_status FROM public.notification_campaigns WHERE id = '595a2000-0000-0000-0000-000000000002';

    IF v_d1.delivery_status <> 'cancelled' OR v_d1.retry_count <> 0 OR
       v_d3.delivery_status <> 'cancelled' OR v_d3.retry_count <> 0 THEN
        RAISE EXCEPTION 'A1 d1/d3 must be cancelled with retry_count=0: d1=(%,%), d3=(%,%)', v_d1.delivery_status, v_d1.retry_count, v_d3.delivery_status, v_d3.retry_count;
    END IF;
    IF v_d2.delivery_status <> 'pending' OR v_d2.retry_count <> 1 OR
       v_d4.delivery_status <> 'pending' OR v_d4.retry_count <> 1 THEN
        RAISE EXCEPTION 'A1 d2/d4 must be pending with retry_count=1: d2=(%,%), d4=(%,%)', v_d2.delivery_status, v_d2.retry_count, v_d4.delivery_status, v_d4.retry_count;
    END IF;
    IF v_ca_status <> 'cancelled' OR v_cb_status <> 'processing' THEN
        RAISE EXCEPTION 'A1 expected campA=cancelled campB=processing, got %, %', v_ca_status, v_cb_status;
    END IF;

    RAISE NOTICE '[PASS] 5910-A1: Genuine overlap xid=% [%..%] vs xid=% [%..%] | eligible=4, skipped=2, swept=2 | d1,d3=cancelled(r=0), d2,d4=pending(r=1) | sqlstate=00000, deadlocks=0',
        v_s1.xact_id, to_char(v_s1.tx_start, 'SS.MS'), to_char(v_s1.tx_end, 'SS.MS'),
        v_s2.xact_id, to_char(v_s2.tx_start, 'SS.MS'), to_char(v_s2.tx_end, 'SS.MS');

    -- ========================================================================
    -- Verify Test A2: S1 holds d5 FOR UPDATE while S2 cancel blocks then resolves
    -- ========================================================================
    SELECT * INTO v_s1 FROM public.p5910_conc_audit WHERE suite = 'a2_reverse_lock' AND session_name = 's1_delivery_lock_holder';
    SELECT * INTO v_s2 FROM public.p5910_conc_audit WHERE suite = 'a2_reverse_lock' AND session_name = 's2_cancel_waiter';

    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'A2 requires two distinct transaction IDs';
    END IF;
    IF v_s1.deadlock_detected OR v_s2.deadlock_detected OR v_s1.sqlstate <> '00000' OR v_s2.sqlstate <> '00000' THEN
        RAISE EXCEPTION 'A2 unexpected SQLSTATE/deadlock: s1=(%, %), s2=(%, %)', v_s1.sqlstate, v_s1.deadlock_detected, v_s2.sqlstate, v_s2.deadlock_detected;
    END IF;
    IF NOT COALESCE((v_s1.metrics->>'lock_wait_observed')::boolean, false) THEN
        RAISE EXCEPTION 'A2 did not observe S2 blocking on S1 delivery lock: %', v_s1.metrics;
    END IF;
    IF v_s2.tx_end <= v_s1.tx_end THEN
        RAISE EXCEPTION 'A2 S2 cancel must finish strictly after blocking S1 commits: s1_end=%, s2_end=%', v_s1.tx_end, v_s2.tx_end;
    END IF;
    IF COALESCE((v_s2.metrics->'cancel_result'->>'cancelled_deliveries')::integer, -1) <> 2 THEN
        RAISE EXCEPTION 'A2 expected cancelled_deliveries=2 after lock release, got %', v_s2.metrics;
    END IF;

    SELECT delivery_status, retry_count INTO v_d5 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000005';
    SELECT delivery_status, retry_count INTO v_d6 FROM public.notification_deliveries WHERE id = '595a3000-0000-0000-0000-000000000006';
    SELECT status INTO v_cc_status FROM public.notification_campaigns WHERE id = '595a2000-0000-0000-0000-000000000003';

    IF v_d5.delivery_status <> 'cancelled' OR v_d5.retry_count <> 1 OR v_d6.delivery_status <> 'cancelled' THEN
        RAISE EXCEPTION 'A2 expected d5=(cancelled,1) d6=cancelled, got d5=(%,%), d6=%', v_d5.delivery_status, v_d5.retry_count, v_d6.delivery_status;
    END IF;
    IF v_cc_status <> 'cancelled' THEN
        RAISE EXCEPTION 'A2 expected campC=cancelled, got %', v_cc_status;
    END IF;

    SELECT count(*)::integer INTO v_deadlocks FROM public.p5910_conc_audit WHERE deadlock_detected = true;

    RAISE NOTICE '[PASS] 5910-A2: Reverse lock wait proven (holder xid=% pid=%, waiter xid=% pid=%, blocked_pid=% resolved_ms=%) | cancelled=2, d5=(cancelled,r=1), d6=cancelled | sqlstate=00000, deadlocks=%',
        v_s1.xact_id, v_s1.backend_pid, v_s2.xact_id, v_s2.backend_pid,
        v_s1.metrics->>'blocked_s2_pid',
        round(extract(epoch FROM (v_s2.tx_end - v_s2.tx_start)) * 1000),
        v_deadlocks;
END $$;
SELECT suite, session_name, xact_id, backend_pid, tx_start, tx_end, sqlstate, deadlock_detected, metrics
FROM public.p5910_conc_audit
ORDER BY suite, session_name;
SELECT id AS delivery_id, campaign_id, delivery_status, retry_count, lease_token IS NULL AS lease_cleared
FROM public.notification_deliveries
WHERE id::text LIKE '595a3000%'
ORDER BY id;
SELECT id AS campaign_id, status, cancelled_at IS NOT NULL AS has_cancelled_at
FROM public.notification_campaigns
WHERE id::text LIKE '595a2000%'
ORDER BY id;
COMMIT;
