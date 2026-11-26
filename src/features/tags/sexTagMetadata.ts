/**
 * Korean labels, intuitive sub-categories, and Danbooru noise demotion for the Sex tag dictionary.
 * Keeps original English prompt tags intact for generation while making scanning and Korean search instant.
 */

export type SexCategory =
  | "체위"
  | "삽입"
  | "오럴"
  | "가슴"
  | "손·발"
  | "체액"
  | "집단"
  | "결박·도구"
  | "표정·상황"
  | "기타";

export const SEX_CATEGORY_ORDER: SexCategory[] = [
  "체위",
  "삽입",
  "오럴",
  "가슴",
  "손·발",
  "체액",
  "집단",
  "결박·도구",
  "표정·상황",
  "기타",
];

/** Non-action/body/wiki-scrape noise tags demoted to '기타' so core tags appear first. */
const NOISE_TAGS = new Set([
  "tail",
  "feet",
  "loli",
  "shota",
  "muscular",
  "muscular male",
  "muscular female",
  "pectorals",
  "curvy",
  "plump",
  "fat",
  "skinny",
  "obese",
  "mature female",
  "mature male",
  "minigirl",
  "miniboy",
  "giant",
  "giantess",
  "extra arms",
  ":>=",
  "amputee",
  "double amputee",
  "quadruple amputee",
  "guro",
  "vore",
  "toddlercon",
  "diaper",
  "crossdressing",
  "crossdressing (mtf)",
  "crossdressing (ftm)",
  "reverse trap",
  "big belly",
  "bust cup",
  "no testicles",
  "bara",
  "josou seme",
  "futasub",
  "bisexual female",
]);

const BONDAGE_OR_TOOL_TAGS = new Set([
  "bdsm",
  "bondage",
  "shibari",
  "shibari over clothes",
  "bound wrists",
  "bound arms",
  "bound legs",
  "bound torso",
  "bound together",
  "frogtie",
  "hogtie",
  "suspension",
  "spreader bar",
  "spanked",
  "pet play",
  "leash pull",
  "dominatrix",
  "condom",
  "used condom",
  "used condom on penis",
  "strap-on",
  "milking machine",
  "tentacles",
  "tentacle sex",
  "tentacles under clothes",
  "tentacles on male",
  "tentacle pit",
  "consensual tentacles",
  "sadism",
  "masochism",
  "strangling",
  "asphyxiation",
  "torture",
  "slave",
  "nipple clamps",
  "breast bondage",
]);

const MOOD_OR_SITUATION_TAGS = new Set([
  "ahegao",
  "torogao",
  "naughty face",
  "fucked silly",
  "happy sex",
  "rough sex",
  "clothed sex",
  "after sex",
  "afterglow",
  "implied sex",
  "stealth sex",
  "femdom",
  "assertive female",
  "clothed female nude male",
  "yuri",
  "yaoi",
  "futanari",
  "futa with female",
  "futa with male",
  "futa with futa",
  "body writing",
  "tally",
  "exhibitionism",
  "public nudity",
  "public indecency",
  "public use",
  "glory wall",
  "voyeurism",
  "peeking",
  "caught",
  "walk-in",
  "netorare",
  "cheating (relationship)",
  "impregnation",
  "pregnant",
  "sleep molestation",
  "molestation",
  "chikan",
  "rape",
  "imminent rape",
  "after rape",
  "prostitution",
  "incest",
  "twincest",
  "selfcest",
  "humiliation",
  "cross-section",
  "x-ray",
  "stomach bulge",
  "smelling",
  "smelling clothes",
  "take your pick",
  "teamwork (sexual)",
  "bestiality",
]);

