/**
 * webnovel-writer —— pi 扩展
 *
 * 把 webnovel-writer 的长篇网文创作系统接入 pi：
 *  - 注册 `/webnovel` 通用命令，直接驱动底层 `webnovel.py` CLI
 *  - 注册 `webnovel-init|plan|write|review|query|learn|dashboard|doctor` 快捷命令
 *  - 注册 `webnovel_run` 自定义工具，供 LLM 调用任意 CLI 子命令
 *
 * 本扩展不修改仓库内原有的 Claude Code 插件（webnovel-writer/）。
 * 它只新增一层 pi 接口，复用同一套 Python 后端与 skills/templates。
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PLUGIN_ROOT, PYTHON, runWebnovel, runWebnovelStream } from "./cli.ts";

/** 解析用户参数里的 `--project-root <dir>`，返回 { 剩余参数, projectRoot }。 */
function extractProjectRoot(args: string[], fallback: string): { rest: string[]; projectRoot: string } {
	let projectRoot = fallback;
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--project-root") {
			projectRoot = args[i + 1] ?? fallback;
			i++; // 跳过值
		} else if (a.startsWith("--project-root=")) {
			projectRoot = a.slice("--project-root=".length) || fallback;
		} else {
			rest.push(a);
		}
	}
	return { rest, projectRoot };
}

/** CLI 子命令（不含 `--project-root`）的带参提示，仅用于命令描述里展示。 */
const SUBCOMMANDS = [
	"where",
	"preflight",
	"project-status",
	"doctor",
	"write-gate",
	"projections",
	"user-report",
	"run-ledger",
	"run-log",
	"use",
	"index",
	"state",
	"rag",
	"style",
	"entity",
	"context",
	"memory",
	"migrate",
	"status",
	"update-state",
	"backup",
	"archive",
	"init",
	"extract-context",
	"story-system",
	"story-events",
	"chapter-commit",
	"memory-contract",
	"project-memory",
	"review-pipeline",
	"placeholder-scan",
	"master-outline-sync",
	"knowledge",
];

