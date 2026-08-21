import { NOVELAI_MODELS, SAMPLERS } from "../../adapters/novelai/models";
import { useGenerationStore } from "../../stores/generationStore";
import { ConnectionPanel } from "./ConnectionPanel";

function Stepper({ value, onChange, step = 1 }: { value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Number((value - step).toFixed(2)))}>−</button>
      <span>{value}</span>
      <button onClick={() => onChange(Number((value + step).toFixed(2)))}>＋</button>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <div className="option-control">
      <div className="option-line"><span>{label}</span><Stepper value={value} onChange={onChange} step={step} /></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function OptionsPanel() {
  const settings = useGenerationStore((s) => s.settings);
  const setSetting = useGenerationStore((s) => s.setSetting);

  return (
    <div className="sidebar-scroll options-scroll">
      <ConnectionPanel />

      <section className="field-section">
        <label>Model</label>
        <select className="select-card" value={settings.model} onChange={(e) => setSetting("model", e.target.value)}>
          {NOVELAI_MODELS.map((model) => (
            <option value={model.value} key={model.value}>{model.label}{"experimental" in model && model.experimental ? " · experimental API id" : ""}</option>
          ))}
        </select>
        <input
          className="model-id-input"
          value={settings.model}
          onChange={(e) => setSetting("model", e.target.value)}
          spellCheck={false}
          aria-label="NovelAI API model id"
        />
        {settings.model === "nai-diffusion-5" && <small className="model-note">V5의 공개 API ID가 아직 문서에서 확인되지 않아 임시 ID를 사용하와요. 오류가 나면 이 칸에서 실제 ID로 바로 수정할 수 있답니다.</small>}
      </section>

      <section className="field-section">
        <label>Size</label>
        <div className="option-card">
          <div className="option-line"><span>Preset</span><strong>{settings.preset}</strong></div>
          <div className="option-line"><span>Width</span><Stepper value={settings.width} onChange={(v) => setSetting("width", Math.max(256, v))} step={64} /></div>
          <div className="option-line"><span>Height</span><Stepper value={settings.height} onChange={(v) => setSetting("height", Math.max(256, v))} step={64} /></div>
        </div>
      </section>

      <section className="field-section">
        <label>Quality</label>
        <div className="option-card stack">
          <SliderRow label="Steps" value={settings.steps} min={1} max={50} step={1} onChange={(v) => setSetting("steps", v)} />
          <SliderRow label="Prompt guidance" value={settings.guidance} min={0} max={10} step={0.1} onChange={(v) => setSetting("guidance", v)} />
          <SliderRow label="Prompt guidance rescale" value={settings.guidanceRescale} min={0} max={1} step={0.05} onChange={(v) => setSetting("guidanceRescale", v)} />
          <label className="toggle-row">
            <div><strong>Variety+</strong><small>V4.5에서는 알려진 threshold를 사용하며 V5에서는 아직 강제하지 않사와요.</small></div>
            <input type="checkbox" checked={settings.varietyPlus} onChange={(e) => setSetting("varietyPlus", e.target.checked)} />
          </label>
        </div>
      </section>

      <section className="field-section">
        <label>Sampling</label>
        <div className="option-card stack">
          <select className="select-card embedded" value={settings.sampler} onChange={(e) => setSetting("sampler", e.target.value)}>
            {SAMPLERS.map((sampler) => <option value={sampler.value} key={sampler.value}>{sampler.label}</option>)}
          </select>
          <select className="select-card embedded" value={settings.noiseSchedule} onChange={(e) => setSetting("noiseSchedule", e.target.value)}>
            <option value="karras">Karras</option>
            <option value="exponential">Exponential</option>
            <option value="polyexponential">Polyexponential</option>
            <option value="native">Native</option>
          </select>
        </div>
      </section>
    </div>
  );
}
