"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/copy";
import { Select } from "../../ui/Select";
import { inputCls, labelCls } from "../formStyles";
import { connectWhatsAppAction } from "./actions";

// "Sambungkan nomor": Meta's Embedded Signup for WhatsApp Business app numbers (Coexistence).
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
// The SDK loads on this page only (its CSP allows connect.facebook.net, lib/securityHeaders.ts). The popup returns a
// code that lives 30 seconds; it goes straight to the Server Action, which swaps it for a token on the server.

type FbLoginResponse = { authResponse?: { code?: string } | null };
type Fb = {
  init(o: Record<string, unknown>): void;
  login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: Fb;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

function isFacebook(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

type Props = { appId: string; configId: string; graphVersion: string; reps: { id: string; name: string }[] };

export function ConnectWhatsApp({ appId, configId, graphVersion, reps }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [consentBy, setConsentBy] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const signup = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // Load the SDK when the page opens, so the click opens Meta's popup at once (a popup must follow a click).
  useEffect(() => {
    if (window.FB) {
      // loaded on an earlier visit
      void Promise.resolve().then(() => setReady(true));
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setReady(true);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => setResult({ ok: false, message: t("whatsapp.sdkFailed") });
    document.body.appendChild(script);
  }, [appId, graphVersion]);

  // Meta's signup window tells us which WhatsApp account and number were shared.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebook(event.origin) || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event?.startsWith("FINISH")) {
          signup.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        } else if (data.event === "CANCEL") {
          setResult({ ok: false, message: t("whatsapp.cancelled") });
        }
      } catch {
        // not JSON: another Facebook message
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function finish(code: string) {
    // the signup event usually comes just before the code; give it a moment
    for (let i = 0; i < 10 && !signup.current.wabaId; i++) await new Promise((r) => setTimeout(r, 150));
    const r = await connectWhatsAppAction({ code, ...signup.current, ownerId, consentBy, consent: agreed });
    setResult(r);
    setBusy(false);
    if (r.ok) router.refresh();
  }

  function start() {
    const fb = window.FB;
    if (!fb) return setResult({ ok: false, message: t("whatsapp.sdkFailed") });
    setBusy(true);
    setResult(null);
    signup.current = {};
    // FB.login wants a plain function, not an async one
    fb.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          setResult((prev) => prev ?? { ok: false, message: t("whatsapp.cancelled") });
          return;
        }
        void finish(code);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  const canStart = ready && !busy && ownerId !== "" && consentBy.trim().length >= 2 && agreed;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <span className={labelCls} aria-hidden="true">{t("whatsapp.owner")}</span>
          <Select
            id="wa-owner-select"
            label={t("whatsapp.owner")}
            value={ownerId}
            onChange={setOwnerId}
            placeholder={t("whatsapp.ownerPick")}
            options={reps.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>
        <div>
          <label htmlFor="wa-consent-by" className={labelCls}>{t("whatsapp.consentName")}</label>
          <input
            id="wa-consent-by"
            value={consentBy}
            onChange={(e) => setConsentBy(e.target.value)}
            maxLength={120}
            autoComplete="off"
            className={inputCls}
          />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-base text-ink desk:min-h-0">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="check mt-0.5" />
        <span>{t("whatsapp.consentCheck")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={start}
          disabled={!canStart}
          className="h-11 rounded-full bg-ink px-6 text-base font-semibold text-white hover:bg-ink/85 disabled:opacity-50 desk:h-9"
        >
          {busy ? t("whatsapp.connecting") : t("whatsapp.connect")}
        </button>
        {result && (
          <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-slate" : "font-semibold text-ink"}>
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
