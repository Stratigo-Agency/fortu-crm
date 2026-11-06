"use client";

import { useActionState } from "react";
import { t } from "@/lib/copy";
import { secondaryButton } from "../../PageHeader";
import { revokeConsentAction, saveLineTextAction } from "./actions";

/** Per line: keep message text or not, and withdraw consent. */
export function LineTextForm({ lineId, storeText, label }: { lineId: string; storeText: boolean; label: string }) {
  const [result, action, pending] = useActionState(saveLineTextAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="lineId" value={lineId} />
      <label className="flex min-h-11 cursor-pointer items-center gap-2 desk:min-h-0">
        <input type="checkbox" name="storeText" defaultChecked={storeText} className="check" aria-label={`${t("whatsapp.storeText")} ${label}`} />
        <span className="text-slate">{t("whatsapp.storeText")}</span>
      </label>
      <button type="submit" disabled={pending} className={secondaryButton}>{t("whatsapp.saveText")}</button>
      {result && <span role={result.ok ? "status" : "alert"} className="text-sm text-slate">{result.message}</span>}
    </form>
  );
}

/** Withdraw consent; the line under the button says what happens. */
export function RevokeForm({ lineId }: { lineId: string }) {
  const [result, action, pending] = useActionState(revokeConsentAction, null);
  const hintId = `revoke-hint-${lineId}`;
  return (
    <form action={action} className="flex max-w-60 flex-col items-start gap-1.5">
      <input type="hidden" name="lineId" value={lineId} />
      <button type="submit" disabled={pending} aria-describedby={hintId} className={secondaryButton}>{t("whatsapp.revoke")}</button>
      <span id={hintId} className="text-sm text-faint">{t("whatsapp.revokeHint")}</span>
      {result && <span role={result.ok ? "status" : "alert"} className="text-sm text-slate">{result.message}</span>}
    </form>
  );
}
