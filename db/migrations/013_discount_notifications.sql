-- 013 · Discount approval: keep the approval whole (6 Nov 2026)

-- Nobody is notified about a discount (Pak Jovian asked for no alerts about deals, MAR-151): Laporan lists
-- what waits for approval. The file name stays so databases that already ran it are not migrated twice.

-- An approval is a person and a time together, never one without the other.
-- Half-set pairs in old rows are cleared first, so adding the rule cannot fail on existing data.
UPDATE deals SET discount_approved_by = NULL, discount_approved_at = NULL
 WHERE (discount_approved_by IS NULL) <> (discount_approved_at IS NULL);
ALTER TABLE deals ADD CONSTRAINT deals_discount_approval_pair
  CHECK ((discount_approved_by IS NULL) = (discount_approved_at IS NULL)) NOT VALID;
ALTER TABLE deals VALIDATE CONSTRAINT deals_discount_approval_pair;
