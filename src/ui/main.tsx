import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// IndexedDB は永続保証が無く、ストレージ逼迫時にブラウザが退避することがある。
// 明示的に永続化を要求しておく（拒否されても動作は続く）。
void navigator.storage?.persist?.();

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root が見つからない");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
