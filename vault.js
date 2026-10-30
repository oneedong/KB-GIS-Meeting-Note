/*
 * 암호화된 미팅노트 사본(data.enc.json) 열기 — AES-256-GCM, 키는 PBKDF2-SHA256으로 비밀번호에서 만든다.
 * 비밀번호 자체는 어디에도 저장하지 않는다. "이 기기에서 기억하기"를 켜면 만들어진 키만
 * 내보낼 수 없는(non-extractable) 형태로 이 기기의 IndexedDB에 둔다. 잠그기를 누르면 지운다.
 * 파일 형식은 scripts/encrypt.mjs 와 같아야 한다.
 */
const Vault = (() => {
  const DATA = "data.enc.json", IDB = "kb-gis-meeting-note", STORE = "keys", SLOT = "data";
  const el = (s) => document.querySelector(s);
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const open = indexedDB.open(IDB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => rej(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); res(req && req.result); };
        tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
      };
    });
  }
  const getKey = () => idb("readonly", (st) => st.get(SLOT)).catch(() => null);
  const putKey = (v) => idb("readwrite", (st) => st.put(v, SLOT)).catch(() => {});
  const delKey = () => idb("readwrite", (st) => st.delete(SLOT)).catch(() => {});

  async function derive(pw, env) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function decrypt(key, env) {
    // 키가 틀리면 여기서 OperationError
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(env.iv) }, key, b64(env.ct));
    let buf = pt;
    if (env.z === "gzip") {
      if (typeof DecompressionStream !== "function") throw new Error("이 브라우저는 너무 오래되어 열 수 없습니다. OS·브라우저를 업데이트해 주세요.");
      buf = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  function showGate(env, onData, note) {
    const gate = el("#gate"), form = el("#gateForm"), pw = el("#pw"), btn = el("#unlock"), msg = el("#gateMsg");
    gate.hidden = false;
    el("#gateAsof").textContent = env && env.generatedAt ? `${env.generatedAt} 기준 사본` : "";
    msg.textContent = note || "";
    if (!env) { form.querySelectorAll("input,button").forEach((x) => x.disabled = true); return; }
    setTimeout(() => pw.focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!pw.value) return;
      btn.disabled = true; msg.textContent = "여는 중…";
      try {
        const key = await derive(pw.value, env);
        const data = await decrypt(key, env);
        if (el("#remember").checked) await putKey({ key, salt: env.salt, iter: env.iter });
        else await delKey();
        pw.value = ""; msg.textContent = ""; gate.hidden = true;
        onData(data);
      } catch (err) {
        msg.textContent = err && err.name === "OperationError" ? "비밀번호가 맞지 않습니다." : "열지 못했습니다. " + ((err && err.message) || "");
        btn.disabled = false; pw.select();
      }
    };
  }

  async function boot(onData) {
    el("#lockBtn").onclick = async () => { await delKey(); location.reload(); };
    if (!(window.crypto && crypto.subtle)) return showGate(null, onData, "보안 연결(https) 주소에서만 열 수 있습니다.");
    let env;
    try {
      const r = await fetch(DATA, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      env = await r.json();
    } catch (e) {
      return showGate(null, onData, "데이터 파일을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 열어 주세요.");
    }
    const saved = await getKey();
    if (saved && saved.key && saved.salt === env.salt && saved.iter === env.iter) {
      try { onData(await decrypt(saved.key, env)); return; }
      catch (e) { await delKey(); }   // 비밀번호가 바뀐 사본 → 다시 입력
    }
    showGate(env, onData);
  }

  return { boot };
})();
