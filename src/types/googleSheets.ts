import type { CreateCounselorInput } from './counselor.js';

export type GoogleSheetsCounselorInput = CreateCounselorInput & {
  counselorId?: string;
};

export type CounselorAccountStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'LOCKED'
  | 'SUSPENDED'
  | 'DISABLED';

export interface GoogleSheetsCounselorAccountInput {
  userId?: string;
  counselorId?: string;
  counselorEmail?: string;
  email: string;
  password?: string;
  passwordHash?: string;
  status: CounselorAccountStatus;
}

export interface CounselorAccountSyncResult {
  userId: string;
  counselorId: string;
  email: string;
  status: CounselorAccountStatus;
  created: boolean;
}
