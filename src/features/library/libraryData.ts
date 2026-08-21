export type ArtistEntry = { name: string; note?: string; pinned?: boolean };
export type ActionEntry = { title: string; prompt: string; category: string; note?: string; pinned?: boolean };

export const artists: ArtistEntry[] = [
  { name: "kanzarin", pinned: true },
  { name: "ing (ing205509)" },
  { name: "kim 8thhh" },
  { name: "konoshige (ryuun)" },
  { name: "toma (toma50)" },
  { name: "turisasu" },
  { name: "sanatsuki (user cgxu2455)" },
  { name: "velzhe" },
  { name: "laliberte" },
  { name: "kuromoto-kun (rina masimaro)" },
  { name: "ushio kiyoshi" },
  { name: "seoyong" },
  { name: "santa (sunflower)" },
  { name: "luxsumildo" },
  { name: "kubo tite" },
  { name: "mori kaoru" },
  { name: "obata takeshi" },
  { name: "hiramoto akira" },
  { name: "gurihiru" },
  { name: "yabuki kentarou" },
  { name: "katsura masakazu" },
  { name: "oogure ito" },
  { name: "eguchi hisashi" },
  { name: "fujimoto tatsuki" },
  { name: "rurudo", pinned: true },
  { name: "saitou masatsugu", pinned: true },
  { name: "mignon" },
  { name: "mugi (twinbox)" },
];

export const actions: ActionEntry[] = [
  {
    title: "Looking back",
    prompt: "looking back, over shoulder, looking at viewer",
    category: "Pose",
    note: "simple starter preset",
  },
  {
    title: "Leaning forward",
    prompt: "leaning forward, upper body forward, hand on thigh",
    category: "Pose",
  },
];
