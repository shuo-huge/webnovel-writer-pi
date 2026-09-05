# Webnovel Writer · Pi 扩展

> 一个让 Ai 写到几百章,依然记得住设定、接得住伏笔、守得住大纲的长篇网文创作系统。

这是 **webnovel-writer** 的 **Pi 扩展**版。本包只收录插件数据（Pi 扩展 + Python 后端 + 技能/提示词）,在 pi 上通过专有命令驱动底层 `webnovel.py` CLI 完成创作流程。

完整项目背景与系统设计见原仓库:[lingfengQAQ/webnovel-writer](https://github.com/lingfengQAQ/webnovel-writer)。

## 安装

```bash
pi install npm:@shuohuge-org/webnovel-writer-pi
```

或按源码安装:

```bash
pi install git:github.com/shuo-huge/webnovel-writer-pi
```

Python 依赖（一次性，运行时需要 `aiohttp` / `filelock` / `pydantic`）:

```bash
python3 -m pip install aiohttp filelock pydantic
```

或直接用包内 requirements（路径随安装方式不同）:

```bash
# npm 安装
python3 -m pip install -r ~/.pi/agent/npm/node_modules/@shuohuge-org/webnovel-writer-pi/webnovel-writer/scripts/requirements.txt
# git 安装
python3 -m pip install -r ~/.pi/agent/git/github.com/shuo-huge/webnovel-writer-pi/webnovel-writer/scripts/requirements.txt
```

> 需要 `python3`。可用 `WEBNOVEL_PYTHON` 覆盖解释器;`WEBNOVEL_DASHBOARD_PORT` 覆盖面板端口(默认 8765)。

## 使用

| 命令 | 说明 |
|------|------|
| `/webnovel <子命令> [参数]` | 驱动底层 CLI,如 `/webnovel doctor --format text` |
| `/webnovel-init [目录]` | 初始化新书项目 |
| `/webnovel-query c 萧炎` | 查询角色/伏笔/状态 |
| `/webnovel-doctor` | 只读体检项目 |
| `/webnovel-learn "..."` | 写入项目经验记忆 |
| `/webnovel-dashboard` | 启动可视化面板 |
| `/webnovel-plan N` | 规划卷纲(agent 驱动,加载 `/skill:webnovel-plan`) |
| `/webnovel-write N` | 写作并提交章节(agent 驱动,加载 `/skill:webnovel-write`) |
| `/webnovel-review 1-5` | 审查章节(agent 驱动,加载 `/skill:webnovel-review`) |

### 工具(LLM 可直接调用)

`webnovel_run` — 运行任意 CLI 子命令并返回输出:

```json
{ "subcommand": "doctor", "args": ["--format", "text"], "project_root": "/path/to/book" }
```

### 依赖与环境

- 书项目根需含 `.webnovel/state.json`。
- `agent 驱动` 类流程(plan/write/review)依赖 LLM 编排,命令只做预检并提示加载对应 skill;
  纯数据/运维子命令(`doctor`/`project-status`/`memory`/`rag`/`chapter-commit` 等)可由 CLI 直接跑通。
- 扩展运行子进程时会注入 `SCRIPTS_DIR`、`CLAUDE_PLUGIN_ROOT`、`PYTHONPATH`,以兼容 skill 引用。

## 包含内容

```
extensions/          Pi 扩展（/webnovel 命令 + webnovel_run 工具 + CLI 封装）
webnovel-writer/
  scripts/           Python CLI 后端（webnovel.py + data_modules）
  skills/            8 个创作技能
  templates/         题材/输出模板（Pi 提示词）
  references/        审查/题材/大纲参考
  agents/            子代理定义
```

## 协议

GPL-3.0,见 [LICENSE](LICENSE)。
