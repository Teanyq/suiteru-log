// 保存先の切り替え。アプリ版（Capacitor）は OS に消されにくい Preferences、Web 版は localStorage。
// どちらも失敗は例外ではなく false で返す（呼び出し側が上部に警告を出す）
export function createStore({ key, prefs = null, local = null }) {
  return {
    async load() {
      try {
        return prefs ? (await prefs.get({ key })).value ?? null : local?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async save(json) {
      try {
        if (prefs) await prefs.set({ key, value: json });
        else local.setItem(key, json);
        return true;
      } catch {
        return false;
      }
    },
  };
}
