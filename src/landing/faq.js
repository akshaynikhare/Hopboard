/**
 * The FAQ accordion's one piece of behaviour: expand all / collapse all.
 *
 * The accordion itself is <details> and needs nothing from this file — it
 * opens, closes, takes keyboard focus and announces its state on its own. That
 * is the whole reason it is <details> rather than a div with a click handler:
 * everything except this button is free and cannot break.
 *
 * So the button is hidden in the markup and revealed here. With no JavaScript
 * the reader gets a working accordion and no dead control, which is the right
 * way round.
 *
 * Used by index.html and the help articles. Both name the button #faqAll and
 * point its aria-controls at the list, so this module needs no per-page wiring.
 */

const btn = document.getElementById("faqAll");

if (btn) {
  const list = document.getElementById(btn.getAttribute("aria-controls"));
  const items = list ? [...list.querySelectorAll("details.qa")] : [];

  if (items.length) {
    btn.hidden = false;

    const label = btn.querySelector(".faqall-t");

    /* One source of truth for the button's state: the items themselves.
       Tracking it in a variable here drifts the moment someone opens a
       question by hand, and then the button lies about what it will do. */
    const sync = () => {
      const allOpen = items.every((d) => d.open);
      btn.setAttribute("aria-expanded", String(allOpen));
      if (label) label.textContent = allOpen ? "Collapse all" : "Expand all";
    };

    btn.addEventListener("click", () => {
      // Read the state before writing any of it, or the loop reads back its
      // own changes half way through and only the first item moves.
      const open = !items.every((d) => d.open);
      items.forEach((d) => { d.open = open; });
      sync();
    });

    // `toggle` does not bubble, so it has to be bound per item rather than
    // caught once on the list.
    items.forEach((d) => d.addEventListener("toggle", sync));

    sync();
  }
}
