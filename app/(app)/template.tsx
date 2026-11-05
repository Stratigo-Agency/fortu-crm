/** Re-mounts on every page change, so each screen slides in softly (Sana). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
