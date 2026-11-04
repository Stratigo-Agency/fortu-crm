"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/copy";

const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink";
const label = "mb-1.5 block text-base text-slate";

type Interest = "IFP" | "DSS" | "LED" | "unknown";
const INTERESTS: Interest[] = ["IFP", "DSS", "LED", "unknown"];

function Chip(props: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center rounded-sm border border-line bg-white px-3.5 text-base text-ink has-checked:border-navy has-checked:bg-navy has-checked:font-bold has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-navy">
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

export function QuickAddForm() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [interest, setInterest] = useState<Interest>("unknown");
  const [when, setWhen] = useState<"now" | "time">("now");
  const [time, setTime] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);

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
    <form className="mt-5 flex flex-col gap-5" noValidate>
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
            className={field}
          />
          {canPaste && (
            <button
              type="button"
              onClick={paste}
              className="h-12 shrink-0 rounded-sm border border-line bg-white px-5 text-base font-bold text-navy"
            >
              {t("quickAdd.paste")}
            </button>
          )}
        </div>
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
          className="w-full rounded-sm border border-input bg-white px-3 py-3 text-base text-ink"
        />
      </div>

      <fieldset>
        <legend className={label}>{t("quickAdd.interest")}</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((value) => (
            <Chip
              key={value}
              name="interest"
              value={value}
              checked={interest === value}
              onSelect={() => setInterest(value)}
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
            className={`${field} mt-3`}
          />
        )}
      </fieldset>

      <button type="submit" className="mt-2 h-13 w-full rounded-md bg-navy px-4 text-base font-bold text-white">
        {t("quickAdd.submit")}
      </button>
    </form>
  );
}
