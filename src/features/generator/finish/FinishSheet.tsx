import { useEffect, useState } from "react";
import { useUiStore } from "../../../stores/uiStore";
import type { GenerationImage } from "../../../types/generation";
import {
  FINISH_PARAM_RANGES,
  FINISH_PRESETS,
  FINISH_PRESET_LABELS,
  finishParamsEqual,
  type FinishParamKey,
  type FinishPresetKey,
} from "./finishFilter";
import { FinishSupersededError } from "./finishProtocol";
import { finishPreviewSource, finishRunner, imageObjectUrl } from "./finishImage";

const PRESET_KEYS: FinishPresetKey[] = ["anime", "watercolor"];
const PRESET_HINTS: Record<FinishPresetKey, string> = {
  anime: "빛 번짐 · 선명도 · 옅은 그레인",
  watercolor: "종이 결 · 부드러운 색",
};

const signed = (value: number) => (value > 0 ? "+" : "") + value;
const percent = (value: number) => `${value}%`;

const GROUPS: { title: string; items: { key: FinishParamKey; label: string; format: (value: number) => string }[] }[] = [
  {
    title: "색",
    items: [
      { key: "temp", label: "색온도", format: signed },
      { key: "curve", label: "톤 커브 (S자)", format: signed },
      { key: "lift", label: "암부 올리기", format: percent },
      { key: "sat", label: "채도", format: percent },
    ],
  },
  {
    title: "글로우",
    items: [
      { key: "glow", label: "세기", format: percent },
      { key: "gthr", label: "시작 밝기", format: percent },
      { key: "grad", label: "번짐", format: (value) => `${value}px` },
    ],
  },
  {
    title: "렌즈",
    items: [
      { key: "chroma", label: "색수차", format: (value) => `${value.toFixed(2)}px` },
      { key: "vig", label: "비네팅", format: percent },
    ],
  },
  {
    title: "수채화지 질감",
    items: [
      { key: "pstr", label: "세기", format: percent },
      { key: "pscale", label: "결 크기", format: percent },
    ],
  },
  {
    title: "디테일",
    items: [
      { key: "strength", label: "그레인 강도", format: (value) => `${value.toFixed(1)}%` },
      { key: "sharp", label: "샤픈", format: percent },
    ],
  },
];

function usePresetThumbnails(image: GenerationImage | undefined) {
  const [thumbs, setThumbs] = useState<{ key: string; urls: Partial<Record<FinishPresetKey, string>> } | null>(null);

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    const created: string[] = [];
    void finishPreviewSource(image).then(({ thumb }) =>
      Promise.all(
        PRESET_KEYS.map(async (preset) => {
          const filtered = await finishRunner.run(thumb, FINISH_PRESETS[preset], { lane: `thumb-${preset}` });
          if (cancelled) return;
          const url = await imageObjectUrl(filtered);
          created.push(url);
          if (cancelled) return;
          setThumbs((current) => ({
            key: image.filePath,
            urls: { ...(current?.key === image.filePath ? current.urls : {}), [preset]: url },
          }));
        }),
      ),
    ).catch((error) => {
      if (!(error instanceof FinishSupersededError)) console.warn("finish thumbnail failed", error);
    });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [image]);

  return thumbs && image && thumbs.key === image.filePath ? thumbs.urls : {};
}

export function FinishSheet({ image, busy, onClose }: { image: GenerationImage | undefined; busy: boolean; onClose: () => void }) {
  const enabled = useUiStore((s) => s.finishEnabled);
  const preset = useUiStore((s) => s.finishPreset);
  const params = useUiStore((s) => s.finishParams);
  const setEnabled = useUiStore((s) => s.setFinishEnabled);
  const applyPreset = useUiStore((s) => s.applyFinishPreset);
  const setParam = useUiStore((s) => s.setFinishParam);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const thumbs = usePresetThumbnails(image);
  const modified = !finishParamsEqual(params, FINISH_PRESETS[preset]);

  return (
    <div className="finish-sheet" role="dialog" aria-label="마무리 필터">
      <div className="finish-sheet-head">
        <div className="drag-handle" />
        <h2>마무리 필터{busy && <span className="finish-busy" aria-label="처리 중" />}</h2>
        <button
          type="button"
          className={`finish-switch ${enabled ? "on" : ""}`}
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          <span>{enabled ? "켜짐" : "꺼짐"}</span>
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="마무리 필터 닫기">↓</button>
      </div>

      <div className="finish-sheet-body">
        <div className="finish-presets">
          {PRESET_KEYS.map((key) => {
            const selected = enabled && preset === key;
            return (
              <button
                key={key}
                type="button"
                className={`finish-preset ${selected ? "selected" : ""}`}
                aria-pressed={selected}
                onClick={() => applyPreset(key)}
              >
                <span className="finish-thumb">
                  {thumbs[key] ? <img src={thumbs[key]} alt="" /> : image ? <span className="finish-thumb-pending" /> : null}
                </span>
                <span className="finish-preset-text">
                  <strong>{FINISH_PRESET_LABELS[key]}</strong>
                  <small>{selected && modified ? "세부 조절됨" : PRESET_HINTS[key]}</small>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="finish-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <span>세부 조절</span>
          <b>{detailsOpen ? "−" : "＋"}</b>
        </button>

        {detailsOpen && (
          <div className="finish-details">
            <button
              type="button"
              className="finish-reset"
              disabled={!modified}
              onClick={() => applyPreset(preset)}
            >
              {FINISH_PRESET_LABELS[preset]} 값으로 되돌리기
            </button>
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                {group.items.map(({ key, label, format }) => {
                  const range = FINISH_PARAM_RANGES[key];
                  return (
                    <label key={key} className="finish-slider">
                      <span className="finish-slider-label">
                        {label}
                        <output>{format(params[key])}</output>
                      </span>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={params[key]}
                        onChange={(event) => setParam(key, Number(event.target.value))}
                      />
                    </label>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
