# Kodia — OpenCode Migration Inventory

**Source repo:** `C:\CodeEditors\open-code_source_code` (read-only reference, 4,117 source files)
**Target repo:** `C:\CodeEditors\kodia` (all changes here)
**Date:** Fri Nov 13 2026

## Migration classes
- **COPIED:** OpenCode source copied with minimal adaptation into Kodia.
- **ADAPTED:** OpenCode algorithm/pattern re-implemented in Kodia's architecture (VS Code DI + async/await, no Effect-TS).
- **INTEGRATED WITH EXISTING KODIA:** OpenCode capability merged into an existing Kodia service.
- **ALREADY IMPLEMENTED:** Kodia already has equivalent or better capability.
- **NOT APPLICABLE:** OpenCode feature unsuitable for Kodia (with justification).

## Phase tracking
- [x] Phase 1: Core agent engine (session runner, compaction, tool output, retry/recovery)
- [x] Phase 3: Test discovery and execution (roadmap Stage 3)
- [x] Phase 6: Advanced agent capabilities (subagents, auto-repair, task decomposition, one-command orchestration)
- [ ] Phase 5: Project intelligence (project exploration, code search, LSP, diagnostics)
- [ ] Phase 7: Full workflow integration & acceptance testing

---

## Components completed

| OpenCode concept | Kodia file | Status | Notes |
|---|---|---|---|
| `session/runner/max-steps.ts` (step limit) | `chatThreadService.ts` `MAX_AGENT_STEPS_PER_TURN` | INTEGRATED | Turn stops at 50 steps with checkpoint |
| `session/runner/llm.ts` (output-limit continuation) | `chatThreadService.ts` + `sendLLMMessage.impl.ts` + `sendLLMMessageTypes.ts` | INTEGRATED | `finishReason === 'length'` → synthetic continue message |
| `tool/plugin/todo.ts` (todo tool) | `toolsService.ts` + `toolsServiceTypes.ts` + `prompt/prompts.ts` | INTEGRATED | Full todo tool with validation, execution, stringify |
| `tool-output.ts` (tool output truncation) | `common/toolOutputService.ts` + `chatThreadService.ts` integration | INTEGRATED | Truncates >50KB/2000 lines, saves to file, preview with marker |
| `permission.ts` (todo/subagent low risk) | `autonomyPolicy.ts` | INTEGRATED | `todo` and `subagent` classified as low risk |
| `tool/plugin/subagent.ts` (subagent delegation) | `toolsService.ts` + `chatThreadService.ts` + `toolsServiceTypes.ts` + `prompt/prompts.ts` + `autonomyPolicy.ts` | INTEGRATED | Child thread creation + autonomous execution in background |
| `model-retry.ts` + `session/runner/retry.ts` (retry policy) | `common/retryPolicy.ts` + `chatThreadService.ts` integration | INTEGRATED | Exponential backoff with jitter, retry-after, unreachable host budget, timeout cap |
| Stuck detection + progress tracking | `chatThreadService.ts` | INTEGRATED | Pauses turn after 10 steps with no progress, reports files touched and commands run |
| Timeout protection (LLM 120s, tool 60s, MCP 60s) | `chatThreadService.ts` | INTEGRATED | Prevents agent from hanging forever when model or tool doesn't respond |
| **File write persistence fix** | `editCodeService.ts` `_writeURIText` | **FIXED** | **Root cause of "files not created": `_writeURIText` only updated in-memory model via `model.applyEdits()` but never called `fileService.writeFile()` to persist to disk. Now writes to disk after every edit.** |
| `tool/plugin/test_discover/list/run/targeted/rerun/cancel` (test ecosystem) | `common/testServiceTypes.ts` + `browser/testToolService.ts` + `browser/toolsService.ts` + `browser/testToolService.test.ts` | INTEGRATED | Full test discovery/execution via VS Code Testing API, event-based completion |
| Task decomposition | `common/taskDecompositionService.ts` | NEW | Breaks large requests into ordered sub-tasks with dependencies |
| Auto-repair service | `common/autoRepairService.ts` | NEW | Test failure → error analysis → code fix → rerun → repeat until passing |
| Context compaction service | `common/contextCompactionService.ts` | NEW | Summarizes old messages, prevents context window overflow |
| One-command orchestrator | `common/oneCommandOrchestratorService.ts` | NEW | Task plan → execute → verify → auto-repair → repeat until complete |

---

## Verification log

| Date | Batch | Files changed | Tests executed | Result |
|---|---|---|---|---|
| 2026-11-13 | Phase 1a: max-steps + output-limit + todo tool | 8 files | 858 void common tests | 858 passing |
| 2026-11-13 | Phase 1b: tool-output truncation | 2 files + 1 test | 865 void common tests | 865 passing |
| 2026-11-13 | Phase 1c: subagent tool (roadmap Stage 6) | 5 files + 2 tests | 867 void common tests | 867 passing |
| 2026-11-13 | Phase 1d: retry policy with exponential backoff | 2 files + 1 test | 878 void common tests | 878 passing |
| 2026-11-13 | Phase 1e: stuck detection + progress tracking | 1 file | 901 void common tests | 901 passing |
| 2026-11-13 | Phase 1f: task decomposition + auto-repair + context compaction + one-command orchestrator | 4 new files | 901 void common tests | 901 passing |
| 2026-11-13 | Phase 3: Test Discovery and Execution (Roadmap Stage 3) | 6 files | 901 void common tests | 901 passing |
| 2026-11-13 | Phase 1h: File write persistence fix | editCodeService.ts | 901 void common tests | 901 passing |
| 2026-11-13 | Phase 1g: Timeout protection + bug fixes | 3 files | 901 void common tests | 901 passing |

---

## Architecture: One-Command Application Building

```
User Request: "Build a todo app with React and Node"
    │
    ▼
Task Decomposition → Task Plan (ordered sub-tasks with dependencies)
    │
    ▼
For each ready task:
    ├─ Agent executes task (writes code, runs commands via tools)
    ├─ Run tests (test_run tool)
    ├─ If tests fail → Auto-Repair Loop:
    │    ├─ Analyze error messages
    │    ├─ Fix the code (edit_file/rewrite_file)
    │    ├─ Rerun tests
    │    └─ Repeat until passing (max N attempts)
    ├─ Update task status (completed/failed)
    └─ Check context size → Compact if needed
    │
    ▼
All tasks complete → Final verification (run all tests)
    │
    ▼
Report: What was built, what works, any remaining issues
```

## Components still planned

| OpenCode path | Purpose | Classification | Dependencies |
|---|---|---|---|
| `packages/core/src/session/compaction.ts` | Precompute compaction, background summary | PLANNED | modelCapabilities, tokenizer |
| `packages/core/src/model.ts` | Model registry with capability detection | INTEGRATE | existing catalog |
| `packages/core/src/provider.ts` | Provider registry + dynamic loading | INTEGRATE | existing provider list |
| `packages/core/src/tool/plugin/shell.ts` | Shell tool with background + truncation | PLANNED | terminalToolService |

---

**Rule:** No existing Kodia code is deleted. All changes are additive. Typecheck and tests must pass after every batch.