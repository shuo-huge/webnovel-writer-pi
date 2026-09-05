/**
 * webnovel-writer pi 扩展 —— CLI 运行辅助
 *
 * 负责定位插件内的 `webnovel.py`，并以正确的环境变量调用它。
 * 目标是让 pi 侧的命令/工具都能复用同一个 Python 后端，无需关心
 * 插件到底安装在本地仓库还是 `pi install git:...` 克隆目录。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 本文件所在目录：`<packageRoot>/extensions` */
export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包根目录（= 仓库根，`extensions/` 的上一级） */
export const PKG_ROOT = path.resolve(HERE, "..");

/**
 * 兼容 Claude Code 插件的“插件根”布局。
 * 在 Claude Code 里 `CLAUDE_PLUGIN_ROOT` 指向 `webnovel-writer/`，
 * 所以 `scripts`、`skills` 都相对它解析。这里也照此设置。
 */
export const PLUGIN_ROOT = path.join(PKG_ROOT, "webnovel-writer");
export const SCRIPTS_DIR = path.join(PLUGIN_ROOT, "scripts");
export const CLI = path.join(SCRIPTS_DIR, "webnovel.py");
export const SKILLS_DIR = path.join(PLUGIN_ROOT, "skills");

/** 允许用 `WEBNOVEL_PYTHON` 覆盖解释器（默认 python3） */
export const PYTHON = process.env.WEBNOVEL_PYTHON || "python3";

/** 解析脚本目录。若预期的位置缺失，则向上回退搜索 webnovel-writer/scripts。 */
export function resolveScriptsDir(): string {
	if (existsSync(CLI)) return SCRIPTS_DIR;

	// 回退：从包根向上找到 `webnovel-writer/scripts/webnovel.py`
	let dir = PKG_ROOT;
	for (let i = 0; i < 6; i++) {
		const candidate = path.join(dir, "webnovel-writer", "scripts", "webnovel.py");
		if (existsSync(candidate)) return path.join(dir, "webnovel-writer", "scripts");
		dir = path.dirname(dir);
	}
	return SCRIPTS_DIR;
}

/** 给子进程注入与 Claude Code 兼容的路径变量，方便 skill 里的 bash 引用。 */
export function cliEnv(): NodeJS.ProcessEnv {
	const scriptsDir = resolveScriptsDir();
	const pluginRoot = path.dirname(scriptsDir);
	// scripts 内用 `from scripts.xxx` 把 scripts 当包导入，需要其父目录（pluginRoot）在 path 上。
	const pythonPath = [pluginRoot, scriptsDir, process.env.PYTHONPATH].filter(Boolean).join(":");
	return {
		...process.env,
		SCRIPTS_DIR: scriptsDir,
		WEB_NOVEL_SCRIPTS: scriptsDir,
		CLAUDE_PLUGIN_ROOT: pluginRoot,
		PLUGIN_ROOT: pluginRoot,
		PYTHONPATH: pythonPath,
	};
}

/** 检测当前 PYTHON 是否已具备运行 webnovel 所需的核心依赖。 */
export function pythonDepsOk(): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(PYTHON, ["-c", "import aiohttp, filelock, pydantic"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		child.on("close", (code) => resolve(code === 0));
		child.on("error", () => resolve(false));
	});
}

export type DepsStatus = "ok" | "installed" | "failed";

/**
 * 确保 `PYTHON` 能 import 运行时核心依赖；缺失则用同一个 python 安装（仅核心三件）。
 * 不会改动项目的开发依赖（pytest 等）。
 */
export async function ensurePythonDeps(): Promise<DepsStatus> {
	if (await pythonDepsOk()) return "ok";

	try {
		const res = await new Promise<RunResult>((resolve, reject) => {
			const child = spawn(PYTHON, ["-m", "pip", "install", "aiohttp", "filelock", "pydantic"], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (d) => (stdout += d.toString()));
			child.stderr.on("data", (d) => (stderr += d.toString()));
			child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
			child.on("error", reject);
		});
		return pythonDepsOk() ? "installed" : "failed";
	} catch {
		return "failed";
	}
}

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface StreamOpts {
	projectRoot?: string;
	cwd?: string;
	/** 每收到一段 stdout/stderr 时回调（用于流式反馈） */
	onOutput?: (chunk: string) => void;
}

/**
 * 运行 `webnovel.py` 并将子进程输出流式转发到 `onOutput`（缺省转发到终端）。
 * 返回结束时的退出码。
 */
export function runWebnovelStream(args: string[], opts: StreamOpts): Promise<number> {
	return new Promise((resolve, reject) => {
		const scriptsDir = resolveScriptsDir();
		const cli = path.join(scriptsDir, "webnovel.py");
		const projectRoot = opts.projectRoot ?? opts.cwd ?? process.cwd();
		const cmdArgs = ["-X", "utf8", cli, "--project-root", projectRoot, ...args];

		const child = spawn(PYTHON, cmdArgs, {
			cwd: opts.cwd ?? projectRoot,
			env: cliEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		let done = false;
		const relay = (chunk: string) => {
			if (opts.onOutput) opts.onOutput(chunk);
			else process.stdout.write(chunk);
		};

		child.stdout.on("data", (d) => relay(d.toString()));
		child.stderr.on("data", (d) => relay(d.toString()));
		child.on("close", (code) => {
			if (done) return;
			done = true;
			resolve(code ?? 0);
		});
		child.on("error", (err) => {
			if (done) return;
			done = true;
			reject(err);
		});
	});
}

/**
 * 运行 `webnovel.py`（捕获输出）。
 * @param args webnovel 子命令及参数（不含 `--project-root`，这里自动补齐）
 * @param opts.projectRoot 书项目根（默认用 cwd，但显式传更稳）
 */
export function runWebnovel(
	args: string[],
	opts: { projectRoot?: string; cwd?: string; timeoutMs?: number },
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const scriptsDir = resolveScriptsDir();
		const cli = path.join(scriptsDir, "webnovel.py");
		const projectRoot = opts.projectRoot ?? opts.cwd ?? process.cwd();
		const cmdArgs = ["-X", "utf8", cli, "--project-root", projectRoot, ...args];

		const child = spawn(PYTHON, cmdArgs, {
			cwd: opts.cwd ?? projectRoot,
			env: cliEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let done = false;

		const finish = (code: number) => {
			if (done) return;
			done = true;
			resolve({ code, stdout, stderr });
		};

		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("close", (code) => finish(code ?? 0));
		child.on("error", (err) => {
			if (done) return;
			done = true;
			reject(err);
		});

		if (opts.timeoutMs) {
			const timer = setTimeout(() => {
				child.kill("SIGTERM");
			}, opts.timeoutMs);
			child.on("close", () => clearTimeout(timer));
		}
	});
}
