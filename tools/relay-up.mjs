/**
 * Is a relay reachable? Exit 0 if yes, 1 if no.
 *
 * Used by the pre-push hook to decide whether to run the end-to-end suites or
 * skip them. It answers the question in under a second rather than letting a
 * test sit in a 30 s connect timeout to reach the same conclusion.
 *
 * Checks the local relay first, then the deployed one. Either will do — the
 * suites take a base URL and do not care which they are pointed at.
 *
 * Usage:  node tools/relay-up.mjs [http_base]
 */

const CANDIDATES = process.argv[2]
  ? [process.argv[2]]
  : ["http://127.0.0.1:8000", "https://hopboard.fastapicloud.dev"];

for (const base of CANDIDATES) {
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(3000),
      // Cloudflare fronts the deployed relay and 403s some default agents.
      headers: { "User-Agent": "hopboard-hook/1.0" },
    });
    if (!res.ok) continue;
    const body = await res.json();
    if (body?.ok !== true) continue;
    console.log(`relay: ${base} (instance ${body.instance})`);
    process.exit(0);
  } catch {
    // Unreachable, refused, timed out — all the same answer here.
  }
}

console.log("relay: none reachable");
process.exit(1);
