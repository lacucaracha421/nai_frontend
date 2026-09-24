// NAI redesign concepts (2026-09-24). Static prototype helpers: icons, screen switching,
// placeholder art. No network, no build, no app code.
const ICONS = {
  save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  seed: '<path d="M12 20v-7M12 13c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 15c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z"/>',
  upscale: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  copy: '<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6a1.5 1.5 0 011.5-1.5H16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.7A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.6 3.3M6.2 7.2C3.9 8.8 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
  pin: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 010 9h-3"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19.5 11.5H9a4.5 4.5 0 000 9h3"/>',
  translate: '<path d="M4 6h9M8.5 4v2M6 6c.5 3 2.5 5.5 5.5 7M11 6c-.6 3.5-3 6.5-6.5 8"/><path d="M13 20l3.5-8.5L20 20M14.3 17h4.4"/>',
  book: '<path d="M4 5h5.5A2.5 2.5 0 0112 7.5V20a2 2 0 00-2-2H4zM20 5h-5.5A2.5 2.5 0 0012 7.5V20a2 2 0 012-2h6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  chevup: '<path d="M5 15l7-7 7 7"/>',
  chevdown: '<path d="M5 9l7 7 7-7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  starf: '<path fill="currentColor" d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>',
  load: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4.5h14"/>',
  sliders: '<path d="M4 7h9M18 7h2M4 17h3M11 17h9"/><rect x="13" y="5" width="4" height="4" rx="1"/><rect x="7" y="15" width="4" height="4" rx="1"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.8 3.1-6.5 7-6.5s7 2.7 7 6.5"/>',
  brush: '<path d="M14 4.5l5.5 5.5-7.5 7.5L6.5 12z"/><path d="M6.5 12l-2 2c-1 1-1 3.5-.5 5.5 2 .5 4.5.5 5.5-.5l2-2"/>',
  scene: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 16l5-5 4 4 3-3 5 5"/><circle cx="15.5" cy="9" r="1.3"/>',
  shield: '<path d="M12 3.5l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9v-5z"/>',
  link: '<path d="M10 14l4-4M8.5 11.5L6 14a3 3 0 004 4l2.5-2.5M15.5 12.5L18 10a3 3 0 00-4-4l-2.5 2.5"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 00.5-8 6 6 0 00-11.5 1.5A3.3 3.3 0 007 18.5z"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  compare: '<rect x="3.5" y="5" width="7.5" height="14" rx="1.5"/><rect x="13" y="5" width="7.5" height="14" rx="1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5v.5"/>',
  repeat: '<path d="M4.5 12a7.5 7.5 0 0112.8-5.3L20 9.5M20 4.5v5h-5M19.5 12a7.5 7.5 0 01-12.8 5.3L4 14.5M4 19.5v-5h5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  wifi: '<path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5L19 4M16 7l2.5 2.5M14 9l2 2"/>',
  folder: '<path d="M3.5 6h6l2 2h9v11h-17z"/>',
  diff: '<path d="M7 4v8M3 8h8M13 17h8"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L3.5 12a1.5 1.5 0 012.5-1.5L8 13"/>',
};
function icon(name, cls = "") { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`; }
function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-i]").forEach((el) => { el.outerHTML = icon(el.dataset.i, el.className); });
}

function rng(seed) { let s = Math.imul(seed + 0x9e37, 2654435761) >>> 0; s = (s ^ (s >>> 15)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const HUES = [[262, 30], [212, 34], [336, 32], [18, 40], [168, 24], [196, 38], [290, 22], [42, 44], [228, 22], [6, 34]];
// Placeholder "illustration": layered gradients suggesting a figure over a backdrop. No real imagery.
function artBg(r) {
  const [h, s] = HUES[Math.floor(r() * HUES.length)];
  const h2 = (h + 20 + r() * 60) % 360;
  const l1 = 16 + r() * 22, l2 = 36 + r() * 30;
  const fx = 38 + r() * 24, fy = 46 + r() * 14;
  return `radial-gradient(ellipse 30% 40% at ${fx}% ${fy + 22}%, hsla(${h2},${s + 12}%,${Math.min(l2 + 22, 86)}%,.85), transparent 70%),`
    + `radial-gradient(ellipse 13% 9% at ${fx}% ${fy - 12}%, hsla(${(h2 + 12) % 360},${s + 6}%,${Math.min(l2 + 30, 90)}%,.75), transparent 72%),`
    + `radial-gradient(ellipse 24% 20% at ${fx}% ${fy - 14}%, hsla(${(h + 200) % 360},${s}%,${l2}%,.45), transparent 70%),`
    + `radial-gradient(circle at ${r() * 100}% ${r() * 35}%, hsla(${(h + 40) % 360},${s + 20}%,72%,.35), transparent 45%),`
    + `linear-gradient(${150 + r() * 40}deg, hsl(${h},${s}%,${l1}%), hsl(${h2},${s - 6}%,${l2}%))`;
}
function fillArt(root = document) { root.querySelectorAll("[data-art]").forEach((el) => { el.style.background = artBg(rng(Number(el.dataset.art))); }); }

// Android status bar + gesture bar so the frame reads as the S11 in portrait.
const SBAR = `<div class="sbar"><span class="num">21:14</span><span class="sbar-r">${icon("wifi", "xs")}</span></div>`;
const GBAR = `<div class="gbar"><span></span></div>`;

function showScreen() {
  const id = (location.hash || "").slice(1);
  const screens = [...document.querySelectorAll(".screen")];
  const target = screens.find((s) => s.id === id) || screens[0];
  screens.forEach((s) => s.classList.toggle("on", s === target));
}
window.addEventListener("hashchange", showScreen);
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-sbar]").forEach((el) => { el.outerHTML = SBAR; });
  document.querySelectorAll("[data-gbar]").forEach((el) => { el.outerHTML = GBAR; });
  if (window.build) window.build();
  hydrateIcons(); fillArt(); showScreen();
});
