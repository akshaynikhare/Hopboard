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
  : ["http://127.0.0.1:8000", "https://realtimeclipboard.fastapicloud.dev"];

for (const base of CANDIDATES) {
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(3000),
      // Cloudflare fronts the deployed relay and 403s some default agents.
      headers: { "User-Agent": "realtimeclipboard-hook/1.0" },
    });
    if (!res.ok) continue;
    const body = await res.json();
    if (body?.ok !== true) continue;
    // The URL goes to stdout ON ITS OWN LINE so the caller can capture it and
    // point the suites at the relay that was actually found.
    //
    // Without that, this and the tests disagree about which relay they mean:
    // this probes localhost first and reports success, while the suites fall
    // back to the DEPLOYED relay — so a developer running a local relay gets a
    // green gate that then fails against a host it never checked. That is worse
    // than no gate, because it fails at the moment of pushing and looks like a
    // broken commit rather than a missing deployment.
    console.error(`relay: ${base} (instance ${body.instance})`);
    console.log(base);
    process.exit(0);
  } catch {
    // Unreachable, refused, timed out — all the same answer here.
  }
}

console.error("relay: none reachable");
process.exit(1);
