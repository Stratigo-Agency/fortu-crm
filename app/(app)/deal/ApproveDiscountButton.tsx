"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/copy";
import { approveDiscountAction } from "./actions";

/** "Setujui diskon" for the CEO and admins: on the deal and in Laporan · Perlu perhatian. */
export function ApproveDiscountButton({ dealId, dealName }: { dealId: string; dealName?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setPending(true);
    setError(null);
    const r = await approveDiscountAction(dealId);
    setPending(false);
    if (r.ok) router.refresh();
    else setError(r.message);
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        aria-label={dealName ? t("deal.approveDiscountFor", { deal: dealName }) : undefined}
        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-4 text-base font-medium text-ink hover:bg-paper disabled:opacity-60 desk:h-9"
      >
        <Check size={16} aria-hidden="true" />
        {t("deal.approveDiscount")}
      </button>
      {error && (
        <span role="alert" className="text-sm text-late">
          {error}
        </span>
      )}
    </span>
  );
}
