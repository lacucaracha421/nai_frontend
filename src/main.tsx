import { isDesktopPlatform } from "./app/desktopLayout";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";
import "./styles/m3-tokens.css";
import "./styles/m3.css";
import "./features/generator/studio.css";
import "./features/generator/desktop.css";

document.documentElement.dataset.platform = isDesktopPlatform(navigator.userAgent) ? "desktop" : "android";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