export const SEX_KO_LABELS: Record<string, string> = {
  // 체위
  "missionary": "정상위",
  "doggystyle": "후배위 (도기)",
  "sex from behind": "후배위",
  "prone bone": "엎드린 후배위",
  "mating press": "프레스 체위",
  "cowgirl position": "기승위",
  "reverse cowgirl position": "역기승위",
  "squatting cowgirl position": "쪼그린 기승위",
  "girl on top": "여성 상위",
  "boy on top": "남성 상위",
  "standing sex": "입위 (서서)",
  "suspended congress": "들박",
  "reverse suspended congress": "역들박",
  "upright straddle": "대면 좌위",
  "reverse upright straddle": "배면 좌위",
  "spooning": "측위 (스푸닝)",
  "on side": "옆으로 누움",
  "folded": "다리 접은 체위",
  "legs up": "다리 들어올림",
  "legs over head": "다리 머리 위로",
  "knees to chest": "무릎 가슴으로",
  "bent over": "허리 숙임",
  "top-down bottom-up": "엉덩이 치켜듦",
  "amazon position": "아마존 체위",
  "full nelson": "풀 넬슨",
  "spitroast": "앞뒤 동시",
  "69": "69 체위",
  "sitting on face": "안면기승",

  // 삽입
  "sex": "섹스",
  "vaginal": "질내 삽입",
  "anal": "애널",
  "double penetration": "이중 삽입",
  "triple penetration": "삼중 삽입",
  "deep penetration": "깊은 삽입",
  "large insertion": "대형 삽입",
  "imminent penetration": "삽입 직전",
  "imminent vaginal": "질 삽입 직전",
  "imminent anal": "애널 삽입 직전",
  "after vaginal": "삽입 후",
  "after anal": "애널 후",
  "covered penetration": "가려진 삽입",
  "guided penetration": "손으로 유도 삽입",
  "defloration": "처녀 상실",
  "male penetrated": "남성 피삽입",
  "object insertion": "물건 삽입",
  "vaginal object insertion": "질내 도구 삽입",
  "anal object insertion": "애널 도구 삽입",
  "urethral insertion": "요도 삽입",

  // 오럴
  "oral": "오럴",
  "fellatio": "펠라치오",
  "deepthroat": "딥스로트",
  "irrumatio": "이라마치오",
  "cunnilingus": "커닐링구스",
  "anilingus": "애널 핥기",
  "after fellatio": "펠라 후",
  "cooperative fellatio": "합동 펠라",
  "implied fellatio": "펠라 암시",
  "gokkun": "정액 삼킴",
  "testicle sucking": "고환 핥기",
  "licking foot": "발 핥기",
  "licking armpit": "겨드랑이 핥기",

  // 가슴
  "paizuri": "파이즈리",
  "straddling paizuri": "올라탄 파이즈리",
  "paizuri under clothes": "옷 속 파이즈리",
  "cooperative paizuri": "합동 파이즈리",
  "handsfree paizuri": "노핸드 파이즈리",
  "perpendicular paizuri": "수직 파이즈리",
  "after paizuri": "파이즈리 후",
  "breast sucking": "가슴 빨기",
  "grabbing another's breast": "상대 가슴 잡기",
  "grabbing own breast": "자기 가슴 잡기",
  "guided breast grab": "가슴에 손 얹기",
  "breast smother": "가슴 파묻기",
  "nipple tweak": "유두 자극",
  "nipple pull": "유두 잡아당김",
  "nipple clamps": "유두 집게",
  "lactation": "모유 분비",
  "lactation through clothes": "옷 위로 모유",
  "breastfeeding": "수유",
  "breast bondage": "가슴 결박",
  "breast expansion": "가슴 커짐",
  "pectoral grab": "흉근 잡기",

  // 손·발
  "handjob": "핸드잡",
  "double handjob": "더블 핸드잡",
  "two-handed handjob": "양손 핸드잡",
  "nursing handjob": "수유 핸드잡",
  "fingering": "핑거링",
  "anal fingering": "애널 핑거링",
  "fingering through clothes": "옷 위로 핑거링",
  "fingering through panties": "팬티 위로 핑거링",
  "implied fingering": "핑거링 암시",
  "masturbation": "자위",
  "female masturbation": "여성 자위",
  "male masturbation": "남성 자위",
  "futanari masturbation": "후타 자위",
  "mutual masturbation": "상호 자위",
  "masturbation through clothes": "옷 위로 자위",
  "after masturbation": "자위 후",
  "implied masturbation": "자위 암시",
  "footjob": "풋잡",
  "two-footed footjob": "양발 풋잡",
  "footjob with legwear": "양말/스타킹 풋잡",
  "foot worship": "발 숭배",
  "thigh sex": "허벅지 잡",
  "buttjob": "엉덩이 잡",
  "hairjob": "머리카락 잡",
  "armpit sex": "겨드랑이 잡",
  "glansjob": "귀두 자극",
  "tribadism": "가위치기",
  "frottage": "스마타 (마찰)",
  "crotch rub": "사타구니 비빔",
  "groping": "더듬기",
  "grabbing another's ass": "엉덩이 잡기",
  "crotch grab": "사타구니 잡기",
  "torso grab": "허리 붙잡기",
  "caressing testicles": "고환 애무",
  "reach-around": "뒤에서 손 애무",

  // 체액
  "cum": "정액",
  "cum in pussy": "질내 사정",
  "cum in ass": "애널 사정",
  "cum in mouth": "입안 사정",
  "internal cumshot": "내부 사정",
  "ejaculation": "사정",
  "ejaculating while penetrated": "삽입 중 사정",
  "facial": "얼굴 사정",
  "cum on body": "몸에 정액",
  "cum on breasts": "가슴에 정액",
  "cum on pectorals": "흉근에 정액",
  "cum on hair": "머리에 정액",
  "cum on clothes": "옷에 정액",
  "cum in clothes": "옷 안에 정액",
  "cum on ass": "엉덩이에 정액",
  "cum on stomach": "배에 정액",
  "cum on tongue": "혀에 정액",
  "cum on pussy": "음부에 정액",
  "cum on eyewear": "안경에 정액",
  "cumdrip": "정액 흘러내림",
  "cum pool": "정액 웅덩이",
  "cum inflation": "정액 배부풀림",
  "bukkake": "부카케",
  "pussy juice": "애액",
  "female ejaculation": "여성 분수",
  "peeing": "방뇨",
  "peeing self": "실금",
  "have to pee": "소변 참기",

  // 집단
  "threesome": "쓰리썸",
  "ffm threesome": "여2 남1 쓰리썸",
  "mmf threesome": "남2 여1 쓰리썸",
  "fff threesome": "여3 쓰리썸",
  "mmm threesome": "남3 쓰리썸",
  "group sex": "그룹 섹스",
  "gangbang": "윤간",
  "orgy": "난교",

  // 결박·도구
  "bdsm": "BDSM",
  "bondage": "결박",
  "shibari": "시바리 (밧줄 결박)",
  "shibari over clothes": "옷 위 시바리",
  "bound wrists": "손목 결박",
  "bound arms": "팔 결박",
  "bound legs": "다리 결박",
  "bound torso": "몸통 결박",
  "bound together": "함께 결박",
  "frogtie": "개구리 결박",
  "hogtie": "호그타이 결박",
  "suspension": "공중 결박",
  "spreader bar": "다리 벌림 막대",
  "spanked": "엉덩이 때리기",
  "pet play": "펫 플레이",
  "leash pull": "목줄 당기기",
  "dominatrix": "여왕님 (도미나)",
  "condom": "콘돔",
  "used condom": "사용한 콘돔",
  "used condom on penis": "착용된 콘돔",
  "strap-on": "페니스 밴드",
  "milking machine": "착유기",
  "tentacles": "촉수",
  "tentacle sex": "촉수 섹스",
  "tentacles under clothes": "옷 속 촉수",
  "tentacles on male": "남성 촉수",
  "tentacle pit": "촉수 구덩이",
  "consensual tentacles": "합의 촉수",
  "sadism": "가학 (사디즘)",
  "masochism": "피학 (마조히즘)",
  "strangling": "목 조르기",
  "asphyxiation": "질식",
  "slave": "노예",

  // 표정·상황
  "ahegao": "아헤가오",
  "torogao": "토로가오 (황홀)",
  "naughty face": "음란한 표정",
  "fucked silly": "정신 혼미",
  "happy sex": "행복한 섹스",
  "rough sex": "거친 섹스",
  "clothed sex": "착의 섹스",
  "after sex": "섹스 후",
  "afterglow": "여운",
  "implied sex": "섹스 암시",
  "stealth sex": "몰래 섹스",
  "femdom": "여성 주도 (펨돔)",
  "assertive female": "적극적인 여성",
  "clothed female nude male": "착의녀 × 전라남",
  "yuri": "백합 (유리)",
  "yaoi": "BL (야오이)",
  "futanari": "후타나리",
  "futa with female": "후타 × 여성",
  "futa with male": "후타 × 남성",
  "futa with futa": "후타 × 후타",
  "body writing": "몸 낙서",
  "tally": "횟수 표시 (正)",
  "exhibitionism": "노출증",
  "public nudity": "공공 노출",
  "public indecency": "공공 외설",
  "public use": "공용",
  "glory wall": "글로리 홀",
  "voyeurism": "훔쳐보기",
  "peeking": "엿보기",
  "caught": "들킴",
  "walk-in": "갑자기 들어옴",
  "netorare": "네토라레 (NTR)",
  "cheating (relationship)": "바람/불륜",
  "impregnation": "임신 수정",
  "pregnant": "임신",
  "sleep molestation": "수면 추행",
  "molestation": "추행",
  "chikan": "치한",
  "rape": "강간",
  "imminent rape": "강간 직전",
  "after rape": "강간 후",
  "prostitution": "매춘",
  "incest": "근친",
  "twincest": "쌍둥이 근친",
  "selfcest": "자기 복제",
  "humiliation": "수치심",
  "cross-section": "단면도",
  "x-ray": "투시도 (X-ray)",
  "stomach bulge": "배 불룩함",
  "smelling": "냄새 맡기",
  "smelling clothes": "옷 냄새 맡기",
  "bestiality": "수간",
  "inflation": "배 부풀림",
};

