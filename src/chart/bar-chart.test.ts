import { describe, it, expect } from "vitest";
import {
  niceScale,
  maxOf,
  layoutBars,
  yOf,
  type BarRect,
  type BarChartOptions,
} from "./bar-chart.js";

const BASE_OPTIONS: BarChartOptions = { width: 110, height: 100, gap: 10, max: 1000 };

function optionsOf(overrides: Partial<BarChartOptions> = {}): BarChartOptions {
  return { ...BASE_OPTIONS, ...overrides };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`index ${index} の要素が存在しない（length=${items.length}）`);
  }
  return item;
}

function stepsOf(ticks: readonly number[]): number[] {
  return ticks.slice(1).map((tick, index) => tick - at(ticks, index));
}

function expectFiniteRect(rect: BarRect): void {
  expect([
    Number.isFinite(rect.x),
    Number.isFinite(rect.y),
    Number.isFinite(rect.width),
    Number.isFinite(rect.height),
  ]).toEqual([true, true, true, true]);
}

describe("niceScale", () => {
  describe("刻み幅が切りのいい数になる（具体値）", () => {
    it("41000 を 5 等分すると、10000 刻みで上限 50000 になる", () => {
      expect(niceScale(41000, 5)).toEqual({
        max: 50000,
        ticks: [0, 10000, 20000, 30000, 40000, 50000],
      });
    });

    it("1590 を 5 等分すると、500 刻みで上限 2000 になる（本数は 4 本）", () => {
      expect(niceScale(1590, 5)).toEqual({ max: 2000, ticks: [0, 500, 1000, 1500, 2000] });
    });

    it("100 を 5 等分すると、20 刻みで上限 100 になる", () => {
      expect(niceScale(100, 5)).toEqual({ max: 100, ticks: [0, 20, 40, 60, 80, 100] });
    });

    it("7 を 5 等分すると、2 刻みで上限 8 になる", () => {
      expect(niceScale(7, 5)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    });

    it("実測値が刻みの倍数ちょうどのとき、上限を余分に持ち上げない", () => {
      expect(niceScale(50000, 5)).toEqual({
        max: 50000,
        ticks: [0, 10000, 20000, 30000, 40000, 50000],
      });
    });

    it("999999 を 5 等分すると、200000 刻みで上限 1000000 になる", () => {
      expect(niceScale(999999, 5)).toEqual({
        max: 1000000,
        ticks: [0, 200000, 400000, 600000, 800000, 1000000],
      });
    });
  });

  describe("10 の冪ちょうどのとき、余計な桁が増えない", () => {
    it.each([10, 100, 1000, 10000, 100000])("maxValue=%d のとき max はその値のまま", (value) => {
      expect(niceScale(value, 5).max).toBe(value);
    });
  });

  describe("maxValue が 0 以下のとき", () => {
    it("0 のとき、max 1・ticks [0, 1] を返す（0 除算で棒が消えるのを防ぐ）", () => {
      expect(niceScale(0, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("-0 のとき、max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(-0, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("負の値のとき、max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(-41000, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("小さな負の値のとき、max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(-0.5, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("NaN のとき、max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(NaN, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("-Infinity のとき、max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(-Infinity, 5)).toEqual({ max: 1, ticks: [0, 1] });
    });

    it("divisions が何であっても、0 以下なら max 1・ticks [0, 1] を返す", () => {
      expect(niceScale(0, 12)).toEqual({ max: 1, ticks: [0, 1] });
    });
  });

  describe("divisions の扱い", () => {
    it("divisions が 1 のとき、目盛りは 0 と max の 2 本だけになる", () => {
      expect(niceScale(41000, 1).ticks).toHaveLength(2);
    });

    it("divisions が 0 のとき、1 として扱う", () => {
      expect(niceScale(41000, 0)).toEqual(niceScale(41000, 1));
    });

    it("divisions が負のとき、1 として扱う", () => {
      expect(niceScale(41000, -5)).toEqual(niceScale(41000, 1));
    });

    it("divisions が 0 以上 1 未満の小数のとき、1 として扱う", () => {
      expect(niceScale(41000, 0.5)).toEqual(niceScale(41000, 1));
    });

    it("divisions が小数のとき、切り捨てた整数として扱う", () => {
      expect(niceScale(41000, 2.9)).toEqual(niceScale(41000, 2));
    });

    it("divisions が 1 のすぐ上の小数のとき、1 として扱う", () => {
      expect(niceScale(1590, 1.9)).toEqual(niceScale(1590, 1));
    });

    it("divisions を増やすと、目盛りの本数は減らない", () => {
      const few = niceScale(41000, 2).ticks.length;
      const many = niceScale(41000, 10).ticks.length;

      expect(many).toBeGreaterThanOrEqual(few);
    });
  });

  describe("常に満たす性質", () => {
    const cases = [1, 3, 7, 12, 99, 100, 101, 1590, 41000, 50000, 123456, 999999, 0.5, 2.5].flatMap(
      (maxValue) =>
        [1, 2, 4, 5, 10].map((divisions) => ({ maxValue, divisions })),
    );

    it.each(cases)(
      "maxValue=$maxValue / divisions=$divisions で、0 始まり・等間隔・上限が実測値以上",
      ({ maxValue, divisions }) => {
        const scale = niceScale(maxValue, divisions);
        const steps = stepsOf(scale.ticks);

        expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
        expect(at(scale.ticks, 0)).toBe(0);
        expect(at(scale.ticks, scale.ticks.length - 1)).toBeCloseTo(scale.max);
        expect(scale.max).toBeGreaterThanOrEqual(maxValue);
        expect(scale.max).toBeGreaterThan(0);
        expect(at(steps, 0)).toBeGreaterThan(0);
        for (const step of steps) {
          expect(step).toBeCloseTo(at(steps, 0));
        }
        expect(scale.ticks.every((tick) => Number.isFinite(tick))).toBe(true);
      },
    );

    it.each(cases)(
      "maxValue=$maxValue / divisions=$divisions で、区間の数が divisions を超えない",
      ({ maxValue, divisions }) => {
        expect(niceScale(maxValue, divisions).ticks.length - 1).toBeLessThanOrEqual(divisions);
      },
    );
  });
});

describe("layoutBars", () => {
  describe("空の入力", () => {
    it("values が空なら、空配列を返す", () => {
      expect(layoutBars([], optionsOf())).toEqual([]);
    });

    it("values が空で max が 0 でも、空配列を返す（NaN を含む要素を作らない）", () => {
      expect(layoutBars([], optionsOf({ max: 0 }))).toEqual([]);
    });
  });

  describe("本数と順序", () => {
    it("戻り値の長さは values と同じになる", () => {
      expect(layoutBars([1, 2, 3, 4], optionsOf())).toHaveLength(4);
    });

    it("戻り値は values の順序に対応する（値の大小で並べ替えない）", () => {
      const rects = layoutBars([1000, 0, 500], optionsOf());

      expect(rects.map((rect) => rect.height)).toEqual([100, 0, 50]);
    });
  });

  describe("棒の幅と x 座標", () => {
    it("幅は (width - gap * (本数 - 1)) / 本数 になる", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 110, gap: 10 }));

      expect(rects.map((rect) => rect.width)).toEqual([30, 30, 30]);
    });

    it("gap が 0 のとき、幅は width を本数で割った値になる", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 90, gap: 0 }));

      expect(rects.map((rect) => rect.width)).toEqual([30, 30, 30]);
    });

    it("x は index * (幅 + gap) になる", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 110, gap: 10 }));

      expect(rects.map((rect) => rect.x)).toEqual([0, 40, 80]);
    });

    it("隣接する棒の x の差は、幅 + gap と等しい", () => {
      const options = optionsOf({ width: 97, gap: 3 });
      const rects = layoutBars([1, 2, 3, 4, 5], options);
      const expected = at(rects, 0).width + options.gap;

      for (let index = 1; index < rects.length; index += 1) {
        expect(at(rects, index).x - at(rects, index - 1).x).toBeCloseTo(expected);
      }
    });

    it("最初の棒の x は 0 になる", () => {
      expect(at(layoutBars([1, 2, 3], optionsOf()), 0).x).toBe(0);
    });

    it("1本のときは間隔が入らず、幅が width と一致する", () => {
      const options = optionsOf({ width: 110, gap: 10 });

      expect(layoutBars([500], options)).toEqual([
        { x: 0, y: 50, width: options.width, height: 50 },
      ]);
    });

    it("gap の合計が width と等しいとき、幅は 0 になる", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 20, gap: 10 }));

      expect(rects.map((rect) => rect.width)).toEqual([0, 0, 0]);
    });

    it("幅が負になる配置では、幅を 0 にする", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 10, gap: 10 }));

      expect(rects.map((rect) => rect.width)).toEqual([0, 0, 0]);
    });

    it("幅が 0 に丸められても、x は index * (0 + gap) になる", () => {
      const rects = layoutBars([1, 2, 3], optionsOf({ width: 10, gap: 10 }));

      expect(rects.map((rect) => rect.x)).toEqual([0, 10, 20]);
    });

    it("width が 0 のとき、幅は 0 になり NaN にならない", () => {
      const rects = layoutBars([1, 2], optionsOf({ width: 0, gap: 0 }));

      expect(rects.map((rect) => rect.width)).toEqual([0, 0]);
    });
  });

  describe("棒の高さ", () => {
    it("値が 0 のとき、高さは 0 になる", () => {
      expect(at(layoutBars([0], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(0);
    });

    it("値が max と等しいとき、高さは height と一致する", () => {
      expect(at(layoutBars([1000], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(100);
    });

    it("値が max の半分のとき、高さは height の半分になる", () => {
      expect(at(layoutBars([500], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(50);
    });

    it("値が max を超えても、高さは height を超えない", () => {
      expect(at(layoutBars([5000], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(100);
    });

    it("値が max のすぐ上でも、高さは height でクランプされる", () => {
      expect(at(layoutBars([1001], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(100);
    });

    it("値が負のとき、高さは 0 になる", () => {
      expect(at(layoutBars([-500], optionsOf({ max: 1000, height: 100 })), 0).height).toBe(0);
    });

    it("高さは常に 0 以上 height 以下に収まる", () => {
      const options = optionsOf({ max: 1000, height: 100 });
      const rects = layoutBars([-1e9, -1, 0, 1, 499, 500, 999, 1000, 1001, 1e9], options);

      for (const rect of rects) {
        expect(rect.height).toBeGreaterThanOrEqual(0);
        expect(rect.height).toBeLessThanOrEqual(options.height);
      }
    });
  });

  describe("y 座標（棒は下端に揃う）", () => {
    it("値が 0 のとき、y は height と一致する", () => {
      expect(at(layoutBars([0], optionsOf({ max: 1000, height: 100 })), 0).y).toBe(100);
    });

    it("値が max と等しいとき、y は 0 になる", () => {
      expect(at(layoutBars([1000], optionsOf({ max: 1000, height: 100 })), 0).y).toBe(0);
    });

    it("値が max の半分のとき、y は height の半分になる", () => {
      expect(at(layoutBars([500], optionsOf({ max: 1000, height: 100 })), 0).y).toBe(50);
    });

    it("どの棒でも y + 高さ が描画領域の高さと等しい", () => {
      const options = optionsOf({ max: 1000, height: 100 });
      const rects = layoutBars([-500, 0, 1, 500, 1000, 4000], options);

      for (const rect of rects) {
        expect(rect.y + rect.height).toBeCloseTo(options.height);
      }
    });
  });

  describe("max が 0 以下のとき（0 除算を避ける）", () => {
    it("max が 0 のとき、すべての高さが 0 になる", () => {
      const rects = layoutBars([0, 1, 1000, -1000], optionsOf({ max: 0, height: 100 }));

      expect(rects.map((rect) => rect.height)).toEqual([0, 0, 0, 0]);
    });

    it("max が 0 のとき、すべての y が height と一致する", () => {
      const rects = layoutBars([0, 1, 1000, -1000], optionsOf({ max: 0, height: 100 }));

      expect(rects.map((rect) => rect.y)).toEqual([100, 100, 100, 100]);
    });

    it("max が 0 のとき、NaN も Infinity も混ざらない", () => {
      const rects = layoutBars([0, 1, 1000, -1000], optionsOf({ max: 0 }));

      for (const rect of rects) {
        expectFiniteRect(rect);
      }
    });

    it("max が負のとき、すべての高さが 0 になる", () => {
      const rects = layoutBars([1, 1000], optionsOf({ max: -100, height: 100 }));

      expect(rects.map((rect) => rect.height)).toEqual([0, 0]);
    });

    it("max が負のとき、NaN も Infinity も混ざらない", () => {
      for (const rect of layoutBars([1, 1000], optionsOf({ max: -100 }))) {
        expectFiniteRect(rect);
      }
    });
  });

  describe("結果に NaN / Infinity を含まない", () => {
    it("通常の入力で、すべての値が有限になる", () => {
      for (const rect of layoutBars([0, 250, 1000, 2000, -50], optionsOf())) {
        expectFiniteRect(rect);
      }
    });

    it("幅が 0 に丸められる配置でも、すべての値が有限になる", () => {
      for (const rect of layoutBars([1, 2, 3], optionsOf({ width: 0, gap: 10 }))) {
        expectFiniteRect(rect);
      }
    });
  });
});

describe("yOf", () => {
  describe("値から上端からの位置への変換", () => {
    it("値が 0 のとき、height を返す（下端）", () => {
      expect(yOf(0, 1000, 100)).toBe(100);
    });

    it("値が max と等しいとき、0 を返す（上端）", () => {
      expect(yOf(1000, 1000, 100)).toBe(0);
    });

    it("値が max の半分のとき、height の半分を返す", () => {
      expect(yOf(500, 1000, 100)).toBe(50);
    });

    it("値が max の 1/4 のとき、height の 3/4 を返す", () => {
      expect(yOf(250, 1000, 100)).toBe(75);
    });
  });

  describe("クランプ", () => {
    it("値が max を超えるとき、0 を返す", () => {
      expect(yOf(5000, 1000, 100)).toBe(0);
    });

    it("値が max のすぐ上でも、0 を返す", () => {
      expect(yOf(1001, 1000, 100)).toBe(0);
    });

    it("値が負のとき、height を返す", () => {
      expect(yOf(-1, 1000, 100)).toBe(100);
    });

    it("値が大きく負でも、height を返す", () => {
      expect(yOf(-1e9, 1000, 100)).toBe(100);
    });
  });

  describe("max が 0 以下のとき（0 除算を避ける）", () => {
    it("max が 0 のとき、height を返す", () => {
      expect(yOf(0, 0, 100)).toBe(100);
    });

    it("max が 0 で値が正のとき、height を返す（NaN や Infinity にしない）", () => {
      expect(yOf(500, 0, 100)).toBe(100);
    });

    it("max が負のとき、height を返す", () => {
      expect(yOf(500, -100, 100)).toBe(100);
    });

    it("max が 0 以下のとき、結果は有限になる", () => {
      expect([yOf(500, 0, 100), yOf(500, -1, 100)].every(Number.isFinite)).toBe(true);
    });
  });

  describe("layoutBars との整合", () => {
    it.each([
      { value: 0, max: 1000 },
      { value: 250, max: 1000 },
      { value: 500, max: 1000 },
      { value: 1000, max: 1000 },
      { value: 4000, max: 1000 },
      { value: -300, max: 1000 },
      { value: 500, max: 0 },
      { value: 500, max: -10 },
    ])("value=$value / max=$max で、yOf が layoutBars の y と一致する", ({ value, max }) => {
      const options = optionsOf({ max, height: 100 });

      expect(yOf(value, max, options.height)).toBe(at(layoutBars([value], options), 0).y);
    });
  });
});

describe("maxOf", () => {
  it("空配列は 0（Math.max(...[]) の -Infinity にならない）", () => {
    expect(maxOf([])).toBe(0);
  });

  it("空配列の結果を niceScale に渡しても上限が正のまま", () => {
    expect(niceScale(maxOf([]), 5).max).toBeGreaterThan(0);
  });

  it.each([
    [[5], 5],
    [[1, 9, 3], 9],
    [[9, 1, 3], 9],
    [[3, 3, 3], 3],
  ])("%j の最大は %i", (values, expected) => {
    expect(maxOf(values)).toBe(expected);
  });

  it("全部が負なら 0（下限は 0）", () => {
    expect(maxOf([-5, -1, -100])).toBe(0);
  });

  it("引数の配列を書き換えない", () => {
    const values = [3, 1, 2];
    maxOf(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("要素数が多くてもスタックを壊さない（引数展開を使っていない）", () => {
    const values = Array.from({ length: 200_000 }, (_, index) => index);
    expect(maxOf(values)).toBe(199_999);
  });
});
