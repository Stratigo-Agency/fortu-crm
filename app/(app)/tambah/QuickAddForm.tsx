"use client";

import { Select } from "../ui/Select";
import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/copy";
import { parseCodes } from "@/lib/ingest/codes";
import { normalizePhone } from "@/lib/ingest/phone";
import type { CodeInfo, PhoneStatus } from "@/lib/quickAdd";
import { QUICK_ADD_SOURCES, type QuickAddSource } from "@/lib/quickAddSources";
import { createLead, lookupCode, lookupPhone, type QuickAddState } from "./actions";

const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";
const label = "mb-1.5 block text-sm font-medium text-slate";

type Interest = "IFP" | "DSS" | "LED" | "unknown";
const INTERESTS: Interest[] = ["IFP", "DSS", "LED", "unknown"];

/** The result of a lookup for a given input, so a stale answer is never shown for newer input. */
type Looked<T> = { key: string; value: T };

function Chip(props: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-white px-3.5 text-base text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:font-semibold has-checked:text-accent-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent">
      <input
        type="radio"
        name={props.name}
        value={props.value}
        checked={props.checked}
        onChange={props.onSelect}
        className="sr-only"
      />
      {props.children}
    </label>
  );
}

const noSubscribe = () => () => {};

const initialState: QuickAddState = { seq: 0, status: "idle" };

/** The form and its toast. Each finished save remounts the fields, which clears them. */
export function QuickAddForm() {
  const [state, formAction, pending] = useActionState(createLead, initialState);
  const [dismissed, setDismissed] = useState(0);
  const toast = state.seq > 0 && state.seq > dismissed && state.status !== "error" ? state.message : null;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setDismissed(state.seq), 4000);
    return () => clearTimeout(timer);
  }, [toast, state.seq]);

  return (
    <>
      <Fields key={state.seq} state={state} formAction={formAction} pending={pending} />
      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-4 z-20 mx-auto max-w-md rounded-md bg-ink px-4 py-3 text-white shadow-card"
        >
          {toast}
        </p>
      )}
    </>
  );
}

