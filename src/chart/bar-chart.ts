import { clampNumber } from "../clamp-number.js";

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarChartOptions {
  /** 描画領域の幅 */
  width: number;
  /** 描画領域の高さ。値 `max` の棒がこの高さになる */
  height: number;
  /** 棒と棒の間隔 */
  gap: number;
  /** 縦軸の上限。`niceScale` の `max` を渡す */
  max: number;
}

export interface Scale {
  /** 縦軸の上限。必ず `ticks` の末尾と一致し、0 より大きい */
  max: number;
  /** 目盛り値。0 から `max` まで等間隔。昇順 */
  ticks: number[];
}

/**
 * 値の最大。空配列なら 0 を返す（`niceScale` が上限 1 の目盛りを返す）。
 *
 * `Math.max(...values)` を使わない。空配列で `-Infinity` になり、
 * 要素数が多いと引数の展開でスタックを壊す。
 */
export function maxOf(values: readonly number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

/** 1・2・5 の倍数 × 10^n のうち、`value` 以上で最小のもの */
function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

/**
 * 縦軸の目盛りを決める。
 *
 * **上限を切り上げてから等分するのではなく、刻み幅を先に切りのいい数にする。**
 * 上限を先に決めると、たとえば 41,000 → 上限 50,000 → 4等分で 12,500 刻みになり、
 * 目盛りが 1.3万 / 2.5万 / 3.8万 という読めない値になる。刻みを先に 10,000 と
 * 決めれば、上限は 50,000、目盛りは 1万 / 2万 / 3万 / 4万 / 5万 になる。
 *
 * `divisions` は目安。刻みを切りのいい数に丸めた結果、実際の本数は前後する。
 *
 * **`maxValue` が 0 以下のときは上限 1 の目盛りを返す。** 上限が 0 だと棒の高さが
 * 0 除算になり、全部の棒が NaN で消える。取引が1件も無い月は普通に起きる。
 */
export function niceScale(maxValue: number, divisions: number): Scale {
  const targetDivisions = Math.max(1, Math.floor(divisions));

  if (!(maxValue > 0)) {
    return { max: 1, ticks: [0, 1] };
  }

  const step = niceCeil(maxValue / targetDivisions);
  const actualDivisions = Math.max(1, Math.ceil(maxValue / step));
  const max = step * actualDivisions;

  const ticks: number[] = [];
  for (let index = 0; index <= actualDivisions; index += 1) {
    ticks.push(step * index);
  }

  return { max, ticks };
}

/**
 * 値を棒の高さに直す。`max` が 0 以下でも 0 除算にならない。
 *
 * 正でない結果は必ず `+0` にする。負の値に `scale` 0 を掛けると `-0` になり、
 * `clampNumber` は下限違反と見なさない（`-0 < 0` は偽）のでそのまま通る。
 * `-0` が幅や高さとして残ると、そこから計算した値にも伝播する。
 */
function barHeightOf(value: number, max: number, height: number): number {
  const scale = max > 0 ? height / max : 0;
  const scaled = value * scale;
  if (!(scaled > 0)) {
    return 0;
  }
  return clampNumber(scaled, 0, height);
}

/**
 * 棒グラフの矩形を並べる。原点は左上（SVGの座標系）。
 *
 * 棒の幅は間隔を除いた残りの等分。間隔が広すぎて幅が負になる場合は 0 にする
 * （負の幅は SVG では描画されない）。
 *
 * 高さは `0`〜`height` に収める。`max` を超える値を渡されたときに描画領域から
 * はみ出さないため。`niceScale` を通していれば起きないが、はみ出した棒は
 * 隣の要素の上に重なって描画され、原因が追いにくい。
 */
export function layoutBars(values: readonly number[], options: BarChartOptions): BarRect[] {
  const { width, height, gap, max } = options;

  if (values.length === 0) {
    return [];
  }

  const totalGap = gap * (values.length - 1);
  const barWidth = Math.max(0, (width - totalGap) / values.length);

  return values.map((value, index) => {
    const barHeight = barHeightOf(value, max, height);
    return {
      x: index * (barWidth + gap),
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
}

/** 目盛り値・棒の値を、描画領域の上からの位置（y座標）に変換する */
export function yOf(value: number, max: number, height: number): number {
  return height - barHeightOf(value, max, height);
}
