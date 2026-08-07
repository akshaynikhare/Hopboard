/**
 * A copy button on every command block.
 *
 * This is what makes wrapping the commands safe: the blocks used to scroll
 * horizontally on the argument that a wrapped command is a mis-pasted command,
 * true while the only way to take one was to select it by hand. **If this module
 * ever goes, the `overflow-x:auto` has to come back with it.**
 *
 * Added by script rather than markup because a button that cannot work is worse
 * than no button, and the Clipboard API needs a secure context — which
 * `http://192.168.x.x` is not.
 */

const RESET_MS = 1600;

/* `document.execCommand` is deliberately not a fallback here. It is the only
   other way to do this, it is deprecated, and the pages this runs on are served
   over HTTPS in every place they are meant to be read — so the one case it
   would rescue is a self-hoster on plain HTTP, where the app itself cannot
   derive a key either. Better to show no button than to carry a second copy
   path for a page that is already broken. */
if (navigator.clipboard?.writeText) {
  for (const pre of document.querySelectorAll("pre")) {
    const source = pre.querySelector("code") ?? pre;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copybtn";
    btn.textContent = "Copy";
    // The block is right there and reads as one thing; naming the command in
    // the label would just repeat what the button sits on top of.
    btn.setAttribute("aria-label", "Copy this command");

    /* aria-live on a separate node, not on the button: changing a focused
       button's own text is announced inconsistently, and on some combinations
       not at all. */
    const said = document.createElement("span");
    said.className = "sr-only";
    said.setAttribute("role", "status");

    let timer;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
      } catch {
        // Denied by permission policy, or the document lost focus mid-write.
        btn.textContent = "Press Ctrl+C";
        said.textContent = "Copy failed — select the command and press Ctrl+C";
        clearTimeout(timer);
        timer = setTimeout(() => { btn.textContent = "Copy"; said.textContent = ""; }, RESET_MS * 2);
        return;
      }
      btn.textContent = "Copied";
      said.textContent = "Command copied";
      clearTimeout(timer);
      timer = setTimeout(() => { btn.textContent = "Copy"; said.textContent = ""; }, RESET_MS);
    });

    pre.append(btn, said);
    pre.classList.add("has-copy");
  }
}
