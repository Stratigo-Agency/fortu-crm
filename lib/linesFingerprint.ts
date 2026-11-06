import { sql } from "@/lib/db";

/**
 * A short fingerprint of a deal's product lines (product, quantity, unit price), computed in SQL.
 * `dealIdColumn` is a column of the outer query, for example "d.id". The CEO's approval names the prices it
 * is about with it, so a price saved in between is never approved unseen.
 */
export const linesFingerprint = (dealIdColumn: string) => sql`
  (SELECT md5(COALESCE(string_agg(li.product_id::text || ':' || li.qty::text || ':' || li.unit_price::bigint::text, '|'
                                  ORDER BY li.product_id, li.qty, li.unit_price), ''))
     FROM deal_line_items li WHERE li.deal_id = ${sql(dealIdColumn)})`;
