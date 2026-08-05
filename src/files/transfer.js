/**
 * File transfer. M7 — not yet wired to a network.
 *
 * Planned path, in order:
 *   1. WebRTC data channel, signalled over the existing relay. Free, direct.
 *   2. If ICE has not connected within NET.ICE_TIMEOUT_MS, fall back to chunked
 *      transfer over the relay (FILES.CHUNK_BYTES frames).
 *
 * We deliberately do NOT run a TURN server: TURN relays the bytes anyway, so it
 * fixes connectivity by discarding the property that motivated P2P, and it
 * costs bandwidth. The relay fallback is viable precisely because the cap is
 * 5 MB. See docs/P2P-FILES.md §4.
 *
 * Whichever path is used MUST be surfaced in the UI. A user on a corporate
 * network deserves to know their file went through the relay — that is a
 * different privacy and performance story from a direct transfer.
 */

import { NET } from "../core/config.js";
import { emit, EV } from "../core/bus.js";
import * as registry from "./registry.js";

export const PATH = { P2P: "p2p", RELAY: "relay" };

/**
 * Request a remote file. Currently simulates progress so the UI can be
 * exercised end to end; swap the body for real WebRTC in M7 and nothing that
 * calls this needs to change.
 */
export async function request(id) {
  const file = registry.get(id);
  if (!file || file.origin !== "remote") return;

  emit(EV.TOAST, `Requesting ${file.name}…`);

  // --- M7: createPeerConnection -> datachannel -> chunk -> reassemble ---
  // --- with a NET.ICE_TIMEOUT_MS race against the relay fallback.      ---
  await simulate(id);
}

function simulate(id) {
  return new Promise(resolve => {
    let percent = 0;
    const timer = setInterval(() => {
      percent = Math.min(100, percent + 12);
      registry.setProgress(id, percent);
      if (percent >= 100) {
        clearInterval(timer);
        registry.complete(id, null, PATH.P2P);
        emit(EV.TOAST, `${registry.get(id)?.name} received over P2P`);
        resolve();
      }
    }, 130);
  });
}

/** Exposed so the UI can show the ICE deadline honestly rather than a spinner. */
export const iceTimeoutMs = NET.ICE_TIMEOUT_MS;
