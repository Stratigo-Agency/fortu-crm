import pkg from "@/package.json";

/** The deployed version: the short commit Railway built, or the package version when run by hand. */
export function appVersion(env: Record<string, string | undefined> = process.env): string {
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : pkg.version;
}
