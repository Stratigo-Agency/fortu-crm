/** Reasons a deal is lost that also fit a prospect (keys of lostReason in messages/id.json; lost_reason enum). */
export const SHARED_REASONS = ["harga", "budget", "timing", "no_response", "spec", "other"] as const;

/** Spam, wrong number, job seeker: not a buyer at all. Left out of the funnel's Ditangani → Jadi deal. */
export const NOT_BUYER = "not_buyer" as const;

/** Reasons a prospect is not a fit. */
export const NOT_FIT_REASONS = ["harga", "budget", "timing", "no_response", "spec", NOT_BUYER, "other"] as const;
export type NotFitReason = (typeof NOT_FIT_REASONS)[number];
