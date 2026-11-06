-- 013 · Discount approval: keep the approval whole, and make the CEO's "who asked" lookup fast (6 Nov 2026)

-- The notification kind 'discount_approval' came with 012. What is added here is the integrity around it.

-- An approval is a person and a time together, never one without the other.
-- Half-set pairs in old rows are cleared first, so adding the rule cannot fail on existing data.
UPDATE deals SET discount_approved_by = NULL, discount_approved_at = NULL
 WHERE (discount_approved_by IS NULL) <> (discount_approved_at IS NULL);
ALTER TABLE deals ADD CONSTRAINT deals_discount_approval_pair
  CHECK ((discount_approved_by IS NULL) = (discount_approved_at IS NULL)) NOT VALID;
ALTER TABLE deals VALIDATE CONSTRAINT deals_discount_approval_pair;

-- The sweeper and saveDeal ask "was the CEO already told about this price?" for one deal at a time.
CREATE INDEX notifications_discount_by_deal ON notifications (deal_id, user_id) WHERE kind = 'discount_approval';
