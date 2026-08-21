import { getModelLabel } from "../../adapters/novelai/models";
import { useGenerationStore } from "../../stores/generationStore";

export function GenerateWorkspace() {
  const beginning = useGenerationStore((s) => s.beginningPrompt);
  const ending = useGenerationStore((s) => s.endingPrompt);
  const settings = useGenerationStore((s) => s.settings);
  const status = useGenerationStore((s) => s.status);
  const images = useGenerationStore((s) => s.images);
  const activeImage = useGenerationStore((s) => s.activeImage);
  const setActiveImage = useGenerationStore((s) => s.setActiveImage);
  const errorMessage = useGenerationStore((s) => s.errorMessage);
  const clearError = useGenerationStore((s) => s.clearError);
  const selected = images[activeImage];

  return (
    <div className="generate-workspace">
      <div className={`preview-frame ${selected ? "has-image" : ""}`} style={{ aspectRatio: `${settings.width} / ${settings.height}` }}>
        {selected ? (
          <img className="generated-image" src={selected.dataUrl} alt={`NovelAI generation ${activeImage + 1}`} />
        ) : (
          <div className="preview-placeholder">
            <div className={`preview-mark ${status === "generating" ? "spinning" : ""}`}>NAI</div>
            <strong>{status === "generating" ? "Generating with NovelAI…" : "Generation preview"}</strong>
            <p>{status === "generating" ? "요청을 전송했고 결과를 기다리는 중이랍니다." : "Options에서 NovelAI 토큰을 연결한 뒤 Generate를 누르면 결과가 여기에 표시되와요."}</p>
            <div className="preview-prompt">{beginning} {ending}</div>
            <div className="preview-meta">{getModelLabel(settings.model)} · {settings.width}×{settings.height} · {settings.steps} steps</div>
          </div>
        )}

        {errorMessage && (
          <div className="generation-error">
            <strong>NovelAI request failed</strong>
            <p>{errorMessage}</p>
            <button onClick={clearError}>닫기</button>
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="image-switcher">
          {images.map((image, index) => (
            <button className={index === activeImage ? "active" : ""} onClick={() => setActiveImage(index)} key={`${image.index}-${index}`}>
              {index + 1}{image.seed !== null ? <small>seed {image.seed}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
