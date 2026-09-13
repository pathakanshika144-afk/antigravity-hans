#!/usr/bin/env node
/**
 * Antigravity 汉化守护进程 (hans-daemon)
 *
 * 工作原理：
 *   Antigravity 是 Electron 应用，启动时会带上 --remote-debugging-port=0，
 *   实际端口写在 %APPDATA%\Antigravity\DevToolsActivePort 里。
 *   本进程读取该端口，通过 CDP (Chrome DevTools Protocol) 连进渲染进程，
 *   把一份词典注入页面，用 TreeWalker 替换文本节点，并挂 MutationObserver
 *   在 React 重渲染后自动补刀。
 *
 * 特点：
 *   - 不修改 Antigravity 的任何文件，纯运行时注入，Ctrl+C 或关掉应用即失效
 *   - 页面重载后会自动重新注入（每 2.5 秒巡检一次）
 *   - 应用退出后本进程自行结束
 *
 * 用法：
 *   node hans-daemon.js          正常守护
 *   node hans-daemon.js --once   只注入一次就退出（调试用）
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DICT_PATH = path.join(__dirname, "hans-dict.json");
const LOG_PATH = path.join(__dirname, "hans-daemon.log");
const MISSED_PATH = path.join(__dirname, "hans-missed.json");

const ROAMING =
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const PORT_FILE = path.join(ROAMING, "Antigravity", "DevToolsActivePort");

const POLL_MS = 2500;
const MAX_MISSES = 24; // 约 60 秒够不到应用就退出
const ONCE = process.argv.includes("--once");
// 未翻译文本收集器。默认关闭 —— 打开后它会把页面上所有未命中的英文
// （可能包含你自己的对话内容和代码）写进 hans-missed.json。补词典时才开。
const COLLECT = process.argv.includes("--collect");

// ---------------------------------------------------------------- logging ---
try {
  fs.writeFileSync(LOG_PATH, "");
} catch {
  /* 日志不是关键路径，写不了就算了 */
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch {
    /* ignore */
  }
  if (process.stdout.isTTY) console.log(line);
}

// ------------------------------------------------------------------- dict ---
let DICT;
try {
  DICT = JSON.parse(fs.readFileSync(DICT_PATH, "utf8"));
} catch (e) {
  log("FATAL: 无法读取词典", DICT_PATH, "-", e.message);
  process.exit(1);
}
const DICT_SIZE = Object.keys(DICT).length;
// 注入脚本自身的版本号。改了 pageInstaller 的逻辑就 +1，否则页面会认为
// 「词典没变」而继续沿用旧脚本 —— 收集器就是这么漏掉一次的。
const PAYLOAD_VERSION = 5;
const STAMP = `${DICT_SIZE}-v${PAYLOAD_VERSION}`;
log(`词典已加载：${DICT_SIZE} 条（脚本 v${PAYLOAD_VERSION}）`);

// ------------------------------------------------------- single instance ---
// 反复双击快捷方式不该堆出一堆守护进程，用 pid 文件挡一下。
const LOCK_PATH = path.join(__dirname, 'hans-daemon.pid');
try {
    const oldPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (Number.isFinite(oldPid)) {
        try {
            process.kill(oldPid, 0); // 进程还在
            log(`已有守护进程在运行（PID ${oldPid}），本次退出`);
            process.exit(0);
        } catch (err) {
            if (err && err.code === 'EPERM') {
                log(`已有守护进程在运行（PID ${oldPid}），本次退出`);
                process.exit(0);
            }
            // ESRCH：进程已不在，继续往下走
        }
    }
} catch {
    /* 没有 pid 文件，正常首次启动 */
}
try {
    fs.writeFileSync(LOCK_PATH, String(process.pid));
} catch {
    /* ignore */
}

