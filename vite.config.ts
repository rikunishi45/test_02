import { defineConfig } from "vite";

// React プラグインは入れていない。esbuild が tsconfig の jsx: "react-jsx" を見て
// JSX を変換するので、ビルド自体はプラグイン無しで通る。
// 失うのは Fast Refresh（編集時に状態を保ったまま更新する機能）だけで、
// 代わりにページ全体が再読み込みされる。ローカル用途では実害が無く、
// @vitejs/plugin-react が Babel の peer 依存で解決できなかったため入れていない。
export default defineConfig({
  server: {
    port: 5173,
  },
});
