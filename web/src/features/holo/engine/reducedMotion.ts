/*
 * 減少動態效果（prefers-reduced-motion）的唯一來源。
 * 只在建構時讀一次 mql.matches，之後只由 change 事件更新：不能每幀去讀 mql.matches——
 * 實測 Chrome 裡每幀讀取會讓這個 MediaQueryList 的 change 事件不觸發，執行中切換就不生效（H1 第二輪驗證發現）。
 * 所有「是否減少動態效果」的判斷（自動緩轉、慣性、平滑追隨、閃爍、虛線流動）都問這個物件。
 */
export class ReducedMotionSource {
  private value: boolean;
  private readonly mql: MediaQueryList | null;
  private readonly subs = new Set<(reduced: boolean) => void>();

  constructor(mql: MediaQueryList | null = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null) {
    this.mql = mql;
    this.value = mql?.matches ?? false;
    mql?.addEventListener?.("change", this.onChange);
  }

  get matches(): boolean {
    return this.value;
  }

  subscribe(cb: (reduced: boolean) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  dispose(): void {
    this.mql?.removeEventListener?.("change", this.onChange);
    this.subs.clear();
  }

  private onChange = (e: { matches: boolean }) => {
    this.value = e.matches;
    for (const cb of Array.from(this.subs)) cb(this.value);
  };
}
