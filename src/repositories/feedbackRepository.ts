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
        ORDER BY
          CASE WHEN $1::UUID IS NOT NULL AND s.session_id = $1::UUID THEN 0 ELSE 1 END,
          s.created_at DESC
        LIMIT 1
      `, [input.sessionId ?? null, input.bookingId ?? null]);
      const session = resolved.rows[0];
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