function Fields({
  state,
  formAction,
  pending,
}: {
  state: QuickAddState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [chosenInterest, setChosenInterest] = useState<Interest | null>(null);
  const [source, setSource] = useState<QuickAddSource>("meta_ctwa");
  const [when, setWhen] = useState<"now" | "time">("now");
  const [time, setTime] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);
  const [phoneLook, setPhoneLook] = useState<Looked<PhoneStatus | null> | null>(null);
  const [codeLook, setCodeLook] = useState<Looked<CodeInfo | null> | null>(null);

  // Codes in the message are read here while typing; the server says which ad or link they are.
  const codes = useMemo(() => parseCodes(message), [message]);
  const codesKey = codes.adCode || codes.clickCode ? JSON.stringify(codes) : "";
  useEffect(() => {
    if (!codesKey) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const value = await lookupCode(JSON.parse(codesKey)).catch(() => null);
      if (!stale) setCodeLook({ key: codesKey, value });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [codesKey]);
  const codeInfo = codeLook?.key === codesKey ? codeLook.value : null;

  // The hint under the phone field: new number or known contact.
  const phoneKey = useMemo(() => {
    try {
      return normalizePhone(phone);
    } catch {
      return "";
    }
  }, [phone]);
  useEffect(() => {
    if (!phoneKey) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const value = await lookupPhone(phoneKey).catch(() => null);
      if (!stale) setPhoneLook({ key: phoneKey, value });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [phoneKey]);
  const phoneStatus = phoneLook?.key === phoneKey ? phoneLook.value : null;

  // A code that names an ad sets the product, until the rep picks one by hand.
  const interest: Interest = chosenInterest ?? (codeInfo?.kind === "ad" ? codeInfo.productLine : "unknown");

  // After a save the fields are new again: the next number goes straight in.
  const afterSave = state.seq > 0;
  useEffect(() => {
    if (afterSave) phoneRef.current?.focus();
  }, [afterSave]);

  // The Clipboard API reads need a secure context and permission; hide Tempel where unsupported.
  const canPaste = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function",
    () => false,
  );

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setPhone(text);
    } catch {
      // permission denied: the rep types the number instead
    }
    phoneRef.current?.focus();
  }

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="phone" className={label}>
          {t("quickAdd.phone")}
        </label>
        <div className="flex gap-2">
          <input
            ref={phoneRef}
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={state.field === "phone" || undefined}
            aria-describedby={state.field === "phone" ? "phone-error" : undefined}
            className={`${field} ${state.field === "phone" ? "border-2 border-navy" : ""}`}
          />
          {canPaste && (
            <button
              type="button"
              onClick={paste}
              className="h-12 shrink-0 rounded-full border border-line bg-white px-5 text-base font-medium text-ink"
            >
              {t("quickAdd.paste")}
            </button>
          )}
        </div>
        {state.field === "phone" && (
          <p id="phone-error" role="alert" className="mt-1.5 text-sm font-semibold text-ink">
            {state.message}
          </p>
        )}
        {phoneStatus && state.field !== "phone" && (
          <p className="mt-1.5 text-sm text-slate">
            {phoneStatus.state === "new"
              ? t("quickAdd.phoneNew")
              : t("quickAdd.phoneKnown", { name: phoneStatus.name ?? phoneStatus.phone })}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="name" className={label}>
          {t("quickAdd.name")} {t("common.optional")}
        </label>
        <input
          id="name"
          name="name"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </div>

      <div>
        <label htmlFor="message" className={label}>
          {t("quickAdd.message")}
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-sm border border-input bg-white px-3 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </div>

      {codeInfo ? (
        <div className="rounded-md border border-line bg-paper px-4 py-3">
          <p className="font-semibold text-ink">
            {codeInfo.kind === "ad" ? t("quickAdd.fromAd", { ad: codeInfo.adName }) : t("quickAdd.fromLink")}
          </p>
          <p className="text-slate">{t("quickAdd.fromAdHint")}</p>
        </div>
      ) : (
        <div>
          <label htmlFor="source" className={label}>
            {t("quickAdd.source")}
          </label>
          <Select
            id="source"
            name="source"
            value={source}
            onChange={(v) => setSource(v as QuickAddSource)}
            options={QUICK_ADD_SOURCES.map((value) => ({ value, label: t(`sourceChannel.${value}`) }))}
          />
        </div>
      )}

      <fieldset>
        <legend className={label}>{t("quickAdd.interest")}</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((value) => (
            <Chip
              key={value}
              name="interest"
              value={value}
              checked={interest === value}
              onSelect={() => setChosenInterest(value)}
            >
              {t(`productLine.${value}`)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={label}>{t("quickAdd.receivedAt")}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip name="when" value="now" checked={when === "now"} onSelect={() => setWhen("now")}>
            {t("quickAdd.justNow")}
          </Chip>
          <Chip name="when" value="time" checked={when === "time"} onSelect={() => setWhen("time")}>
            {t("quickAdd.pickTime")}
          </Chip>
        </div>
        {when === "time" && (
          <input
            type="time"
            name="time"
            aria-label={t("quickAdd.pickTime")}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-invalid={state.field === "receivedAt" || undefined}
            aria-describedby={state.field === "receivedAt" ? "time-error" : undefined}
            className={`${field} mt-3`}
          />
        )}
        {state.field === "receivedAt" && (
          <p id="time-error" role="alert" className="mt-1.5 text-sm font-semibold text-ink">
            {state.message}
          </p>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-13 w-full rounded-full bg-ink px-4 text-base font-semibold text-white hover:bg-ink/85 disabled:opacity-60"
      >
        {t("quickAdd.submit")}
      </button>
      {state.field === "form" && (
        <p role="alert" className="text-center font-semibold text-ink">
          {state.message}
        </p>
      )}
    </form>
  );
}