export default function webnovelPiExtension(pi: ExtensionAPI) {
	// ---- 会话启动提示 ----
	pi.on("session_start", async (_event, ctx) => {
		// 仅在无 UI（print/json）时静默
		if (ctx.hasUI) {
			ctx.ui.notify(
				"webnovel-writer pi 扩展已加载。用 `/webnovel <子命令>` 或 `/webnovel-write N` 开始写作。",
				"info",
			);
		}
	});

	// ---- 通用命令：/webnovel <子命令> [args...] ----
	pi.registerCommand("webnovel", {
		description: "运行 webnovel CLI 子命令（where/preflight/doctor/query/memory/...）。",
		getArgumentCompletions: (prefix) => {
			const matches = SUBCOMMANDS.filter((s) => s.startsWith(prefix));
			return matches.length > 0 ? matches.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (rawArgs: string, ctx) => {
			const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
			if (tokens.length === 0) {
				ctx.ui.notify(
					"用法：/webnovel <子命令> [参数...]。子命令：" + SUBCOMMANDS.join(", "),
					"info",
				);
				return;
			}

			const { rest, projectRoot } = extractProjectRoot(tokens, ctx.cwd);
			// 预期第一个 token 是子命令（不带 --project-root）
			if (ctx.hasUI) ctx.ui.notify(`运行 webnovel ${tokens[0]} ...`, "info");

			const code = await runWebnovelStream(rest, { projectRoot, cwd: ctx.cwd });
			if (code !== 0) {
				ctx.ui.notify(`webnovel ${tokens[0]} 退出码 ${code}`, "error");
			}
		},
	});

	// ---- 快捷命令 ----
	// 有确定 CLI 子命令的才直接转发；agent 驱动的流程改为提示加载对应 skill。
	const shortcuts: Array<{
		name: string;
		description: string;
		subcommand?: string; // 有则直接转发
		skill?: string; // 无则提示加载 skill
		hint?: string;
	}> = [
		{ name: "webnovel-init", description: "初始化新书项目", subcommand: "init" },
		{ name: "webnovel-plan", description: "规划卷纲/章纲（agent 驱动）", skill: "webnovel-plan", hint: "加载 /skill:webnovel-plan 驱动规划" },
		{ name: "webnovel-write", description: "写作并提交章节（agent 驱动）", skill: "webnovel-write", hint: "加载 /skill:webnovel-write N 驱动写作" },
		{ name: "webnovel-review", description: "审查章节（agent 驱动）", skill: "webnovel-review", hint: "加载 /skill:webnovel-review 1-5 驱动审查" },
		{ name: "webnovel-query", description: "查询项目状态", subcommand: "project-status" },
		{ name: "webnovel-learn", description: "写入项目经验记忆", subcommand: "memory" },
		{ name: "webnovel-dashboard", description: "启动只读可视化面板", subcommand: undefined, skill: "dashboard" },
		{ name: "webnovel-doctor", description: "只读体检项目", subcommand: "doctor" },
	];

	for (const sc of shortcuts) {
		pi.registerCommand(sc.name, {
			description: sc.description,
			handler: async (rawArgs: string, ctx) => {
				if (ctx.hasUI) ctx.ui.notify(`${sc.name} ...`, "info");

				if (sc.skill === "dashboard") {
					await startDashboard(ctx);
					return;
				}

				if (sc.subcommand) {
					const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
					const { rest, projectRoot } = extractProjectRoot(tokens, ctx.cwd);
					const code = await runWebnovelStream(rest.length > 0 ? rest : [sc.subcommand], {
						projectRoot,
						cwd: ctx.cwd,
					});
					if (code !== 0) ctx.ui.notify(`webnovel ${sc.subcommand} 退出码 ${code}`, "error");
					return;
				}

				// agent 驱动流程：run preflight，然后提示加载 skill
				await runWebnovelStream(["preflight"], { projectRoot: ctx.cwd, cwd: ctx.cwd }).catch(() => 0);
				ctx.ui.notify(sc.hint ?? `加载 /skill:${sc.skill} 继续`, "info");
			},
		});
	}

	// ---- 自定义工具：webnovel_run ----
	pi.registerTool({
		name: "webnovel_run",
		label: "Webnovel Run",
		description: [
			"运行 webnovel-writer 的 Python CLI 子命令并返回其输出。",
			"适用于长篇网文创作的数据/运维操作：预检(where/preflight)、状态(project-status/doctor/status)、",
			"记忆(memory)、RAG(rag)、章节提交(chapter-commit)、投影(projections)、备份(backup)、索引(index)、",
			"生成合同(story-system)、故事事件(story-events)等。",
			"参数 subcommand 为子命令名，args 为传给该子命令的参数数组。需指定 --project-root（书项目根）。",
		].join(" "),
		parameters: Type.Object({
			subcommand: Type.String({ description: "webnovel CLI 子命令，例如 doctor / project-status / memory / init" }),
			args: Type.Optional(Type.Array(Type.String(), { description: "传给子命令的额外参数数组（可选）" })),
			project_root: Type.Optional(Type.String({ description: "书项目根目录。缺省用工作目录。" })),
			cwd: Type.Optional(Type.String({ description: "子进程工作目录（可选）。" })),
		}),
		async execute(_toolCallId, params) {
			const subcommand = params.subcommand as string;
			const extra = (params.args as string[] | undefined) ?? [];
			const projectRoot = (params.project_root as string | undefined) ?? process.cwd();
			const cwd = (params.cwd as string | undefined) ?? projectRoot;
			const args = [subcommand, ...extra];

			if (!subcommand || subcommand === "help" || subcommand === "--help") {
				return {
					content: [{ type: "text", text: `支持的子命令：\n${SUBCOMMANDS.join("\n")}` }],
					details: {},
				};
			}

			const res = await runWebnovel(args, { projectRoot, cwd });
			const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim() || "(无输出)";
			return {
				content: [
					{
						type: "text",
						text: res.code === 0 ? output : `exit ${res.code}\n\n${output}`,
					},
				],
				details: { exitCode: res.code, subcommand, projectRoot, cwd },
			};
		},
	});
}

/** 启动只读 Dashboard 服务（后台）并提示地址。 */
async function startDashboard(ctx: ExtensionCommandContext): Promise<void> {
	const { spawn } = await import("node:child_process");
	const path = await import("node:path");
	const fs = await import("node:fs");

	// Dashboard 以 `python -m dashboard` 运行（在 PLUGIN_ROOT 下，保证包相对导入可用）
	const packageDir = path.join(PLUGIN_ROOT, "dashboard");
	if (!fs.existsSync(path.join(packageDir, "app.py"))) {
		ctx.ui.notify(`未找到 Dashboard（${packageDir}）`, "error");
		return;
	}

	const port = process.env.WEBNOVEL_DASHBOARD_PORT || "8765";
	const child = spawn(
		PYTHON,
		["-X", "utf8", "-m", "dashboard", "--project-root", ctx.cwd, "--host", "127.0.0.1", "--port", port],
		{
			cwd: PLUGIN_ROOT,
			env: { ...process.env, SCRIPTS_DIR: PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
			stdio: ["ignore", "ignore", "ignore"],
			detached: true,
		},
	);
	child.unref();
	ctx.ui.notify(`Dashboard 已启动：http://127.0.0.1:${port}（PID ${child.pid}）`, "info");
}