// ------------------------------------------------- 注入到页面的函数（源码） ---
// 这个函数的源码会被 toString() 序列化后送进页面执行，MAP 由调用方传入。
function pageInstaller(MAP, STAMP, COLLECT) {
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };

  // 带变量的文案（"Worked for 2m"、"Thought for 5s"）用精确匹配永远抓不到，
  // 靠模式匹配兜住。这里只放确实会出现在界面上的运行状态与权限询问前缀。
  var RULES = [
    // 权限询问：问句和按钮都是 "Allow <本次要干的事>?" / "Yes, and always allow '<命令>'"
    // 这种运行时拼出来的形式，每次内容都不同，只能靠模式接。
    // 先列常见动词，剩下的兜底给通用规则。
    [/^Allow checking (.+)\?$/, "允许检查 $1？"],
    [/^Allow running (.+)\?$/, "允许运行 $1？"],
    [/^Allow extracting (.+)\?$/, "允许提取 $1？"],
    [/^Allow querying (.+)\?$/, "允许查询 $1？"],
    [/^Allow downloading (.+)\?$/, "允许下载 $1？"],
    [/^Allow viewing (.+)\?$/, "允许查看 $1？"],
    [/^Allow testing (.+)\?$/, "允许测试 $1？"],
    [/^Allow executing (.+)\?$/, "允许执行 $1？"],
    [/^Allow reading (.+)\?$/, "允许读取 $1？"],
    [/^Allow writing (.+)\?$/, "允许写入 $1？"],
    [/^Allow read access to (.+)\?$/, "允许读取 $1？"],
    [/^Allow write access to (.+)\?$/, "允许写入 $1？"],
    [/^Allow (.+)\?$/, "允许 $1？"],
    [/^Yes, and always allow '(.+)' in this conversation$/, "是，并在本次对话中始终允许 $1"],
    [/^Yes, and always allow '(.+)' when not in a project$/, "是，并在非项目环境中始终允许 $1"],
    [/^Yes, and always allow '(.+)'$/, "是，并始终允许 $1"],
    [/^Requesting permission to read (.+)$/, "请求读取权限：$1"],
    [/^Requesting permission to write (.+)$/, "请求写入权限：$1"],
    [/^Requesting permission to run (.+)$/, "请求运行权限：$1"],
    // 运行状态
    [/^Worked for (.+)$/, "工作 $1"],
    [/^Thought for (.+)$/, "思考 $1"],
    [/^Explored (\d+) files?$/, "已探索 $1 个文件"],
    [/^Explored (\d+) folders?$/, "已探索 $1 个文件夹"],
    [/^Explored (\d+) searches?$/, "已探索 $1 次搜索"],
    [/^Explored (.+)$/, "已探索 $1"],
    [/^Searched (\d+) files?$/, "已搜索 $1 个文件"],
    [/^Searched (.+)$/, "已搜索 $1"],
    [/^Analyzed (\d+) files?$/, "已分析 $1 个文件"],
    [/^Analyzed (.+)$/, "已分析 $1"],
    [/^Proceeded with (.+)$/, "继续执行 $1"],
    [/^Invoked (.+) subagent$/, "已调用 $1 子智能体"],
    [/^Invoking (.+) subagent$/, "正在调用 $1 子智能体"],
    [/^(\d+) subagents?\/tasks running$/, "$1 个子智能体/任务运行中"],
    [/^(\d+) subagents? running$/, "$1 个子智能体运行中"],
    [/^(\d+) tasks? running, (\d+) blocked$/, "$1 个任务运行中，$2 个已阻塞"],
    [/^(\d+) tasks? running$/, "$1 个任务运行中"],
    [/^(\d+) files?, (.+)$/, "$1 个文件，$2"],
    [/^(\d+) folders?, (.+)$/, "$1 个文件夹，$2"],
    [/^(\d+) files?$/, "$1 个文件"],
    [/^(\d+) folders?$/, "$1 个文件夹"],
    [/^(\d+) searches?$/, "$1 次搜索"],
    [/^(\d+) seconds?$/, "$1 秒"],
    [/^(\d+) minutes?$/, "$1 分钟"]
  ];

  function shouldSkip(node) {
    var el = node.parentElement;
    if (!el) return true;
    if (SKIP[el.tagName]) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // 收集「看起来是界面文案、但词典里没有」的文本，供离线补齐词典用。
  // 只收短的、纯 ASCII 的、含字母且不像路径/URL/代码的串，尽量避开用户内容。
  function noteMissed(t) {
    if (t.length < 3 || t.length > 70) return;
    if (!/^[\x20-\x7E]+$/.test(t)) return;
    if (!/[A-Za-z]/.test(t)) return;
    if (/^(https?:|\/\/|[A-Za-z]:\\)/.test(t)) return;
    if (/^[a-z][a-z0-9_]*$/.test(t)) return;
    if (!/^[A-Z]/.test(t) && t.indexOf(" ") === -1) return;
    if (/\{\{|=>|\(\)/.test(t)) return;
    if (!window.__agHansMissed) window.__agHansMissed = {};
    window.__agHansMissed[t] = (window.__agHansMissed[t] || 0) + 1;
  }

  function translateNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed) return;
    var hit = MAP[trimmed];
    if (hit === undefined) {
      // 精确匹配失败，再试带变量的模式
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i][0].test(trimmed)) {
          hit = trimmed.replace(RULES[i][0], RULES[i][1]);
          break;
        }
      }
    }
    if (hit === undefined) {
      if (COLLECT) noteMissed(trimmed);
      return;
    }
    // 译文与原文相同的条目（Tab、GitHub、Turbo、Google3 这类专有名词）必须跳过。
    // 给 nodeValue 写回相同值依然会产生 characterData 记录，会被自己的 observer
    // 收到后再次写回，形成微任务死循环，主线程占满后界面就点不动了。
    if (hit === trimmed) return;
    if (shouldSkip(node)) return;
    // 保留原有前后空白，React 对文本节点做 diff 时依赖它
    node.nodeValue = raw.replace(trimmed, hit);
    window.__agHansHits = (window.__agHansHits || 0) + 1;
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    if (SKIP[root.tagName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) translateNode(n);
  }

  if (!document.body) return "no-body-yet";

  window.__agHansMap = MAP;
  window.__agHansStamp = STAMP;
  window.__agHansHits = 0;

  if (window.__agHansObserver) {
    window.__agHansObserver.disconnect();
  }

  walk(document.body);

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === "characterData") {
        translateNode(m.target);
      } else {
        for (var j = 0; j < m.addedNodes.length; j++) {
          walk(m.addedNodes[j]);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.__agHansObserver = observer;
  window.__agHansInstalled = true;

  return "installed";
}

// -------------------------------------------------------------------- CDP ---
function readPort() {
  try {
    const txt = fs.readFileSync(PORT_FILE, "utf8");
    const p = parseInt(txt.split("\n")[0].trim(), 10);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ------------------------------------------------------------------- main ---
async function main() {
  let ws = null;
  let wsUrl = null;
  let seq = 0;
  const pending = new Map();

  function teardown() {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    ws = null;
    wsUrl = null;
    pending.clear();
  }

  function send(method, params) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) {
        reject(new Error("ws 未连接"));
        return;
      }
      const myId = ++seq;
      const timer = setTimeout(() => {
        pending.delete(myId);
        reject(new Error("CDP 超时"));
      }, 8000);
      pending.set(myId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  function connect(url) {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url);
      const timer = setTimeout(() => {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        reject(new Error("ws 连接超时"));
      }, 6000);

      sock.addEventListener("open", () => {
        clearTimeout(timer);
        ws = sock;
        resolve();
      });

      sock.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id && pending.has(msg.id)) {
          const cb = pending.get(msg.id);
          pending.delete(msg.id);
          cb(msg.result || {});
        }
      });

      sock.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws 连接失败"));
      });

      sock.addEventListener("close", () => {
        if (ws === sock) {
          ws = null;
          wsUrl = null;
        }
      });
    });
  }

  let misses = 0;
  let pollCount = 0;

  for (;;) {
    try {
      const port = readPort();
      if (!port) throw new Error("DevToolsActivePort 不存在");

      const targets = await listTargets(port);
      const page = targets.find((t) => t.type === "page");
      if (!page) throw new Error("没有找到 page target");

      if (!ws || ws.readyState !== 1 || wsUrl !== page.webSocketDebuggerUrl) {
        teardown();
        await connect(page.webSocketDebuggerUrl);
        wsUrl = page.webSocketDebuggerUrl;
        log("已连接 ->", page.url);
      }

      const probe = await send("Runtime.evaluate", {
        expression: "String(window.__agHansStamp || 0)",
        returnByValue: true,
      });
      const pageStamp = probe && probe.result ? String(probe.result.value) : "0";

      // 词典或注入脚本有变化就重新注入，否则页面会一直沿用旧的。
      if (pageStamp !== String(STAMP)) {
        const payload = `(${pageInstaller.toString()})(${JSON.stringify(DICT)}, ${JSON.stringify(STAMP)}, ${COLLECT})`;
        const r = await send("Runtime.evaluate", {
          expression: payload,
          returnByValue: true,
        });
        const verdict = r && r.result ? r.result.value : "?";
        log("注入完成 ->", verdict);
      }

      // 每 10 轮（约 25 秒）把页面上没翻译到的文案捞回来存盘
      if (COLLECT && ++pollCount % 10 === 0) {
        const m = await send("Runtime.evaluate", {
          expression: "JSON.stringify(window.__agHansMissed || {})",
          returnByValue: true,
        });
        try {
          const raw = m && m.result ? m.result.value : "{}";
          fs.writeFileSync(MISSED_PATH, JSON.stringify(JSON.parse(raw), null, 1));
        } catch {
          /* 捞不到就算了，不影响汉化本身 */
        }
      }

      misses = 0;

      if (ONCE) {
        log("--once 模式，退出");
        teardown();
        return;
      }
    } catch (e) {
      misses++;
      teardown();
      if (misses === 1 || misses % 8 === 0) {
        log(`等待中：${e.message}（第 ${misses} 次）`);
      }
      if (misses >= MAX_MISSES && !ONCE) {
        log("Antigravity 长时间不可达，守护进程退出");
        return;
      }
      if (ONCE) {
        log("--once 失败：" + e.message);
        process.exit(1);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  log("守护进程异常退出：" + (e && e.message ? e.message : e));
  process.exit(1);
});
