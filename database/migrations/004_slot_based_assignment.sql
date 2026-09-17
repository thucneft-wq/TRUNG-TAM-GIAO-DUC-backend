-- Assign a Student only after a valid booking/slot exists.
-- Among active Counselors available in the selected time range, prefer the
-- Counselor with the fewest other active Students.
CREATE OR REPLACE FUNCTION reconcile_student_assignment_from_booking(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id UUID;
  v_requested_slot_id UUID;
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_counselor_id UUID;
  v_slot_id UUID;
  v_current_counselor_id UUID;
  v_assignment_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::TEXT));

  IF NOT EXISTS (
    SELECT 1 FROM Students
    WHERE student_id = p_student_id AND UPPER(status) = 'ACTIVE'
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT b.booking_id,
         b.availability_slot_id,
         COALESCE(requested_slot.start_time, b.start_time),
         COALESCE(requested_slot.end_time, b.end_time)
  INTO v_booking_id, v_requested_slot_id, v_start_time, v_end_time
  FROM Bookings b
  LEFT JOIN Availability_Slots requested_slot
    ON requested_slot.availability_slot_id = b.availability_slot_id
  WHERE b.student_id = p_student_id
    AND UPPER(b.status) IN ('PENDING', 'CONFIRMED', 'BOOKED', 'SCHEDULED', 'ACTIVE')
    AND b.cancelled_at IS NULL
  ORDER BY b.created_at DESC, b.booking_id DESC
  LIMIT 1;

  IF v_booking_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT a.counselor_id, a.availability_slot_id
  INTO v_counselor_id, v_slot_id
  FROM Availability_Slots a
  JOIN Counselors c ON c.counselor_id = a.counselor_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS active_cases
    FROM Counselor_Assignment_Records car
    JOIN Counselor_Assignments ca ON ca.assignment_id = car.assignment_id
    WHERE car.counselor_id = c.counselor_id
      AND ca.student_id <> p_student_id
      AND UPPER(car.status) = 'ACTIVE'
      AND car.ended_at IS NULL
      AND UPPER(ca.status) = 'ACTIVE'
  ) load ON TRUE
  WHERE a.start_time = v_start_time
    AND a.end_time = v_end_time
    AND UPPER(c.status) = 'ACTIVE'
    AND c.external_counselor_id IS NOT NULL
    AND (
      UPPER(a.status) IN ('OPEN', 'AVAILABLE', 'ACTIVE')
      OR a.availability_slot_id = v_requested_slot_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM Bookings occupied
      WHERE occupied.booking_id <> v_booking_id
        AND occupied.counselor_id = a.counselor_id
        AND occupied.start_time < v_end_time
        AND occupied.end_time > v_start_time
        AND occupied.cancelled_at IS NULL
        AND UPPER(occupied.status) IN ('PENDING', 'CONFIRMED', 'BOOKED', 'SCHEDULED', 'ACTIVE')
    )
  ORDER BY COALESCE(load.active_cases, 0), c.created_at, c.counselor_id
  LIMIT 1
  FOR UPDATE OF a SKIP LOCKED;

  IF v_counselor_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT car.counselor_id
  INTO v_current_counselor_id
  FROM Counselor_Assignments ca
  JOIN Counselor_Assignment_Records car ON car.assignment_id = ca.assignment_id
  WHERE ca.student_id = p_student_id
    AND UPPER(ca.status) = 'ACTIVE'
    AND UPPER(car.status) = 'ACTIVE'
    AND car.ended_at IS NULL
  ORDER BY car.assigned_at DESC
  LIMIT 1;

  UPDATE Bookings
  SET counselor_id = v_counselor_id,
      availability_slot_id = v_slot_id,
      updated_at = now()
  WHERE booking_id = v_booking_id
    AND (
      counselor_id IS DISTINCT FROM v_counselor_id
      OR availability_slot_id IS DISTINCT FROM v_slot_id
    );

  IF v_current_counselor_id = v_counselor_id THEN
    RETURN FALSE;
  END IF;

  UPDATE Counselor_Assignment_Records car
  SET status = 'INACTIVE', ended_at = COALESCE(car.ended_at, now()), updated_at = now()
  FROM Counselor_Assignments ca
  WHERE ca.assignment_id = car.assignment_id
    AND ca.student_id = p_student_id
    AND UPPER(car.status) = 'ACTIVE'
    AND car.ended_at IS NULL;

  UPDATE Counselor_Assignments
  SET status = 'INACTIVE', updated_at = now()
  WHERE student_id = p_student_id AND UPPER(status) = 'ACTIVE';

  INSERT INTO Counselor_Assignments (student_id, status)
  VALUES (p_student_id, 'ACTIVE')
  RETURNING assignment_id INTO v_assignment_id;

  INSERT INTO Counselor_Assignment_Records (
    assignment_id, counselor_id, status, assigned_at, case_weight
  )
  VALUES (v_assignment_id, v_counselor_id, 'ACTIVE', now(), 1);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_reconcile_student_assignment_from_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF UPPER(NEW.status) IN ('PENDING', 'CONFIRMED', 'BOOKED', 'SCHEDULED', 'ACTIVE') THEN
    PERFORM reconcile_student_assignment_from_booking(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_reconcile_student_assignment ON Bookings;
CREATE TRIGGER trg_booking_reconcile_student_assignment
AFTER INSERT OR UPDATE OF status, availability_slot_id, start_time, end_time
ON Bookings
FOR EACH ROW
EXECUTE FUNCTION trigger_reconcile_student_assignment_from_booking();
