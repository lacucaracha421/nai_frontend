import type { ReactNode } from "react";

const S = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function frame(children: ReactNode) {
  return (
    <svg {...S} className="inline-dict-glyph">
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" opacity="0.45" />
      {children}
    </svg>
  );
}

/** Mini silhouette + highlighted crop region for body framing tags. */
function bodyCrop(cropY: number, cropH: number) {
  return (
    <svg {...S} className="inline-dict-glyph">
      {/* Subtle full human silhouette */}
      <circle cx="12" cy="5.2" r="2" opacity="0.38" />
      <path d="M9 11.5c0-2 1.2-3 3-3s3 1 3 3v3.5h-1.4V20h-3.2v-5H9v-3.5Z" opacity="0.35" />
      {/* Active framing window */}
      <rect
        x="4"
        y={cropY}
        width="16"
        height={cropH}
        rx="1.8"
        fill="currentColor"
        fillOpacity="0.14"
        strokeWidth="1.9"
      />
    </svg>
  );
}

/**
 * Compact visual pictogram for common composition, camera angle, framing, and lens tags.
 * Returns null when no bespoke visual adds clarity over the Korean label.
 */
export function compositionGlyph(prompt: string): ReactNode {
  const key = prompt.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  switch (key) {
    // ---- 시점 (Camera Angles) ----
    case "dutch angle":
      return (
        <svg {...S} className="inline-dict-glyph">
          <g transform="rotate(-14 12 12)">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <line x1="4" y1="13.5" x2="20" y2="13.5" opacity="0.55" />
          </g>
        </svg>
      );
    case "from above":
      return frame(
        <>
          <path d="M12 6v8" />
          <path d="M8.8 11.2 12 14.5l3.2-3.3" />
          <circle cx="12" cy="17.4" r="1.4" fill="currentColor" stroke="none" />
        </>,
      );
    case "high up":
      return frame(
        <>
          <circle cx="12" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
          <path d="M10.5 9 6 17.5M13.5 9l4.5 8.5" opacity="0.55" />
          <path d="M12 9v8" />
          <path d="M9.8 14.8 12 17.2l2.2-2.4" />
        </>,
      );
    case "from below":
      return frame(
        <>
          <circle cx="12" cy="6.8" r="1.4" fill="currentColor" stroke="none" />
          <path d="M12 18v-8" />
          <path d="M8.8 12.8 12 9.5l3.2 3.3" />
        </>,
      );
    case "worm's eye view":
      return frame(
        <>
          <line x1="5" y1="18" x2="19" y2="18" opacity="0.6" />
          <path d="M12 17.5V7.5" />
          <path d="M8.5 11 12 7.5 15.5 11" />
        </>,
      );
    case "from behind":
      return frame(
        <>
          <circle cx="12" cy="9.5" r="2.6" />
          <path d="M7.5 17.5c.8-2.6 2.4-3.8 4.5-3.8s3.7 1.2 4.5 3.8" />
          <path d="M16.8 7.2c1.2.9 1.6 2.2 1.2 3.5" opacity="0.7" />
        </>,
      );
    case "from side":
    case "profile":
      return frame(
        <>
          <circle cx="14.2" cy="10" r="2.5" />
          <path d="M11.5 17.5c.7-2.2 2-3.3 3.7-3.3" />
          <path d="M5.5 12h4.2" />
          <path d="M8 9.8 10.2 12 8 14.2" />
        </>,
      );
    case "group profile":
      return frame(
        <>
          <circle cx="9.2" cy="10" r="2" />
          <circle cx="15.2" cy="10" r="2" />
          <path d="M6.8 17c.5-2 1.5-3 2.8-3M12.8 17c.5-2 1.5-3 2.8-3" />
        </>,
      );
    case "straight-on":
      return frame(
        <>
          <circle cx="12" cy="12" r="3.6" />
          <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
        </>,
      );
    case "three quarter view":
      return frame(
        <>
          <circle cx="13" cy="10.5" r="3" />
          <path d="M14.3 9.7v1.6" />
          <path d="M6.2 16.2 10 13" />
          <path d="M6.2 13.4v2.8H9" />
        </>,
      );
    case "upside-down":
      return frame(
        <>
          <circle cx="12" cy="15.2" r="2" />
          <path d="M8.8 7.5c.8 2.2 2 3.3 3.2 3.3s2.4-1.1 3.2-3.3" />
        </>,
      );
    case "sideways":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" opacity="0.45" />
          <path d="M16 12H8" />
          <path d="M11 9l-3 3 3 3" />
        </svg>
      );
    case "multiple views":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="3" y="4" width="8" height="7" rx="1.4" />
          <rect x="13" y="4" width="8" height="7" rx="1.4" />
          <rect x="3" y="13" width="8" height="7" rx="1.4" />
          <rect x="13" y="13" width="8" height="7" rx="1.4" />
        </svg>
      );

    // ---- 프레이밍 (Framing) ----
    case "close-up":
      return bodyCrop(2.4, 6);
    case "portrait":
      return bodyCrop(2.4, 8.6);
    case "upper body":
      return bodyCrop(2.4, 11.4);
    case "cowboy shot":
      return bodyCrop(2.4, 14.5);
    case "lower body":
      return bodyCrop(11.2, 10.2);
    case "full body":
      return bodyCrop(2.4, 19);
    case "wide shot":
      return frame(
        <>
          <line x1="3.5" y1="16.5" x2="20.5" y2="16.5" opacity="0.4" />
          <circle cx="12" cy="10.5" r="1.4" />
          <path d="M12 12v4.3" />
        </>,
      );
    case "very wide shot":
      return frame(
        <>
          <line x1="3.5" y1="15.5" x2="20.5" y2="15.5" opacity="0.45" />
          <circle cx="12" cy="13.2" r="1.1" fill="currentColor" stroke="none" />
        </>,
      );
    case "head out of frame":
    case "eyes out of frame":
    case "cropped head":
      return frame(
        <>
          <line x1="5" y1="6" x2="19" y2="6" strokeDasharray="2.5 2" />
          <path d="M8.5 18v-5.5c0-1.6 1.4-2.5 3.5-2.5s3.5.9 3.5 2.5V18" />
        </>,
      );
    case "feet out of frame":
    case "foot out of frame":
    case "knees out of frame":
    case "cropped legs":
      return frame(
        <>
          <circle cx="12" cy="7.5" r="1.8" />
          <path d="M9.5 11.2h5v6.8" />
          <path d="M9.5 11.2v6.8" />
          <line x1="5" y1="18" x2="19" y2="18" strokeDasharray="2.5 2" />
        </>,
      );
    case "arm out of frame":
    case "cropped arms":
    case "cropped shoulders":
    case "cropped torso":
    case "cropped":
      return (
        <svg {...S} className="inline-dict-glyph">
          <path d="M6 3.5v14.5h14.5" />
          <path d="M3.5 6h14.5v14.5" opacity="0.55" />
        </svg>
      );
    case "cut-in":
      return frame(
        <rect x="4.5" y="9" width="15" height="6" rx="1.2" fill="currentColor" fillOpacity="0.18" />,
      );
    case "split crop":
      return frame(<line x1="12" y1="4" x2="12" y2="20" />);

    // ---- 렌즈·원근 (Lens & Perspective) ----
    case "fisheye":
      return (
        <svg {...S} className="inline-dict-glyph">
          <circle cx="12" cy="12" r="8.5" />
          <ellipse cx="12" cy="12" rx="4.2" ry="8.5" opacity="0.55" />
          <ellipse cx="12" cy="12" rx="8.5" ry="4.2" opacity="0.55" />
        </svg>
      );
    case "panorama":
    case "360 panorama":
      return (
        <svg {...S} className="inline-dict-glyph">
          <path d="M2.5 7.5q9.5 2.4 19 0v9q-9.5-2.4-19 0Z" />
        </svg>
      );
    case "perspective":
    case "vanishing point":
      return frame(
        <>
          <circle cx="12" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <path d="M3.5 19 12 10l8.5 9M3.5 6 12 10l8.5-4" opacity="0.65" />
        </>,
      );
    case "foreshortening":
    case "forced perspective":
      return frame(
        <>
          <circle cx="7.5" cy="9.5" r="1.8" opacity="0.55" />
          <circle cx="15.5" cy="13.5" r="4.2" />
          <path d="M9.3 9.2 14 9.5M8.5 11.2 12 16" opacity="0.45" />
        </>,
      );
    case "depth of field":
      return frame(
        <>
          <circle cx="8" cy="12" r="2.2" strokeDasharray="2 2" opacity="0.5" />
          <circle cx="15.5" cy="12" r="3" />
        </>,
      );
    case "blurry background":
      return frame(
        <>
          <path d="M5 8h4M5 12h3M15 8h4" strokeDasharray="2 2" opacity="0.45" />
          <circle cx="12" cy="12.5" r="3.2" fill="currentColor" fillOpacity="0.16" />
        </>,
      );
    case "blurry foreground":
      return frame(
        <>
          <circle cx="12" cy="11" r="2.6" />
          <path d="M4.5 17.5h15" strokeWidth="2.4" strokeDasharray="2.5 2.5" opacity="0.5" />
        </>,
      );
    case "atmospheric perspective":
      return frame(
        <>
          <path d="M4 16.5 9 11l4 4 3-3 4 4.5" />
          <path d="M5 10.5 10 7l5 3.5" opacity="0.4" />
        </>,
      );
    case "isometric":
      return (
        <svg {...S} className="inline-dict-glyph">
          <path d="M12 3.5 19.5 7.8v8.4L12 20.5 4.5 16.2V7.8Z" />
          <path d="M12 12 19.5 7.8M12 12 4.5 7.8M12 12v8.5" opacity="0.65" />
        </svg>
      );

    // ---- 주요 구도 / 시선 (Key Composition & Gaze) ----
    case "pov":
    case "viewfinder":
      return (
        <svg {...S} className="inline-dict-glyph">
          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
          <circle cx="12" cy="12" r="2" opacity="0.65" />
        </svg>
      );
    case "looking at viewer":
    case "facing viewer":
      return (
        <svg {...S} className="inline-dict-glyph">
          <path d="M2.5 12s3.5-5.5 9.5-5.5S21.5 12 21.5 12s-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "looking up":
      return frame(<path d="M12 16.5V7.5M8.5 11 12 7.5 15.5 11" />);
    case "looking down":
      return frame(<path d="M12 7.5v9M8.5 13 12 16.5 15.5 13" />);
    case "looking to the side":
    case "looking away":
      return frame(<path d="M7 12h10M13.5 8.5 17 12l-3.5 3.5" />);
    case "looking back":
    case "facing away":
      return frame(<path d="M16 15a5 5 0 0 0-7.5-4.3L7 12m0 0V8.5M7 12h3.5" />);
    case "symmetry":
    case "polar opposites":
      return frame(
        <>
          <line x1="12" y1="4.5" x2="12" y2="19.5" strokeDasharray="2 2" opacity="0.6" />
          <path d="M9.2 9.5 6.5 12l2.7 2.5M14.8 9.5 17.5 12l-2.7 2.5" />
        </>,
      );
    case "rotational symmetry":
      return (
        <svg {...S} className="inline-dict-glyph">
          <circle cx="12" cy="12" r="7.5" opacity="0.45" />
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "letterboxed":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" opacity="0.5" />
          <rect x="3" y="4" width="18" height="3.2" fill="currentColor" opacity="0.7" stroke="none" />
          <rect x="3" y="16.8" width="18" height="3.2" fill="currentColor" opacity="0.7" stroke="none" />
        </svg>
      );
    case "pillarboxed":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" opacity="0.5" />
          <rect x="3" y="4" width="3.5" height="16" fill="currentColor" opacity="0.7" stroke="none" />
          <rect x="17.5" y="4" width="3.5" height="16" fill="currentColor" opacity="0.7" stroke="none" />
        </svg>
      );
    case "border":
    case "inset border":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="3" y="4" width="18" height="16" rx="2" opacity="0.45" />
          <rect x="6" y="7" width="12" height="10" rx="1.2" />
        </svg>
      );
    case "outside border":
    case "out of frame":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="4" y="6" width="14" height="13" rx="2" opacity="0.5" />
          <circle cx="16.5" cy="7.5" r="3" fill="currentColor" fillOpacity="0.2" />
        </svg>
      );
    case "selfie":
    case "mirror selfie":
      return (
        <svg {...S} className="inline-dict-glyph">
          <rect x="6.5" y="3" width="11" height="18" rx="2" />
          <circle cx="12" cy="10.5" r="2.2" />
          <line x1="10.5" y1="18" x2="13.5" y2="18" />
        </svg>
      );
    case "negative space":
      return frame(<circle cx="16.8" cy="15.8" r="1.8" fill="currentColor" stroke="none" />);
    case "partially underwater shot":
      return frame(
        <>
          <path d="M3.5 12q4.2-2 8.5 0t8.5 0" />
          <rect x="3" y="12.5" width="18" height="7.5" fill="currentColor" opacity="0.16" stroke="none" />
        </>,
      );
    case "collage":
    case "zoom layer":
    case "projected inset":
      return frame(
        <>
          <rect x="5" y="6" width="7" height="6" rx="1" />
          <rect x="11" y="11" width="8" height="7" rx="1" fill="currentColor" fillOpacity="0.15" />
        </>,
      );
    case "lineup":
    case "group picture":
      return frame(
        <>
          <circle cx="7.5" cy="10.5" r="1.5" />
          <circle cx="12" cy="10.5" r="1.5" />
          <circle cx="16.5" cy="10.5" r="1.5" />
          <path d="M6 16.5h3M10.5 16.5h3M15 16.5h3" />
        </>,
      );
    case "column lineup":
      return frame(
        <>
          <line x1="7" y1="8.5" x2="17" y2="8.5" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="7" y1="15.5" x2="17" y2="15.5" />
        </>,
      );
    default:
      return null;
  }
}
