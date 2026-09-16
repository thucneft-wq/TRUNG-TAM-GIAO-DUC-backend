import type { FeedbackRepositoryPort } from '../repositories/feedbackRepository.js';
import type {
  FeedbackSyncResult,
  GoogleSheetsFeedbackInput,
} from '../types/googleSheets.js';
import type { FeedbackServicePort } from '../types/services.js';
import { AppError } from '../utils/appError.js';

const sentimentFromRating = (rating: number): 'positive' | 'neutral' | 'negative' => {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
};

export class FeedbackService implements FeedbackServicePort {
  constructor(private readonly repository: FeedbackRepositoryPort) {}

  async syncFromGoogleSheets(
    input: GoogleSheetsFeedbackInput,
  ): Promise<FeedbackSyncResult> {
    const result = await this.repository.syncFromGoogleSheets({
      ...input,
      category: input.category?.trim() || sentimentFromRating(input.rating),
      comment: input.comment?.trim() || null,
    });
    if (!result) {
      throw new AppError(
        404,
        'The counseling session for this feedback was not found.',
        'FEEDBACK_SESSION_NOT_FOUND',
      );
    }
    return result;
  }
}
