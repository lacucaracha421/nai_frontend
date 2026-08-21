import { useConnectionStore } from "../../stores/connectionStore";

export function ConnectionPanel() {
  const store = useConnectionStore();

  return (
    <section className="field-section connection-section">
      <div className="field-label-row">
        <label>NovelAI Connection</label>
        <span className={`connection-badge ${store.status}`}>{store.status}</span>
      </div>
      <div className="option-card stack connection-card">
        {!store.desktopRuntime && (
          <div className="connection-warning">
            지금은 웹 미리보기랍니다. 실제 생성은 <code>npm.cmd run tauri:dev</code> 로 앱을 실행해야 하와요.
          </div>
        )}
        {store.status !== "connected" ? (
          <>
            <input
              className="token-input"
              type="password"
              value={store.tokenInput}
              onChange={(event) => store.setTokenInput(event.target.value)}
              placeholder="Persistent API Token"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="connection-button" disabled={store.status === "testing"} onClick={() => void store.connect()}>
              {store.status === "testing" ? "Testing…" : "Connect & Test"}
            </button>
          </>
        ) : (
          <button className="connection-button secondary" onClick={() => void store.disconnect()}>Disconnect</button>
        )}
        <small className={`connection-message ${store.status}`}>{store.message}</small>
        <small className="security-note">v0.2에서는 토큰을 디스크/localStorage에 저장하지 않고 앱 종료 시 폐기하와요.</small>
      </div>
    </section>
  );
}
