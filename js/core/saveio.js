/* 存档导出 / 导入：打包 localStorage 中所有 kurumi-fx: 键 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  const MAGIC = 'abyss-fx-save';
  const VERSION = 1;
  const MAX_BYTES = 8 * 1024 * 1024;
  const KEY_RE = /^[a-z][a-z0-9-]{0,40}$/;
  // 已知键的类型要求；未知键只要键名合法即可原样保留
  const OBJECT_KEYS = ['settings', 'profile', 'achievements', 'flags', 'sim', 'session', 'daily-meta'];

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function collect() {
    // 用无原型对象，避免存档键名意外污染 Object.prototype
    const data = Object.create(null);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(U.store.PREFIX) !== 0) continue;
        const raw = localStorage.getItem(k);
        try {
          data[k.slice(U.store.PREFIX.length)] = raw == null ? null : JSON.parse(raw);
        } catch (_) {
          // 损坏的单条存档跳过，不影响其余数据导出
        }
      }
    } catch (err) {
      throw new Error('无法读取本地存档：' + (err && err.message ? err.message : err));
    }
    return data;
  }

  function pickAccount(data) {
    const d = data || {};
    if (isObject(d.sim) && isObject(d.sim.account)) return d.sim.account;
    if (isObject(d.session)) {
      if (isObject(d.session.battle) && isObject(d.session.battle.account)) return d.session.battle.account;
      if (isObject(d.session.challenge) && isObject(d.session.challenge.account)) return d.session.challenge.account;
    }
    return null;
  }

  const SaveIO = {
    MAGIC,
    VERSION,

    /** 打包当前全部存档为 JSON 文本 */
    build() {
      return JSON.stringify(
        {
          magic: MAGIC,
          v: VERSION,
          app: 'abyss-fx',
          exportedAt: new Date().toISOString(),
          data: collect(),
        },
        null,
        2
      );
    },

    /** 导出文件名：abyss-fx-save-YYYYMMDD-HHmm.json */
    filename(now) {
      const d = now || new Date();
      const p = U.pad2;
      return `abyss-fx-save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    },

    /** 解析并校验存档文本，失败时抛出可读错误 */
    parse(text) {
      const str = text == null ? '' : String(text);
      if (!str.trim()) throw new Error('存档内容为空');
      if (str.length > MAX_BYTES) throw new Error('存档文件过大');
      let obj;
      try {
        obj = JSON.parse(str);
      } catch (_) {
        throw new Error('不是有效的 JSON 文件');
      }
      if (!isObject(obj) || obj.magic !== MAGIC) throw new Error('不是深渊汇率的存档文件');
      if (obj.v !== VERSION) throw new Error('不支持的存档版本：' + obj.v);
      if (!isObject(obj.data)) throw new Error('存档内容损坏');
      for (const key of OBJECT_KEYS) {
        if (obj.data[key] != null && !isObject(obj.data[key])) {
          throw new Error('存档字段损坏：' + key);
        }
      }
      return obj;
    },

    /** 给确认弹窗用的摘要 */
    summary(obj) {
      const data = (obj && obj.data) || {};
      const acc = pickAccount(data);
      const unlocked = data.achievements && isObject(data.achievements.unlocked)
        ? Object.keys(data.achievements.unlocked).length
        : 0;
      const mode = data.session && data.session.mode ? String(data.session.mode) : '—';
      return {
        exportedAt: obj && obj.exportedAt ? String(obj.exportedAt) : '',
        mode,
        balance: acc && Number.isFinite(acc.balance) ? acc.balance : null,
        positions: acc && Array.isArray(acc.positions) ? acc.positions.length : 0,
        orders: acc && Array.isArray(acc.orders) ? acc.orders.length : 0,
        achievements: unlocked,
      };
    },

    /** 用备份覆盖本地存档；写入失败时回滚到导入前的状态 */
    apply(obj) {
      const entries = [];
      for (const key of Object.keys(obj.data)) {
        if (!KEY_RE.test(key)) continue;
        entries.push([key, obj.data[key]]);
      }
      if (!entries.length) throw new Error('存档中没有可导入的数据');
      const backup = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(U.store.PREFIX) === 0) backup.push([k, localStorage.getItem(k)]);
        }
        for (const [k] of backup) localStorage.removeItem(k);
        for (const [k, v] of entries) localStorage.setItem(U.store.PREFIX + k, JSON.stringify(v));
      } catch (err) {
        // 回滚，避免导入失败后存档被清空
        try {
          const written = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(U.store.PREFIX) === 0) written.push(k);
          }
          for (const k of written) localStorage.removeItem(k);
          for (const [k, v] of backup) if (v != null) localStorage.setItem(k, v);
        } catch (_) {}
        throw new Error('写入本地存档失败：' + (err && err.message ? err.message : err));
      }
    },

    /** 保存文件：优先原生壳，其次浏览器下载 */
    download(text, filename) {
      const name = filename || this.filename();
      if (window.AbyssNative && typeof window.AbyssNative.saveText === 'function') {
        window.AbyssNative.saveText(text, name);
        return 'native';
      }
      try {
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return 'browser';
      } catch (err) {
        throw new Error('无法创建下载文件：' + (err && err.message ? err.message : err));
      }
    },

    /** 原生文件选择器是否可用（Android 壳） */
    hasNativePicker() {
      return !!(window.AbyssNative && typeof window.AbyssNative.pickText === 'function');
    },

    /** 调起原生文件选择器，读取结果通过 FX.ui.onImportFileText 回调 */
    pickNative() {
      if (!this.hasNativePicker()) return false;
      window.AbyssNative.pickText();
      return true;
    },

    readFile(file) {
      return new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result == null ? '' : reader.result));
          reader.onerror = () => reject(new Error('读取文件失败'));
          reader.readAsText(file);
        } catch (err) {
          reject(new Error('读取文件失败：' + (err && err.message ? err.message : err)));
        }
      });
    },

    copy(text) {
      const str = text == null ? '' : String(text);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(str).catch(() => this._copyFallback(str));
      }
      return this._copyFallback(str);
    },

    _copyFallback(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return ok ? Promise.resolve() : Promise.reject(new Error('当前环境不支持剪贴板'));
      } catch (err) {
        return Promise.reject(new Error('复制失败：' + (err && err.message ? err.message : err)));
      }
    },
  };

  FX.SaveIO = SaveIO;
})();
