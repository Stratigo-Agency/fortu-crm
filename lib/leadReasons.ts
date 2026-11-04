/** Reasons a prospect is not a fit (keys of lostReason in messages/id.json). */
export const NOT_FIT_REASONS = ["harga", "budget", "timing", "no_response", "spec", "other"] as const;
export type NotFitReason = (typeof NOT_FIT_REASONS)[number];
