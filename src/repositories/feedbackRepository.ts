import type { Pool } from 'pg';
import type {
  FeedbackSyncResult,
  GoogleSheetsFeedbackInput,
} from '../types/googleSheets.js';

interface ResolvedSessionRow {
  session_id: string;
  booking_id: string;
  student_id: string;
  counselor_id: string;
}

interface FeedbackRow {
  feedback_id: string;
  session_id: string;
  booking_id: string;
  student_id: string;
  counselor_id: string;
  rating: number;
  category: string | null;
  created_at: Date | string;
}

export interface FeedbackRepositoryPort {
  syncFromGoogleSheets(
    input: GoogleSheetsFeedbackInput,
  ): Promise<FeedbackSyncResult | null>;
}

export class PgFeedbackRepository implements FeedbackRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async syncFromGoogleSheets(
    input: GoogleSheetsFeedbackInput,
  ): Promise<FeedbackSyncResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resolved = await client.query<ResolvedSessionRow>(`
        SELECT
          s.session_id,
          b.booking_id,
          b.student_id,
          b.counselor_id
        FROM Sessions s
        JOIN Bookings b ON b.booking_id = s.booking_id
        WHERE ($1::UUID IS NOT NULL AND s.session_id = $1::UUID)
           OR ($2::UUID IS NOT NULL AND b.booking_id = $2::UUID)
           OR ($3::VARCHAR IS NOT NULL AND UPPER(s.external_session_id) = UPPER($3::VARCHAR))
           OR ($4::VARCHAR IS NOT NULL AND UPPER(b.external_booking_id) = UPPER($4::VARCHAR))
        ORDER BY
          CASE WHEN $1::UUID IS NOT NULL AND s.session_id = $1::UUID THEN 0 ELSE 1 END,
          s.created_at DESC
        LIMIT 1
      `, [
        input.sessionId ?? null,
        input.bookingId ?? null,
        input.externalSessionId ?? null,
        input.externalBookingId ?? null,
      ]);
      let session = resolved.rows[0];
      if (!session && input.externalBookingId) {
        const people = await client.query<{ student_id: string; counselor_id: string }>(`
          SELECT s.student_id, c.counselor_id
          FROM Students s
          CROSS JOIN Counselors c
          WHERE UPPER(s.external_student_id) = UPPER($1::VARCHAR)
            AND UPPER(c.external_counselor_id) = UPPER($2::VARCHAR)
          LIMIT 1
        `, [input.externalStudentId ?? null, input.externalCounselorId ?? null]);
        if (people.rows[0]) {
          const booking = await client.query<{ booking_id: string }>(`
            INSERT INTO Bookings (
              external_booking_id, start_time, end_time, booking_source, status,
              student_id, counselor_id, updated_at
            )
            VALUES ($1::VARCHAR, $2::TIMESTAMPTZ, $3::TIMESTAMPTZ, 'google_sheets',
              COALESCE($4::VARCHAR, 'COMPLETED'), $5::UUID, $6::UUID, now())
            ON CONFLICT (UPPER(external_booking_id)) WHERE external_booking_id IS NOT NULL
            DO UPDATE SET
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              status = EXCLUDED.status,
              student_id = EXCLUDED.student_id,
              counselor_id = EXCLUDED.counselor_id,
              updated_at = now()
            RETURNING booking_id
          `, [
            input.externalBookingId,
            input.bookingStartTime,
            input.bookingEndTime,
            input.bookingStatus ?? null,
            people.rows[0].student_id,
            people.rows[0].counselor_id,
          ]);
          const externalSessionId = input.externalSessionId ?? `${input.externalBookingId}-SESSION`;
          const createdSession = await client.query<{ session_id: string }>(`
            INSERT INTO Sessions (
              external_session_id, session_name, session_type, booking_id,
              started_at, ended_at, status
            )
            VALUES (
              $1::VARCHAR, $2::VARCHAR, 'counseling', $3::UUID,
              $4::TIMESTAMPTZ, $5::TIMESTAMPTZ, COALESCE($6::VARCHAR, 'COMPLETED')
            )
            ON CONFLICT (UPPER(external_session_id)) WHERE external_session_id IS NOT NULL
            DO UPDATE SET
              booking_id = EXCLUDED.booking_id,
              started_at = EXCLUDED.started_at,
              ended_at = EXCLUDED.ended_at,
              status = EXCLUDED.status
            RETURNING session_id
          `, [
            externalSessionId,
            `Google Sheets ${input.externalBookingId}`,
            booking.rows[0].booking_id,
            input.sessionStartedAt ?? null,
            input.sessionEndedAt ?? null,
            input.sessionStatus ?? input.bookingStatus ?? null,
          ]);
          session = {
            session_id: createdSession.rows[0].session_id,
            booking_id: booking.rows[0].booking_id,
            student_id: people.rows[0].student_id,
            counselor_id: people.rows[0].counselor_id,
          };
        }
      }
      if (!session) {
        await client.query('ROLLBACK');
        return null;
      }

      // A Sheet edit and form-submit trigger can arrive together. Serializing by
      // session keeps the logical one-feedback-per-session upsert idempotent.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::TEXT))',
        [session.session_id],
      );
      const existing = await client.query<{ feedback_id: string }>(`
        SELECT feedback_id
        FROM Feedbacks
        WHERE ($1::UUID IS NOT NULL AND feedback_id = $1::UUID)
           OR ($1::UUID IS NULL AND session_id = $2::UUID)
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [input.feedbackId ?? null, session.session_id]);

      const existingId = existing.rows[0]?.feedback_id;
      let row: FeedbackRow;
      let created: boolean;
      if (existingId) {
        const updated = await client.query<FeedbackRow>(`
          UPDATE Feedbacks f
          SET
            student_id = $2::UUID,
            session_id = $3::UUID,
            counselor_id = $4::UUID,
            rating = $5::INT,
            comment = $6::TEXT,
            category = $7::VARCHAR,
            created_at = COALESCE($8::TIMESTAMPTZ, f.created_at)
          WHERE f.feedback_id = $1::UUID
          RETURNING
            f.feedback_id,
            f.session_id,
            $9::UUID AS booking_id,
            f.student_id,
            f.counselor_id,
            f.rating,
            f.category,
            f.created_at
        `, [
          existingId,
          session.student_id,
          session.session_id,
          session.counselor_id,
          input.rating,
          input.comment ?? null,
          input.category ?? null,
          input.createdAt ?? null,
          session.booking_id,
        ]);
        row = updated.rows[0];
        created = false;
      } else {
        const inserted = await client.query<FeedbackRow>(`
          INSERT INTO Feedbacks (
            feedback_id,
            student_id,
            session_id,
            counselor_id,
            rating,
            comment,
            category,
            created_at
          )
          VALUES (
            COALESCE($1::UUID, gen_random_uuid()),
            $2::UUID,
            $3::UUID,
            $4::UUID,
            $5::INT,
            $6::TEXT,
            $7::VARCHAR,
            COALESCE($8::TIMESTAMPTZ, now())
          )
          RETURNING
            feedback_id,
            session_id,
            $9::UUID AS booking_id,
            student_id,
            counselor_id,
            rating,
            category,
            created_at
        `, [
          input.feedbackId ?? null,
          session.student_id,
          session.session_id,
          session.counselor_id,
          input.rating,
          input.comment ?? null,
          input.category ?? null,
          input.createdAt ?? null,
          session.booking_id,
        ]);
        row = inserted.rows[0];
        created = true;
      }

      await client.query('COMMIT');
      return {
        feedbackId: row.feedback_id,
        sessionId: row.session_id,
        bookingId: row.booking_id,
        studentId: row.student_id,
        counselorId: row.counselor_id,
        rating: row.rating,
        category: row.category,
        createdAt: new Date(row.created_at).toISOString(),
        created,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
