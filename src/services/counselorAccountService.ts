import bcrypt from 'bcrypt';
import type { CounselorAccountRepositoryPort } from '../repositories/counselorAccountRepository.js';
import type {
  CounselorAccountSyncResult,
  GoogleSheetsCounselorAccountInput,
} from '../types/googleSheets.js';
import type { CounselorAccountServicePort } from '../types/services.js';

export class CounselorAccountService implements CounselorAccountServicePort {
  constructor(private readonly repository: CounselorAccountRepositoryPort) {}

  async syncFromGoogleSheets(
    input: GoogleSheetsCounselorAccountInput,
  ): Promise<CounselorAccountSyncResult> {
    const resolvedPasswordHash = input.password
      ? await bcrypt.hash(input.password, 10)
      : input.passwordHash;
    return this.repository.syncFromGoogleSheets(input, resolvedPasswordHash);
  }
}
