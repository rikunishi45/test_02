import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// 永続化の要求はここではなく usePersistence（App 内）が行う。ここで投げ捨てると
// 戻り値を誰も見ず、拒否されたことがユーザーに伝わらない——それが実際に起きた。

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root が見つからない");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