export type RawSexTag = {
  raw: string;
  display: string;
  count: number;
  groups?: Array<"core" | "acts" | "positions">;
  actGroups?: string[];
  positionGroups?: string[];
};

export function classifySexTag(tag: RawSexTag): {
  title: string;
  category: SexCategory;
  isNoise: boolean;
} {
  const key = tag.display.trim().toLowerCase();
  const title = SEX_KO_LABELS[key] ?? tag.display;

  if (NOISE_TAGS.has(key)) {
    return { title, category: "기타", isNoise: true };
  }

  const acts = new Set(tag.actGroups ?? []);
  const groups = new Set(tag.groups ?? []);

  if (BONDAGE_OR_TOOL_TAGS.has(key) || acts.has("toys")) {
    return { title, category: "결박·도구", isNoise: false };
  }
  if (key === "sex") {
    return { title, category: "삽입", isNoise: false };
  }
  if (groups.has("positions") || key === "sitting on face") {
    return { title, category: "체위", isNoise: false };
  }
  if (MOOD_OR_SITUATION_TAGS.has(key)) {
    return { title, category: "표정·상황", isNoise: false };
  }
  if (acts.has("group")) return { title, category: "집단", isNoise: false };
  if (acts.has("fluids")) return { title, category: "체액", isNoise: false };
  if (acts.has("oral")) return { title, category: "오럴", isNoise: false };
  if (acts.has("breast")) return { title, category: "가슴", isNoise: false };
  if (acts.has("manual") || key === "groping" || key === "grabbing another's ass" || key === "crotch grab" || key === "torso grab" || key === "caressing testicles" || key === "reach-around" || key === "foot worship") {
    return { title, category: "손·발", isNoise: false };
  }
  if (acts.has("penetration") || acts.has("anal")) {
    return { title, category: "삽입", isNoise: false };
  }

  return { title, category: "기타", isNoise: false };
}
