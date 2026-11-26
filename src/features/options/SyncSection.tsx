import { useEffect, useState } from "react";
import { isTauriRuntime } from "../../adapters/webApi";
import {
  DEFAULT_TAURI_SYNC_URL,
  getSyncServerUrl,
  getSyncStatus,
  pullRemoteState,
  pushAllLocalState,
  setSyncServerUrl,
  subscribeSyncStatus,
} from "../../services/webStateSync";

function formatSyncTime(timestamp: number | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function SyncSection() {
  const [urlInput, setUrlInput] = useState(() => getSyncServerUrl());
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => subscribeSyncStatus(() => setSyncStatus(getSyncStatus())), []);

  if (!isTauriRuntime()) return null;

  const statusText = syncStatus.state === "connected"
    ? `연결됨${syncStatus.lastSyncedAt ? ` · ${formatSyncTime(syncStatus.lastSyncedAt)}` : ""}`
    : syncStatus.state === "offline"
      ? "오프라인 (로컬 저장 사용 중)"
      : syncStatus.state === "disabled"
        ? "꺼짐"
        : "대기 중";

  const handleSaveUrl = async () => {
    setBusy(true);
    setFeedback(null);
    setSyncServerUrl(urlInput);
    if (!urlInput.trim()) {
      setFeedback("자동 동기화를 껐습니다.");
      setBusy(false);
      return;
    }
    const res = await pullRemoteState({ force: true });
    setBusy(false);
    setFeedback(
      res.ok
        ? res.changedKeys.length > 0
          ? `서버와 연결됨 · ${res.changedKeys.length}개 항목 반영`
          : "서버와 연결됨 · 이미 최신 상태입니다"
        : `연결 실패: ${res.error ?? "서버 응답 없음"}`,
    );
  };

  const handlePull = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await pullRemoteState({ force: true });
    setBusy(false);
    setFeedback(
      res.ok
        ? res.changedKeys.length > 0
          ? `서버에서 ${res.changedKeys.length}개 항목을 불러왔습니다`
          : "이미 서버와 최신 상태입니다"
        : `불러오기 실패: ${res.error ?? "서버 응답 없음"}`,
    );
  };

  const handlePush = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await pushAllLocalState();
    setBusy(false);
    setFeedback(
      res.ok
        ? `현재 기기 데이터 ${res.count}개를 서버로 보냈습니다`
        : `보내기 실패: ${res.error ?? "서버 응답 없음"}`,
    );
  };

  return (
    <section>
      <h3>서버 자동 동기화 · {statusText}</h3>
      <p className="backup-note">
        PC 웹과 프리셋·캐릭터 도감·프롬프트·설정을 자동 연동합니다. 비우고 저장하면 꺼집니다.
      </p>
      <div className="token-row">
        <input
          type="url"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder={DEFAULT_TAURI_SYNC_URL}
          aria-label="동기화 서버 주소"
        />
        <button type="button" disabled={busy} onClick={() => void handleSaveUrl()}>
          저장
        </button>
      </div>
      <div className="segmented" style={{ marginTop: 8 }}>
        <button type="button" disabled={busy || !syncStatus.enabled} onClick={() => void handlePull()}>
          서버에서 받기
        </button>
        <button type="button" disabled={busy || !syncStatus.enabled} onClick={() => void handlePush()}>
          서버로 보내기
        </button>
      </div>
      {feedback && <p className="backup-note" role="status" style={{ marginTop: 6 }}>{feedback}</p>}
      {!feedback && syncStatus.state === "offline" && syncStatus.lastError && (
        <p className="backup-note" style={{ marginTop: 6 }}>{syncStatus.lastError}</p>
      )}
    </section>
  );
}
