// SHOW_SAMPLE_DATA=1 (staging only, never on by default): the funnel and Prospek figures include the
// demo rows (is_sample). It reaches SQL as the connection setting app.show_sample_data, which
// show_sample_data() reads (migration 019). Anything other than exactly "1" leaves sample rows out.

export function showSampleData(env: Record<string, string | undefined> = process.env): boolean {
  return env.SHOW_SAMPLE_DATA === "1";
}

/** Connection settings for postgres.js: empty unless SHOW_SAMPLE_DATA=1. */
export function sampleDataConnection(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return showSampleData(env) ? { "app.show_sample_data": "on" } : {};
}
