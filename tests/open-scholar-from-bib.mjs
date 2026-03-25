import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import readline from "node:readline/promises";

function parseArgs(argv) {
  const args = {
    bib: "tests/test-cite.bib",
    dryRun: false,
    noOpen: false,
    delaySec: 0,
    interactive: process.stdin.isTTY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === "--bib" && argv[i + 1]) {
      args.bib = argv[i + 1];
      i += 1;
    } else if (cur === "--dry-run") {
      args.dryRun = true;
    } else if (cur === "--no-open") {
      args.noOpen = true;
    } else if (cur === "--delay" && argv[i + 1]) {
      args.delaySec = Math.max(0, Number(argv[i + 1]) || 0);
      i += 1;
    } else if (cur === "--interactive") {
      args.interactive = true;
    } else if (cur === "--no-interactive") {
      args.interactive = false;
    }
  }

  return args;
}

function extractTitles(bibText) {
  const titles = [];

  const bracePattern = /title\s*=\s*\{([\s\S]*?)\}\s*,/gi;
  let m = bracePattern.exec(bibText);
  while (m) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (t) titles.push(t);
    m = bracePattern.exec(bibText);
  }

  if (titles.length > 0) return titles;

  const quotePattern = /title\s*=\s*"([\s\S]*?)"\s*,/gi;
  m = quotePattern.exec(bibText);
  while (m) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (t) titles.push(t);
    m = quotePattern.exec(bibText);
  }

  return titles;
}

function toScholarUrl(title) {
  return "https://scholar.google.com/scholar?q=" + encodeURIComponent(title);
}

function openUrl(url) {
  let cmd;
  let cmdArgs;

  if (process.platform === "win32") {
    cmd = "cmd";
    cmdArgs = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = "open";
    cmdArgs = [url];
  } else {
    cmd = "xdg-open";
    cmdArgs = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(args.bib, "utf-8");
  const titles = extractTitles(raw);

  if (!titles.length) {
    throw new Error(`未在 ${args.bib} 中找到 title 字段`);
  }

  console.log(`读取到 ${titles.length} 篇，来源: ${args.bib}`);

  const rl = args.interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  try {
    for (let i = 0; i < titles.length; i += 1) {
      const title = titles[i];
      const url = toScholarUrl(title);
      console.log(`\n[${i + 1}/${titles.length}] ${title}`);
      console.log(url);

      if (!args.dryRun && !args.noOpen) {
        await openUrl(url);
      }

      if (i < titles.length - 1) {
        if (rl) {
          await rl.question("按回车打开下一篇... ");
        } else if (args.delaySec > 0) {
          await sleep(args.delaySec * 1000);
        }
      }
    }
  } finally {
    if (rl) rl.close();
  }

  console.log("\n已处理完成。");
}

run().catch((err) => {
  console.error("执行失败:", err.message);
  process.exit(1);
});
