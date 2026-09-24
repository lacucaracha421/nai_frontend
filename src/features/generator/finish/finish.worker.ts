/// Web Worker entry for the finish filter (loaded with `new Worker(new URL(...), { type: "module" })`).
import { handleFinishRequest, type FinishRequest, type FinishResponse } from "./finishProtocol";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FinishRequest>) => void) | null;
  postMessage(message: FinishResponse, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const response = handleFinishRequest(event.data);
  scope.postMessage(response, response.ok ? [response.data] : []);
};
