import { useGenerationStore } from "../../stores/generationStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { SAMPLERS, V5_MODELS } from "../../adapters/novelai/models";
import { BackupSection } from "./BackupSection";
import { TranslationSettings } from "./TranslationSettings";

const normalResolutions = [
  ["Portrait", 832, 1216],
  ["Square", 1024, 1024],
  ["Tall", 768, 1344],
  ["Landscape", 1216, 832],
] as const;

const largeResolutions = [
  ["Large Portrait", 1024, 1536],
  ["Large Square", 1472, 1472],
  ["Large Landscape", 1536, 1024],
] as const;

/** "generation" = per-generation values (생성 설정), "app" = one-time configuration (앱 설정). */
export type SettingsScope = "generation" | "app";

export function SettingsSheet({ onClose, scope }: { onClose: () => void; scope: SettingsScope }) {
  const generation = scope === "generation";
  const settings = useGenerationStore((state) => state.settings);
  const setSetting = useGenerationStore((state) => state.setSetting);
  const token = useConnectionStore((state) => state.tokenInput);
  const setToken = useConnectionStore((state) => state.setTokenInput);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const status = useConnectionStore((state) => state.status);
  const message = useConnectionStore((state) => state.message);
  const saveFormat = useUiStore((state) => state.saveFormat);
  const setSaveFormat = useUiStore((state) => state.setSaveFormat);
  const showTagDiff = useUiStore((state) => state.showTagDiff);
  const setShowTagDiff = useUiStore((state) => state.setShowTagDiff);
  const showHints = useUiStore((state) => state.showHints);
  const setShowHints = useUiStore((state) => state.setShowHints);

  return (
    <div className="sheet settings-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div><h2>{generation ? "생성 설정" : "앱 설정"}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="설정 닫기">↓</button>
      </div>

      <div className="settings-body">
        {!generation && (
        <section>
          <h3>NovelAI</h3>
          {status === "error" && <p className="connection-error">{message}</p>}
          <div className="token-row">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={status === "connected" ? "토큰 저장됨" : "Persistent API Token"}
              disabled={status === "connected"}
            />
            {status === "connected" ? (
              <button onClick={() => void disconnect()}>Disconnect</button>
            ) : (
              <button onClick={() => void connect()} disabled={status === "testing"}>
                {status === "testing" ? "…" : "Connect"}
              </button>
            )}
          </div>
        </section>
        )}

        {generation && (<>
        <section>
          <h3>Model</h3>
          <div className="segmented">
            {V5_MODELS.map((model) => (
              <button
                className={settings.model === model.value ? "active" : ""}
                key={model.value}
                onClick={() => setSetting("model", model.value)}
              >
                {model.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Resolution</h3>

          <div className="resolution-group-label">Normal</div>
          <div className="resolution-grid">
            {normalResolutions.map(([label, width, height]) => (
              <button
                className={settings.width === width && settings.height === height ? "active" : ""}
                key={label}
                onClick={() => {
                  setSetting("width", width);
                  setSetting("height", height);
                }}
              >
                <strong>{label}</strong>
                <span>{width}×{height}</span>
              </button>
            ))}
          </div>

          <div className="resolution-group-label large">Large · Anlas 사용</div>
          <div className="resolution-grid large-resolution-grid">
            {largeResolutions.map(([label, width, height]) => (
              <button
                className={settings.width === width && settings.height === height ? "active" : ""}
                key={label}
                onClick={() => {
                  setSetting("width", width);
                  setSetting("height", height);
                }}
              >
                <strong>{label}</strong>
                <span>{width}×{height}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setting-grid">
          <label>
            Steps
            <input type="number" min={1} max={50} value={settings.steps} onChange={(event) => setSetting("steps", Number(event.target.value))} />
          </label>
          <label>
            Guidance
            <input type="number" step=".1" value={settings.guidance} onChange={(event) => setSetting("guidance", Number(event.target.value))} />
          </label>
          <label>
            CFG Rescale
            <input type="number" step=".05" value={settings.guidanceRescale} onChange={(event) => setSetting("guidanceRescale", Number(event.target.value))} />
          </label>
          <label>
            Seed
            <input type="number" placeholder="Random" value={settings.seed ?? ""} onChange={(event) => setSetting("seed", event.target.value === "" ? null : Number(event.target.value))} />
          </label>
        </section>

        <section>
          <h3>Sampler</h3>
          <select value={settings.sampler} onChange={(event) => setSetting("sampler", event.target.value)}>
            {SAMPLERS.map((sampler) => <option key={sampler.value} value={sampler.value}>{sampler.label}</option>)}
          </select>
        </section>
        </>)}

        {!generation && (<>
        <section>
          <h3>저장 형식</h3>
          <div className="segmented">
            <button className={saveFormat === "webp" ? "active" : ""} aria-pressed={saveFormat === "webp"} onClick={() => setSaveFormat("webp")}>
              WebP (용량 작게)
            </button>
            <button className={saveFormat === "png" ? "active" : ""} aria-pressed={saveFormat === "png"} onClick={() => setSaveFormat("png")}>
              PNG (원본 그대로)
            </button>
          </div>
        </section>

        <section>
          <h3>화면 도움말</h3>
          <label className="help-toggle">
            <span>직전 대비 표시<small>직전 생성과 달라진 태그 수 (+N −N)</small></span>
            <input type="checkbox" checked={showTagDiff} onChange={(event) => setShowTagDiff(event.target.checked)} />
          </label>
          <label className="help-toggle">
            <span>조작 안내 문구 표시<small>편집기와 캐릭터 탭의 설명 문구</small></span>
            <input type="checkbox" checked={showHints} onChange={(event) => setShowHints(event.target.checked)} />
          </label>
        </section>

        <TranslationSettings />

        <BackupSection />
        </>)}
      </div>
    </div>
  );
}
