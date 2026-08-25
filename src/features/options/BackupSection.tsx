import { useState } from "react";
import {
  chooseBackupFile,
  exportFullBackup,
  previewBackup,
  restoreFullBackup,
  type NaiBackup,
} from "../../services/backup";
import "./backup.css";

export function BackupSection() {
  const [includeToken, setIncludeToken] = useState(false);
  const [pending, setPending] = useState<NaiBackup | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = pending ? previewBackup(pending) : null;

  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const target = await exportFullBackup(includeToken);
      if (target) setMessage("전체 백업을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseBackup = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const backup = await chooseBackupFile();
      if (backup) setPending(backup);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await restoreFullBackup(pending);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <section className="backup-section">
      <h3>데이터 관리</h3>
      <p className="backup-description">프롬프트, 생성 설정, 태그 즐겨찾기, 캐릭터 도감, 태그사전 개인 데이터를 하나의 JSON으로 백업합니다.</p>

      <label className="backup-token-option">
        <input type="checkbox" checked={includeToken} onChange={(event) => setIncludeToken(event.target.checked)} />
        <span>
          <strong>NovelAI 토큰도 백업</strong>
          <small>켜면 토큰이 백업 JSON 안에 포함됩니다. 기본값은 꺼짐입니다.</small>
        </span>
      </label>

      <div className="backup-actions">
        <button type="button" disabled={busy} onClick={() => void exportBackup()}>전체 백업 내보내기</button>
        <button type="button" disabled={busy} onClick={() => void chooseBackup()}>백업 불러오기</button>
      </div>

      {message && <p className="backup-message">{message}</p>}

      {preview && (
        <div className="backup-preview">
          <div className="backup-preview-head">
            <strong>복원할 백업</strong>
            <span>{new Date(preview.createdAt).toLocaleString()}</span>
          </div>
          <div className="backup-summary-grid">
            <span>생성 설정</span><b>{preview.generationSettings ? "포함" : "없음"}</b>
            <span>프롬프트 섹션</span><b>{preview.promptSections}</b>
            <span>캐릭터 프롬프트</span><b>{preview.activeCharacters}</b>
            <span>태그 즐겨찾기</span><b>{preview.favoriteTags}</b>
            <span>캐릭터 도감</span><b>{preview.characterSeries} 시리즈 / {preview.characterCount}명</b>
            <span>Quick Copy</span><b>{preview.quickCopyArtists} 작가 / {preview.quickCopyTags} 태그</b>
            <span>NovelAI 토큰</span><b>{preview.includesToken ? "포함" : "현재 토큰 유지"}</b>
          </div>
          <p>전체 복원을 누르면 현재 앱 개인화 데이터를 이 백업으로 교체하고 앱을 다시 엽니다.</p>
          <div className="backup-preview-actions">
            <button type="button" onClick={() => setPending(null)}>취소</button>
            <button type="button" className="restore" disabled={busy} onClick={() => void restoreBackup()}>전체 복원</button>
          </div>
        </div>
      )}
    </section>
  );
}
