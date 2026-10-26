/* Original Cardkov art catalog. Paths are finite; gameplay ownership stays in the model. */
(() => {
  "use strict";
  const cards = ["shot", "burst", "guard", "scan", "heal", "pierce", "grenade", "surge", "suppress", "breach", "fieldAid", "bulwark"];
  const items = ["rifle", "carbine", "pistol", "vest", "heavyVest", "backpack", "largePack", "scrap", "circuit", "medkit", "grenade", "cash"];
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  const path = (kind, id) => (kind === "card" ? cards : items).includes(id)
    ? `assets/pixel/${kind === "card" ? "cards" : "items"}/${id}.png?v=10` : null;
  function visual(kind, id, fallback = "box", extra = "") {
    const src = path(kind, id);
    return `<span class="asset-visual ${escape(extra)}" aria-hidden="true">${src ? `<img class="asset-icon" data-art-image src="${src}" alt="" loading="lazy" decoding="async" draggable="false">` : ""}<svg class="asset-fallback${src ? "" : " only-fallback"}"><use href="#i-${escape(fallback)}"/></svg></span>`;
  }
  document.addEventListener("error", (event) => {
    if (event.target.matches?.("img[data-art-image]")) event.target.parentElement.classList.add("asset-missing");
  }, true);
  document.querySelectorAll("img[data-art-image]").forEach((img) => {
    if (img.complete && !img.naturalWidth) img.parentElement.classList.add("asset-missing");
  });
  window.GameArt = Object.freeze({ cards: Object.freeze(cards), items: Object.freeze(items), path, visual });
})();
