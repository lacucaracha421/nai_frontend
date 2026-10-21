import { useEffect, useState } from "react";

/** Keep the displayed image until its replacement has decoded. */
export function StageImage({ src }: { src: string }) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.src = src;
    void image.decode().then(() => {
      if (!cancelled) setReady(src);
    }).catch(() => { /* Keep the previous image if loading fails. */ });
    return () => { cancelled = true; };
  }, [src]);
  return ready ? <img src={ready} alt="" /> : null;
}
