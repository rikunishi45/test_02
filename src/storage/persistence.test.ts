import { describe, it, expect, vi } from "vitest";
import { requestPersistence, type PersistenceState } from "./persistence.js";

/** 仕様で定義された3つの状態。戻り値がこの集合から出ないことの検査に使う */
const ALL_STATES: readonly PersistenceState[] = ["persisted", "denied", "unsupported"];

/**
 * 偽物の StorageManager。navigator には触らず、引数で渡せる設計を利用する。
 * StorageManager は persist 以外のメソッドも持つが、この関数が使うのは persist だけ
 * なので、型を通すためだけにキャストする。
 */
function storageOf(persist: () => Promise<boolean>): StorageManager {
  return { persist } as unknown as StorageManager;
}

/** persist が関数でない（あるいは持たない）オブジェクトを作る */
function storageWith(persist: unknown): StorageManager {
  return { persist } as unknown as StorageManager;
}

function storageWithoutPersistProperty(): StorageManager {
  return {} as unknown as StorageManager;
}

function resolvingPersist(value: boolean) {
  return vi.fn(() => Promise.resolve(value));
}

/** 解決のタイミングをテスト側で決められる persist */
function deferredPersist() {
  let resolvePersist!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    resolvePersist = resolve;
  });
  return { persist: vi.fn(() => pending), resolve: resolvePersist };
}

/** 待機中の Promise が解決していないことを見るために、マイクロタスクを何段か進める */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("requestPersistence", () => {
  describe("permission が得られたとき", () => {
    it('persist() が true に解決すると "persisted" を返す', async () => {
      const persist = resolvingPersist(true);

      await expect(requestPersistence(storageOf(persist))).resolves.toBe("persisted");
    });

    it("persist() はちょうど1回だけ呼ばれる", async () => {
      const persist = resolvingPersist(true);

      await requestPersistence(storageOf(persist));

      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  describe("permission が拒まれたとき", () => {
    it('persist() が false に解決すると "denied" を返す', async () => {
      const persist = resolvingPersist(false);

      await expect(requestPersistence(storageOf(persist))).resolves.toBe("denied");
    });

    it("拒まれた場合も persist() はちょうど1回だけ呼ばれる（再試行しない）", async () => {
      const persist = resolvingPersist(false);

      await requestPersistence(storageOf(persist));

      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  describe("storage が無いとき", () => {
    it('undefined を渡すと "unsupported" を返す', async () => {
      await expect(requestPersistence(undefined)).resolves.toBe("unsupported");
    });

    it("undefined を渡しても例外にならず、Promise として解決する", async () => {
      const result = requestPersistence(undefined);

      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBe("unsupported");
    });
  });

  describe("persist が関数でないとき", () => {
    it('persist プロパティを持たないオブジェクトでは "unsupported" を返す', async () => {
      await expect(requestPersistence(storageWithoutPersistProperty())).resolves.toBe(
        "unsupported",
      );
    });

    it('persist が undefined のとき "unsupported" を返す', async () => {
      await expect(requestPersistence(storageWith(undefined))).resolves.toBe("unsupported");
    });

    // 関数でない値を呼び出そうとすると TypeError になる。例外を投げずに
    // "unsupported" へ落ちることが要点なので、値の種類ごとに検査する
    const NOT_FUNCTIONS: readonly [string, unknown][] = [
      ["null", null],
      ["数値 0", 0],
      ["数値 1", 1],
      ["空文字列", ""],
      ['文字列 "persist"', "persist"],
      ["true", true],
      ["false", false],
      ["空オブジェクト", {}],
      ["配列", []],
      ["call を持つだけのオブジェクト", { call: () => Promise.resolve(true) }],
    ];

    it.each(NOT_FUNCTIONS)('persist が %s のとき、例外を投げず "unsupported" を返す', async (_name, value) => {
      await expect(requestPersistence(storageWith(value))).resolves.toBe("unsupported");
    });
  });

  describe("戻り値", () => {
    const RETURN_CASES: readonly [string, () => StorageManager][] = [
      ["true に解決する persist", () => storageOf(resolvingPersist(true))],
      ["false に解決する persist", () => storageOf(resolvingPersist(false))],
      ["persist を持たない storage", () => storageWithoutPersistProperty()],
    ];

    it.each(RETURN_CASES)("%s でも Promise を返す", async (_name, makeStorage) => {
      const result = requestPersistence(makeStorage());

      expect(result).toBeInstanceOf(Promise);
      expect(ALL_STATES).toContain(await result);
    });

    it("3つの状態は互いに異なる文字列", async () => {
      const results = [
        await requestPersistence(storageOf(resolvingPersist(true))),
        await requestPersistence(storageOf(resolvingPersist(false))),
        await requestPersistence(undefined),
      ];

      expect(results).toEqual(["persisted", "denied", "unsupported"]);
      expect(new Set(results).size).toBe(3);
    });
  });

  /**
   * persist() の Promise を待たずに戻ると、呼び出し側は結果を判定できないまま
   * 進んでしまう。解決前後で状態が変わることを見る。
   */
  describe("persist() の解決を待つ", () => {
    it("persist() が解決するまで、戻りの Promise も解決しない", async () => {
      const { persist, resolve } = deferredPersist();
      let settled = false;

      const result = requestPersistence(storageOf(persist)).then((state) => {
        settled = true;
        return state;
      });

      await flushMicrotasks();
      expect(settled).toBe(false);
      expect(persist).toHaveBeenCalledTimes(1);

      resolve(true);
      await expect(result).resolves.toBe("persisted");
      expect(settled).toBe(true);
    });

    it("遅れて false に解決した場合も、その値が反映される", async () => {
      const { persist, resolve } = deferredPersist();

      const result = requestPersistence(storageOf(persist));
      await flushMicrotasks();
      resolve(false);

      await expect(result).resolves.toBe("denied");
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  describe("呼び出しごとに独立している", () => {
    it("同じ storage に2回要求すると、persist() は合計2回呼ばれる（結果を使い回さない）", async () => {
      const persist = resolvingPersist(true);
      const storage = storageOf(persist);

      await requestPersistence(storage);
      await requestPersistence(storage);

      expect(persist).toHaveBeenCalledTimes(2);
    });

    it("2回目に拒まれたら、2回目の結果は denied になる", async () => {
      const persist = vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const storage = storageOf(persist);

      expect(await requestPersistence(storage)).toBe("persisted");
      expect(await requestPersistence(storage)).toBe("denied");
      expect(persist).toHaveBeenCalledTimes(2);
    });
  });
});
