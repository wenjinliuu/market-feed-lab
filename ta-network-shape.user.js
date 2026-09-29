// ==UserScript==
// @name         TradeAlpha 请求结构诊断（仅本机）
// @namespace    https://github.com/wenjinliuu/market-feed-lab
// @version      0.1.0
// @description  仅记录 API 请求的路径、方法、字段名和状态；不记录请求值、正文或令牌
// @match        https://alpha.lxaa.top/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (window.__taShapeProbeInstalled) return;
  window.__taShapeProbeInstalled = true;

  const rows = [];
  const maxRows = 160;
  let panel;
  let counter;

  // 不保留 URL 查询参数、片段或长的动态路径段（可能含临时签名）。
  function safeEndpoint(input) {
    try {
      const url = new URL(String(input), location.href);
      if (url.hostname !== 'api.lxaa.top') return null;
      const path = url.pathname.split('/').map(part => {
        if (part.length > 36 || /^[a-f0-9-]{32,}$/i.test(part)) return ':id';
        return part;
      }).join('/');
      return url.origin + path;
    } catch (_) { return null; }
  }

  function fieldNames(body) {
    try {
      if (body == null) return [];
      if (body instanceof FormData || body instanceof URLSearchParams) {
        return [...new Set([...body.keys()].map(String))].slice(0, 40);
      }
      if (typeof body === 'string') {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.keys(parsed).slice(0, 40) : [];
      }
      if (typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
        return Object.keys(body).slice(0, 40);
      }
    } catch (_) { /* 例如非 JSON 表单：只记录请求本身 */ }
    return [];
  }

  function authKind(headers) {
    try {
      if (!headers) return '未观察到';
      const h = new Headers(headers);
      const value = h.get('authorization');
      if (!value) return '未观察到';
      const scheme = value.split(/\s+/, 1)[0];
      return /^[a-z]{2,20}$/i.test(scheme) ? scheme + '（已隐藏值）' : '有 Authorization（已隐藏值）';
    } catch (_) { return '未知'; }
  }

  function shape(data) {
    if (!data || typeof data !== 'object') return [];
    const result = { top: Object.keys(data).slice(0, 40) };
    for (const key of ['data', 'result', 'items', 'list', 'records', 'rows']) {
      const part = data[key];
      if (Array.isArray(part)) {
        result[key + '[]'] = part[0] && typeof part[0] === 'object'
          ? Object.keys(part[0]).slice(0, 40) : [];
      } else if (part && typeof part === 'object') {
        result[key] = Object.keys(part).slice(0, 40);
        for (const nested of ['items', 'list', 'records', 'rows']) {
          const arr = part[nested];
          if (Array.isArray(arr)) result[key + '.' + nested + '[]'] = arr[0] && typeof arr[0] === 'object'
            ? Object.keys(arr[0]).slice(0, 40) : [];
        }
      }
    }
    return result;
  }

  function add(row) {
    rows.push({ time: new Date().toLocaleTimeString(), ...row });
    if (rows.length > maxRows) rows.shift();
    if (counter) counter.textContent = '诊断 ' + rows.length;
    if (panel && panel.style.display !== 'none') render();
  }

  async function inspectFetchResponse(response, row) {
    row.status = response.status;
    row.type = response.headers.get('content-type')?.split(';')[0] || '';
    if (row.type.includes('json')) {
      try { row.responseFields = shape(await response.clone().json()); } catch (_) { /* ignore */ }
    }
    add(row);
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      let row;
      try {
        const endpoint = safeEndpoint(input instanceof Request ? input.url : input);
        if (endpoint) {
          row = {
            via: 'fetch', endpoint,
            method: String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
            requestFields: fieldNames(init?.body),
            authorization: authKind(init?.headers || (input instanceof Request ? input.headers : null))
          };
        }
      } catch (_) { /* never break the site's request */ }
      const promise = nativeFetch.apply(this, arguments);
      if (!row) return promise;
      return promise.then(response => {
        void inspectFetchResponse(response, row);
        return response;
      }, error => {
        add({ ...row, status: '网络错误' });
        throw error;
      });
    };
  }

  const xhr = window.XMLHttpRequest;
  if (xhr?.prototype) {
    const open = xhr.prototype.open;
    const send = xhr.prototype.send;
    const setHeader = xhr.prototype.setRequestHeader;
    xhr.prototype.open = function (method, url) {
      this.__taProbe = { endpoint: safeEndpoint(url), method: String(method).toUpperCase(), authorization: '未观察到' };
      return open.apply(this, arguments);
    };
    xhr.prototype.setRequestHeader = function (name, value) {
      if (this.__taProbe && String(name).toLowerCase() === 'authorization') {
        this.__taProbe.authorization = authKind({ authorization: value });
      }
      return setHeader.apply(this, arguments);
    };
    xhr.prototype.send = function (body) {
      const meta = this.__taProbe;
      if (meta?.endpoint) {
        const row = {
          via: 'XHR', endpoint: meta.endpoint, method: meta.method,
          requestFields: fieldNames(body), authorization: meta.authorization
        };
        this.addEventListener('loadend', () => {
          row.status = this.status;
          row.type = this.getResponseHeader('content-type')?.split(';')[0] || '';
          if (row.type.includes('json')) {
            try {
              const json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              row.responseFields = shape(json);
            } catch (_) { /* binary or unreadable response */ }
          }
          add(row);
        }, { once: true });
      }
      return send.apply(this, arguments);
    };
  }

  function output() {
    return JSON.stringify({
      note: '仅请求结构；无账号、密码、Cookie、令牌、查询参数、正文或 PDF 内容',
      page: 'alpha.lxaa.top',
      capturedAt: new Date().toISOString(),
      requests: rows
    }, null, 2);
  }

  function render() {
    const box = panel.querySelector('textarea');
    if (box) box.value = output();
  }

  function mount() {
    if (!document.body || document.getElementById('ta-shape-probe')) return;
    const root = document.createElement('div');
    root.id = 'ta-shape-probe';
    root.style.cssText = 'position:fixed;right:12px;bottom:70px;z-index:2147483647;font:14px -apple-system,BlinkMacSystemFont,sans-serif;';
    const shadow = root.attachShadow({ mode: 'closed' });
    const toggle = document.createElement('button');
    toggle.textContent = '诊断 0';
    toggle.style.cssText = 'border:0;border-radius:22px;background:#165dff;color:white;padding:10px 15px;box-shadow:0 3px 12px #0005;';
    counter = toggle;
    panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:absolute;right:0;bottom:48px;width:min(88vw,410px);height:50vh;padding:10px;box-sizing:border-box;background:white;color:#222;border:1px solid #ccc;border-radius:12px;box-shadow:0 4px 18px #0005;';
    const title = document.createElement('div');
    title.textContent = '请求结构（只保存在当前页面）';
    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.style.cssText = 'width:100%;height:calc(100% - 70px);box-sizing:border-box;font:11px monospace;margin-top:8px;';
    const copy = document.createElement('button');
    copy.textContent = '复制诊断';
    copy.addEventListener('click', async () => {
      render();
      try { await navigator.clipboard.writeText(textarea.value); }
      catch (_) { textarea.focus(); textarea.select(); document.execCommand('copy'); }
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = '复制诊断'; }, 1800);
    });
    const clear = document.createElement('button');
    clear.textContent = '清空';
    clear.style.marginLeft = '8px';
    clear.addEventListener('click', () => { rows.length = 0; counter.textContent = '诊断 0'; render(); });
    toggle.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      render();
    });
    panel.append(title, textarea, copy, clear);
    shadow.append(toggle, panel);
    document.body.append(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
