export type CharacterCard = { name: string; series: string; tags: string; accent: string };

export const series = [
  { name: "Vocaloid", count: 120, accent: "#7aa8a8" },
  { name: "Touhou", count: 261, accent: "#9f6f8f" },
  { name: "Fate (Series)", count: 483, accent: "#657ca5" },
  { name: "Genshin Impact", count: 196, accent: "#b88d61" },
  { name: "Blue Archive", count: 172, accent: "#687fab" },
  { name: "Honkai: Star Rail", count: 132, accent: "#815e93" },
  { name: "Original", count: 999, accent: "#70757c" },
  { name: "NieR", count: 42, accent: "#777268" },
];

export const characters: CharacterCard[] = [
  { name: "Hatsune Miku", series: "Vocaloid", tags: "twintails, teal hair", accent: "#6eaeb1" },
  { name: "Hakurei Reimu", series: "Touhou", tags: "red bow, shrine maiden", accent: "#b46870" },
  { name: "Kirisame Marisa", series: "Touhou", tags: "witch hat, blonde hair", accent: "#8a7c57" },
  { name: "Saber", series: "Fate (Series)", tags: "blonde hair, armor", accent: "#687fa8" },
  { name: "Ganyu", series: "Genshin Impact", tags: "blue hair, horns", accent: "#7b7daa" },
  { name: "2B", series: "NieR", tags: "white hair, black dress", accent: "#7b7873" },
];
