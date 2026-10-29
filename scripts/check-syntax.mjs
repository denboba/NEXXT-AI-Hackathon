#!/usr/bin/env node
// Dependency-free syntax check for every src/**/*.{ts,tsx} file and every
// server/*.mjs module (the latter via `node --check`).
// Uses TypeScript's transpileModule (syntax-only, no type information), so it
// works without node_modules. Resolution order for the typescript package:
// TYPESCRIPT_PATH env, local node_modules, global npm root, known nvm path.
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);

function loadTypeScript() {
  const candidates = [];
  if (process.env.TYPESCRIPT_PATH) candidates.push(process.env.TYPESCRIPT_PATH);
  candidates.push("typescript");
  try {
    const globalRoot = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (globalRoot) candidates.push(join(globalRoot, "typescript"));
  } catch {
    // npm unavailable; fall through to known path
  }
  candidates.push("/root/.nvm/versions/node/v22.23.4/lib/node_modules/typescript");
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next candidate
    }
  }
  console.error(
    "check-syntax: could not load the typescript package. Set TYPESCRIPT_PATH to its directory.",
  );
  process.exit(2);
}

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const ts = loadTypeScript();
const files = collect(join(root, "src")).sort();
let errorCount = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
      verbatimModuleSyntax: true,
    },
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    errorCount += 1;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    let location = relative(root, file);
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      location += `:${line + 1}:${character + 1}`;
    }
    console.error(`${location} - error TS${diagnostic.code}: ${message}`);
  }
}

// Plain ESM server modules (server/*.mjs) are checked with `node --check`.
const serverDir = join(root, "server");
const serverFiles = existsSync(serverDir)
  ? readdirSync(serverDir)
      .filter((name) => name.endsWith(".mjs"))
      .sort()
      .map((name) => join(serverDir, name))
  : [];
for (const file of serverFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    errorCount += 1;
    console.error(`${relative(root, file)} - node --check failed:\n${String(error.stderr ?? error.message)}`);
  }
}

const total = files.length + serverFiles.length;
if (errorCount > 0) {
  console.error(`check-syntax: ${errorCount} error(s) in ${total} file(s) (TypeScript ${ts.version}, node --check for server/*.mjs).`);
  process.exit(1);
}
console.log(
  `check-syntax: ${total} file(s) OK (${files.length} src via TypeScript ${ts.version}, ${serverFiles.length} server/*.mjs via node --check).`,
);
