/*
 * 減少動態效果（prefers-reduced-motion）的唯一來源。
 * 只在建構時讀一次 mql.matches，之後只由 change 事件更新，不每幀去讀。
 * 成因：在本 App 實測，每幀讀 mql.matches 時引擎那個 MediaQueryList 的 change 事件沒有觸發，執行中切換就不生效（H1 第二輪驗證發現）；
 * 空白頁的最小測試不一定重現，所以不能當成瀏覽器一律如此，只是不再依賴每幀讀取。
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
