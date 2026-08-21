import type { Pool, PoolClient } from 'pg';
import type { AuthAccount, AuthAccountRepositoryPort } from '../services/authService.js';
import type {
  CounselorAccountSyncResult,
  GoogleSheetsCounselorAccountInput,
} from '../types/googleSheets.js';
import { AppError } from '../utils/appError.js';

export interface CounselorAccountRepositoryPort {
  syncFromGoogleSheets(
    input: GoogleSheetsCounselorAccountInput,
    resolvedPasswordHash?: string,
  ): Promise<CounselorAccountSyncResult>;
}

interface ExistingUserRow {
  user_id: string;
  password_hash: string;
}

const findCounselor = async (
  client: PoolClient,
  counselorId: string | undefined,
  counselorEmail: string,
): Promise<string> => {
  const result = await client.query<{ counselor_id: string }>(`
    SELECT counselor_id
    FROM Counselors
    WHERE ($1::UUID IS NOT NULL AND counselor_id = $1::UUID)
       OR ($1::UUID IS NULL AND LOWER(email) = LOWER($2::VARCHAR))
    ORDER BY CASE WHEN counselor_id = $1::UUID THEN 0 ELSE 1 END
    LIMIT 1
    FOR UPDATE
  `, [counselorId ?? null, counselorEmail]);
  const id = result.rows[0]?.counselor_id;
  if (!id) {
    throw new AppError(
      404,
      'Counselor account could not be linked. Add the Counselor profile first or use a matching email.',
      'COUNSELOR_NOT_FOUND',
    );
  }
  return id;
};

export class PgCounselorAccountRepository
implements AuthAccountRepositoryPort, CounselorAccountRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findCounselorByEmail(email: string): Promise<AuthAccount | null> {
    const result = await this.pool.query<AuthAccount & { password_hash: string }>(`
      SELECT
        c.counselor_id AS id,
        CONCAT_WS(' ', c.first_name, c.last_name) AS name,
        u.email,
        u.password_hash AS "passwordHash",
        'counselor'::TEXT AS role
      FROM Users u
      JOIN User_Profiles up ON up.user_id = u.user_id
      JOIN Counselors c ON c.counselor_id = up.counselor_id
      JOIN User_Roles ur ON ur.user_id = u.user_id
      JOIN Roles r ON r.role_id = ur.role_id
      WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM($1::VARCHAR))
        AND UPPER(u.status) = 'ACTIVE'
        AND UPPER(c.status) = 'ACTIVE'
        AND UPPER(r.role_code) = 'COUNSELOR'
        AND r.is_active = TRUE
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
      LIMIT 1
    `, [email]);
    return result.rows[0] ?? null;
  }

  async syncFromGoogleSheets(
    input: GoogleSheetsCounselorAccountInput,
    resolvedPasswordHash?: string,
  ): Promise<CounselorAccountSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const counselorId = await findCounselor(
        client,
        input.counselorId,
        input.counselorEmail ?? input.email,
      );

      const linked = await client.query<ExistingUserRow>(`
        SELECT u.user_id, u.password_hash
        FROM User_Profiles up
        JOIN Users u ON u.user_id = up.user_id
        WHERE up.counselor_id = $1::UUID
        LIMIT 1
        FOR UPDATE OF u
      `, [counselorId]);
      let existing = linked.rows[0];

      if (!existing && input.userId) {
        const byId = await client.query<ExistingUserRow>(`
          SELECT user_id, password_hash FROM Users WHERE user_id = $1::UUID FOR UPDATE
        `, [input.userId]);
        existing = byId.rows[0];
      }
      if (!existing) {
        const byEmail = await client.query<ExistingUserRow>(`
          SELECT user_id, password_hash
          FROM Users
          WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1::VARCHAR))
          LIMIT 1
          FOR UPDATE
        `, [input.email]);
        existing = byEmail.rows[0];
      }

      let userId: string;
      let created = false;
      if (existing) {
        userId = existing.user_id;
        await client.query(`
          UPDATE Users
          SET email = $2,
              password_hash = CASE WHEN $3::TEXT IS NULL THEN password_hash ELSE $3::TEXT END,
              status = $4,
              email_verified_at = CASE WHEN $4 = 'ACTIVE' THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END,
              password_changed_at = CASE WHEN $3::TEXT IS NULL THEN password_changed_at ELSE now() END,
              updated_at = now()
          WHERE user_id = $1::UUID
        `, [userId, input.email.toLowerCase(), resolvedPasswordHash ?? null, input.status]);
      } else {
        if (!resolvedPasswordHash) {
          throw new AppError(
            422,
            'A password or bcrypt password_hash is required for a new Counselor account.',
            'ACCOUNT_PASSWORD_REQUIRED',
          );
        }
        const inserted = await client.query<{ user_id: string }>(`
          INSERT INTO Users (
            user_id, email, password_hash, status, email_verified_at
          )
          VALUES (
            COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4,
            CASE WHEN $4 = 'ACTIVE' THEN now() ELSE NULL END
          )
          RETURNING user_id
        `, [input.userId ?? null, input.email.toLowerCase(), resolvedPasswordHash, input.status]);
        userId = inserted.rows[0].user_id;
        created = true;
      }

      const currentProfile = await client.query<{ counselor_id: string | null }>(`
        SELECT counselor_id FROM User_Profiles WHERE user_id = $1::UUID FOR UPDATE
      `, [userId]);
      const linkedCounselorId = currentProfile.rows[0]?.counselor_id;
      if (linkedCounselorId && linkedCounselorId !== counselorId) {
        throw new AppError(
          409,
          'This account is already linked to another profile.',
          'ACCOUNT_PROFILE_CONFLICT',
        );
      }
      if (currentProfile.rowCount === 0) {
        await client.query(`
          INSERT INTO User_Profiles (user_id, counselor_id)
          VALUES ($1::UUID, $2::UUID)
        `, [userId, counselorId]);
      }

      const role = await client.query<{ role_id: string }>(`
        SELECT role_id FROM Roles
        WHERE UPPER(role_code) = 'COUNSELOR' AND is_active = TRUE
        LIMIT 1
      `);
      if (!role.rows[0]) {
        throw new AppError(503, 'COUNSELOR role is not configured.', 'COUNSELOR_ROLE_MISSING');
      }
      await client.query(`
        INSERT INTO User_Roles (user_id, role_id)
        VALUES ($1::UUID, $2::UUID)
        ON CONFLICT (user_id, role_id) DO UPDATE
        SET expires_at = NULL, assigned_at = now()
      `, [userId, role.rows[0].role_id]);

      await client.query('COMMIT');
      return {
        userId,
        counselorId,
        email: input.email.toLowerCase(),
        status: input.status,
        created,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'Email or profile link already exists.', 'ACCOUNT_CONFLICT');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
