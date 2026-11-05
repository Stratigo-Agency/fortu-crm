"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { t } from "@/lib/copy";
import { NOT_FIT_REASONS } from "@/lib/leadReasons";
import {
  type LeadActionState,
  markContactedAction,
  markNotFitAction,
  reassignLeadAction,
} from "./actions";

type Owner = { id: string; full_name: string };
type Props = {
  leadId: string;
  name: string;
  isNew: boolean;
  /** sales_lead, ceo and admin only */
  canReassign: boolean;
  currentOwnerId: string | null;
  owners: Owner[];
};

const initial: LeadActionState = { seq: 0 };
const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/40";
const item = "flex min-h-11 w-full items-center rounded-sm px-3 text-left text-ink hover:bg-paper";

/** The ⋯ menu of a prospect row: contacted, not a fit (with a reason) and reassign. */
export function LeadActions({ leadId, name, isNew, canReassign, currentOwnerId, owners }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const notFit = useRef<HTMLDialogElement>(null);
  const reassign = useRef<HTMLDialogElement>(null);
  const [contactedState, contactedAction] = useActionState(markContactedAction, initial);

  // The menu closes on a click elsewhere or Escape.
  useEffect(() => {
    function close(e: Event) {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    }
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  function open(dialog: React.RefObject<HTMLDialogElement | null>) {
    if (menu.current) menu.current.open = false;
    dialog.current?.showModal();
  }

  return (
    <>
      <details ref={menu} className="relative">
        <summary
          aria-label={t("prospek.moreActions", { name })}
          className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-sm text-slate hover:bg-paper desk:h-10 desk:w-10 [&::-webkit-details-marker]:hidden"
        >
          <svg width="18" height="4" viewBox="0 0 18 4" fill="currentColor" aria-hidden="true">
            <circle cx="2" cy="2" r="1.6" />
            <circle cx="9" cy="2" r="1.6" />
            <circle cx="16" cy="2" r="1.6" />
          </svg>
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-60 rounded-md bg-white p-1 shadow-card ring-1 ring-line">
          {isNew && (
            <form action={contactedAction} onSubmit={() => setTimeout(() => menu.current?.removeAttribute("open"), 0)}>
              <input type="hidden" name="leadId" value={leadId} />
              <button type="submit" className={item}>
                {t("prospek.markContacted")}
              </button>
            </form>
          )}
          <button type="button" className={item} onClick={() => open(notFit)}>
            {t("prospek.notFit")}
          </button>
          {canReassign && (
            <button type="button" className={item} onClick={() => open(reassign)}>
              {t("common.reassign")}
            </button>
          )}
        </div>
      </details>
      {contactedState.error && (
        <p role="alert" className="basis-full text-sm font-semibold text-ink">
          {contactedState.error}
        </p>
      )}

      <NotFitDialog dialog={notFit} leadId={leadId} />
      {canReassign && (
        <ReassignDialog dialog={reassign} leadId={leadId} currentOwnerId={currentOwnerId} owners={owners} />
      )}
    </>
  );
}

function Dialog({
  dialog,
  title,
  state,
  children,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  title: string;
  state: LeadActionState;
  children: React.ReactNode;
}) {
  // A finished action closes the dialog.
  useEffect(() => {
    if (state.seq > 0) dialog.current?.close();
  }, [state.seq, dialog]);

  // An error is shown until the dialog is closed; a new attempt brings a new state, so it shows again.
  const [seen, setSeen] = useState<LeadActionState | null>(null);
  const error = state !== seen ? state.error : undefined;

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={() => setSeen(state)}
      className="m-auto w-[min(92vw,28rem)] rounded-lg bg-white p-6 text-ink shadow-card backdrop:bg-ink/40"
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">
        {children}
        {error && (
          <p role="alert" className="font-semibold">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="h-11 rounded-full border border-line bg-white px-5 text-base text-ink hover:bg-paper desk:h-9"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" className="h-11 rounded-full bg-ink px-5 text-base font-semibold text-white hover:bg-ink/85 desk:h-9">
            {t("common.save")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function NotFitDialog({ dialog, leadId }: { dialog: React.RefObject<HTMLDialogElement | null>; leadId: string }) {
  const [state, action] = useActionState(markNotFitAction, initial);
  return (
    <form action={action}>
      <Dialog dialog={dialog} title={t("prospek.notFitTitle")} state={state}>
        <input type="hidden" name="leadId" value={leadId} />
        <select
          name="reason"
          aria-label={t("prospek.notFitTitle")}
          defaultValue=""
          required
          className={field}
        >
          <option value="" disabled />
          {NOT_FIT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`lostReason.${reason}`)}
            </option>
          ))}
        </select>
        <label className="flex flex-col gap-1.5 text-slate">
          {t("lostReason.note")} {t("common.optional")}
          <textarea
            name="note"
            rows={3}
            maxLength={1000}
            className="w-full rounded-sm border border-input bg-white px-3 py-3 text-base text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/40"
          />
        </label>
      </Dialog>
    </form>
  );
}

function ReassignDialog({
  dialog,
  leadId,
  currentOwnerId,
  owners,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  leadId: string;
  currentOwnerId: string | null;
  owners: Owner[];
}) {
  const [state, action] = useActionState(reassignLeadAction, initial);
  return (
    <form action={action}>
      <Dialog dialog={dialog} title={t("prospek.reassignTo")} state={state}>
        <input type="hidden" name="leadId" value={leadId} />
        <select
          name="ownerId"
          aria-label={t("common.sales")}
          defaultValue={currentOwnerId ?? ""}
          required
          className={field}
        >
          <option value="" disabled />
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name}
            </option>
          ))}
        </select>
      </Dialog>
    </form>
  );
}
