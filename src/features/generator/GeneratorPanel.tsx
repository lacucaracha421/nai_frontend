const presets = [
  ["Composition", "portrait, centered composition, full body"],
  ["Camera", "low angle, dynamic perspective"],
  ["Lighting", "soft rim light, volumetric lighting"],
  ["Randomizer", "Reserved for prompt variable tools"],
];

export function GeneratorPanel() {
  return (
    <div className="sidebar-scroll">
      <section className="field-section">
        <label>Prompt helpers</label>
        <div className="helper-grid">
          {presets.map(([title, detail]) => <button className="helper-card" key={title}><strong>{title}</strong><small>{detail}</small></button>)}
        </div>
      </section>
      <div className="milestone-note">v0.1 keeps Generator intentionally light. Randomizers and prompt chunks come after the core generation flow is connected.</div>
    </div>
  );
}
