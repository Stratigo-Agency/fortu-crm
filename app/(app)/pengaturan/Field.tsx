import { labelCls } from "./formStyles";

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-sm text-slate">{hint}</p>}
    </div>
  );
}
