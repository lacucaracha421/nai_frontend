import { useGenerationStore } from "../../stores/generationStore";
import { useConnectionStore } from "../../stores/connectionStore";
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

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useGenerationStore((state) => state.settings);
  const setSetting = useGenerationStore((state) => state.setSetting);
  const token = useConnectionStore((state) => state.tokenInput);
  const setToken = useConnectionStore((state) => state.setTokenInput);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const status = useConnectionStore((state) => state.status);
  const message = useConnectionStore((state) => state.message);

  return (
    <div className="sheet settings-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div><h2>Settings</h2></div>
        <button className="icon-button" onClick={onClose}>↓</button>
      </div>

      <div className="settings-body">
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

        <TranslationSettings />

        <BackupSection />
      </div>
    </div>
  );
}
