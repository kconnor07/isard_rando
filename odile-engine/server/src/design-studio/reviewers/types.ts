import type { ReviewerId } from '@odile/shared';

export interface ReviewerDef {
  id: ReviewerId;
  label: string;
  system: string;
  focus: string;
}
