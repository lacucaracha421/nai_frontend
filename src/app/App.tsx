import { useEffect } from "react";
import { V5Studio } from "../features/generator/V5Studio";
import { useConnectionStore } from "../stores/connectionStore";

export function App() {
  const restoreConnection = useConnectionStore((state) => state.restore);

  useEffect(() => {
    void restoreConnection();
  }, [restoreConnection]);

  return <V5Studio />;
}
