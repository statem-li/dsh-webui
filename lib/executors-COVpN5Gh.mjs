import { A as init_types, C as init_reviewResultContract$1, D as init_compileTaskGraph, E as resolvePackageWorkspace, F as readJsonFile, I as writeJsonFile, L as init_optionalFile, M as executorProfileExecutionHost, P as init_json, R as isNodeFileNotFoundError, S as REVIEW_RESULT_CONTENT_GUIDANCE, T as init_loadPackage, _ as RUNNER_ARTIFACT_MAX_CONTENT_BYTES, a as executorLimitFailureMessage, b as canvasCommandFlagForWorkspace, c as finalizeExecutorCancellationOnError, d as prepareBlockRun, f as workspaceExecutionCwd, g as tmuxMetadataPatch, h as init_tmuxExecutor, i as execWithStreaming, k as parseBlockRef, l as finishRunMetadata, m as createTmuxSessionInfo, n as init_finalArtifactEnvelope, o as executorRuntimeLimits, p as workspaceExecutorEnv, r as allocateRunId, s as finalizeExecutorAttemptMetadata, t as finalArtifactEnvelopeSchema, u as init_executorShared, v as init_artifactReferenceContract, w as reviewResultSchema, x as init_canvasCommandScope, y as materializeArtifactBytes, z as __esmMin } from "./index.js";
import { basename, dirname, join } from "node:path";
import { constants } from "node:fs";
import "node:os";
import { access, writeFile } from "node:fs/promises";
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/finalArtifactContract.js
function contentBytes(artifact) {
	if (artifact.kind === "review") return Buffer.byteLength(JSON.stringify(artifact.reviewResult), "utf8");
	return Buffer.byteLength(artifact.reportMarkdown, "utf8");
}
function assertExpectedIdentity(envelope, expected) {
	const artifact = envelope.artifact;
	if (artifact.kind !== expected.kind) throw new FinalArtifactContractError("mismatched", `Expected ${expected.kind} final artifact, received ${artifact.kind}.`);
	if (artifact.kind === "feedback" && expected.kind === "feedback") {
		if (artifact.feedbackId !== expected.feedbackId || artifact.sourceReviewBlockRef !== expected.sourceReviewBlockRef || artifact.taskId !== expected.taskId) throw new FinalArtifactContractError("mismatched", "Feedback final artifact identity does not match the active feedback claim.");
		return;
	}
	if (artifact.kind !== "feedback" && expected.kind !== "feedback") {
		if (artifact.ref !== expected.ref || artifact.taskId !== expected.taskId) throw new FinalArtifactContractError("mismatched", "Final artifact ref/task identity does not match the active block claim.");
	}
}
function validateFinalArtifactEnvelope(input, expected) {
	const parsed = finalArtifactEnvelopeSchema.safeParse(input);
	if (!parsed.success) throw new FinalArtifactContractError("malformed", `Final artifact envelope is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);
	if (contentBytes(parsed.data.artifact) > FINAL_ARTIFACT_MAX_CONTENT_BYTES) throw new FinalArtifactContractError("limit_exceeded", `Final artifact content exceeds ${FINAL_ARTIFACT_MAX_CONTENT_BYTES} bytes.`);
	assertExpectedIdentity(parsed.data, expected);
	return parsed.data;
}
function implementationArtifactEnvelope(input) {
	return validateFinalArtifactEnvelope({
		version: "planweave.runner-artifact/v1",
		artifact: {
			kind: "implementation",
			...input
		}
	}, {
		kind: "implementation",
		ref: input.ref,
		taskId: input.taskId
	});
}
function reviewArtifactEnvelope(input) {
	return validateFinalArtifactEnvelope({
		version: "planweave.runner-artifact/v1",
		artifact: {
			kind: "review",
			...input
		}
	}, {
		kind: "review",
		ref: input.ref,
		taskId: input.taskId
	});
}
function feedbackArtifactEnvelope(input) {
	return validateFinalArtifactEnvelope({
		version: "planweave.runner-artifact/v1",
		artifact: {
			kind: "feedback",
			...input
		}
	}, {
		kind: "feedback",
		feedbackId: input.feedbackId,
		sourceReviewBlockRef: input.sourceReviewBlockRef,
		taskId: input.taskId
	});
}
async function materializeFinalArtifact(options) {
	const envelope = validateFinalArtifactEnvelope(options.envelope, options.expected);
	const content = envelope.artifact.kind === "review" ? `${JSON.stringify(envelope.artifact.reviewResult, null, 2)}\n` : envelope.artifact.reportMarkdown;
	return materializeArtifactBytes({
		rootDir: options.rootDir,
		relativePath: options.relativePath,
		kind: envelope.artifact.kind,
		content
	});
}
var FINAL_ARTIFACT_MAX_CONTENT_BYTES, FinalArtifactContractError;
var init_finalArtifactContract = __esmMin((() => {
	init_artifactReferenceContract();
	init_finalArtifactEnvelope();
	FINAL_ARTIFACT_MAX_CONTENT_BYTES = RUNNER_ARTIFACT_MAX_CONTENT_BYTES;
	FinalArtifactContractError = class extends Error {
		code;
		constructor(code, message) {
			super(message);
			this.code = code;
			this.name = "FinalArtifactContractError";
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/executorIntegration.js
function executorProfileMismatch(adapter, profile) {
	return /* @__PURE__ */ new Error(`Executor integration '${adapter}' received profile adapter '${profile.adapter}'.`);
}
var init_executorIntegration = __esmMin((() => {}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/reviewResultContract.js
function reviewResultEnvironment(input) {
	return {
		PLANWEAVE_REVIEW_RESULT_PATH: input.resultPath,
		PLANWEAVE_REVIEW_BLOCK_REF: input.reviewBlockRef,
		PLANWEAVE_TASK_ID: input.taskId
	};
}
function appendReviewResultFileInstruction(prompt, input) {
	return [
		prompt.trimEnd(),
		"",
		"## Auto Run Review Result File",
		"",
		`Write the required review result JSON to this exact file path: \`${input.resultPath}\`.`,
		"",
		"The file content must be one JSON object with this shape:",
		"",
		"```json",
		JSON.stringify({
			reviewBlockRef: input.reviewBlockRef,
			taskId: input.taskId,
			verdict: "passed | needs_changes",
			content: "review summary and requested changes"
		}, null, 2),
		"```",
		"",
		REVIEW_RESULT_CONTENT_GUIDANCE,
		"",
		"You may print a human-readable review report to stdout. PlanWeave will parse only the JSON file above, not stdout."
	].join("\n");
}
async function assertReviewResultJsonReadable(input) {
	try {
		await access(input.resultPath, constants.R_OK);
	} catch (error) {
		if (isNodeFileNotFoundError(error)) throw new Error(`Executor '${input.executorName}' did not create review result JSON at ${input.resultPath}.`);
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Executor '${input.executorName}' could not read review result JSON at ${input.resultPath}: ${detail}`);
	}
}
var init_reviewResultContract = __esmMin((() => {
	init_optionalFile();
	init_reviewResultContract$1();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/runnerArtifactMaterialization.js
async function materializeImplementationArtifact(input) {
	return materializeFinalArtifact({
		envelope: implementationArtifactEnvelope({
			ref: input.ref,
			taskId: input.taskId,
			reportMarkdown: input.reportMarkdown
		}),
		expected: {
			kind: "implementation",
			ref: input.ref,
			taskId: input.taskId
		},
		rootDir: dirname(input.path),
		relativePath: basename(input.path)
	});
}
async function materializeReviewArtifact(input) {
	return materializeFinalArtifact({
		envelope: reviewArtifactEnvelope({
			ref: input.ref,
			taskId: input.taskId,
			reviewResult: reviewResultSchema.parse(input.reviewResult)
		}),
		expected: {
			kind: "review",
			ref: input.ref,
			taskId: input.taskId
		},
		rootDir: dirname(input.path),
		relativePath: basename(input.path)
	});
}
async function materializeFeedbackArtifact(input) {
	return materializeFinalArtifact({
		envelope: feedbackArtifactEnvelope({
			feedbackId: input.feedbackId,
			sourceReviewBlockRef: input.sourceReviewBlockRef,
			taskId: input.taskId,
			reportMarkdown: input.reportMarkdown
		}),
		expected: {
			kind: "feedback",
			feedbackId: input.feedbackId,
			sourceReviewBlockRef: input.sourceReviewBlockRef,
			taskId: input.taskId
		},
		rootDir: dirname(input.path),
		relativePath: basename(input.path)
	});
}
var init_runnerArtifactMaterialization = __esmMin((() => {
	init_finalArtifactContract();
	init_reviewResultContract$1();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/terminalAgentExecutor.js
function defaultPreparePrompt(input) {
	if (!input.reviewResultPath) return input.prompt;
	return appendReviewResultFileInstruction(input.prompt, {
		resultPath: input.reviewResultPath,
		reviewBlockRef: input.claim.ref,
		taskId: input.claim.taskId
	});
}
function defaultFailureMessage(input) {
	if (input.result.limitExceeded) return executorLimitFailureMessage({
		executorName: input.executorName,
		limitExceeded: input.result.limitExceeded
	});
	return input.result.timedOut ? `Executor '${input.executorName}' timed out after ${input.limits.timeoutMs}ms.` : input.result.stderr.trim() || `Executor '${input.executorName}' exited with code ${input.result.exitCode}.`;
}
function sessionResultFields(sessionMetadataKey, agentSessionId) {
	if (!sessionMetadataKey) return { agentSessionId };
	return {
		agentSessionId,
		[sessionMetadataKey]: agentSessionId
	};
}
/**
* Shared block lifecycle for terminal-agent executors.
* Protocol-specific argv, session parsing, review shape, and report formatting live on `protocol`.
*/
async function runTerminalAgentProtocolBlock(options) {
	const protocol = options.protocol;
	const executeProcess = options.executeProcess;
	const run = await prepareBlockRun({
		projectRoot: options.projectRoot,
		claim: options.claim,
		executorName: options.executorName,
		adapter: protocol.adapter,
		profile: options.profile,
		prompt: options.prompt,
		executionWaveId: options.executionWaveId
	});
	const workspace = await resolvePackageWorkspace(options.projectRoot);
	const executionCwd = workspaceExecutionCwd(workspace);
	const reviewResultPath = options.claim.blockType === "review" ? join(run.runDir, "review-result.json") : null;
	const preparePrompt = protocol.preparePrompt ?? (protocol.reviewResultMode === "result-file" ? defaultPreparePrompt : void 0);
	const prompt = preparePrompt ? preparePrompt({
		prompt: options.prompt,
		claim: options.claim,
		reviewResultPath
	}) : options.prompt;
	if (prompt !== options.prompt) await writeFile(run.promptPath, prompt, "utf8");
	const usesReviewEnv = protocol.usesReviewResultEnvironment ?? protocol.reviewResultMode === "result-file";
	const reviewContract = reviewResultPath && usesReviewEnv ? {
		resultPath: reviewResultPath,
		reviewBlockRef: options.claim.ref,
		taskId: options.claim.taskId
	} : null;
	const invocation = protocol.buildInvocation({
		profile: options.profile,
		prompt,
		promptPath: run.promptPath,
		executionCwd
	});
	const limits = executorRuntimeLimits(options.profile);
	let agentSessionId = null;
	const onSessionId = async (sessionId) => {
		if (agentSessionId) return;
		agentSessionId = sessionId;
		await finishRunMetadata(run.metadataPath, sessionResultFields(protocol.sessionMetadataKey, sessionId));
	};
	if (invocation.sessionId) await onSessionId(invocation.sessionId);
	const env = workspaceExecutorEnv(workspace, reviewContract ? reviewResultEnvironment(reviewContract) : void 0);
	const executionHost = executorProfileExecutionHost(options.profile);
	const { tmux: _tmux, ...result } = await finalizeExecutorCancellationOnError({
		path: run.metadataPath,
		patch: {
			command: invocation.command,
			args: invocation.args,
			executionHost,
			projectRoot: workspace.rootPath,
			executionCwd,
			timeoutMs: limits.timeoutMs,
			maxStdoutBytes: limits.maxStdoutBytes,
			maxStderrBytes: limits.maxStderrBytes
		},
		run: () => executeProcess({
			command: invocation.command,
			args: invocation.args,
			cwd: executionCwd,
			stdin: invocation.stdin,
			env,
			host: executionHost,
			pathArgIndexes: invocation.pathArgIndexes,
			limits,
			stdoutPath: join(run.runDir, "stdout.md"),
			stderrPath: join(run.runDir, "stderr.log"),
			tmux: {
				runDir: run.runDir,
				runId: run.runId,
				ownerRunId: options.tmuxOwnerRunId,
				ref: options.claim.ref,
				kind: "block",
				enabled: options.tmuxEnabled
			},
			sessionIdFromOutput: protocol.sessionIdFromOutput,
			onSessionId,
			onTmuxReady: async (tmux) => finishRunMetadata(run.metadataPath, tmuxMetadataPatch(tmux)),
			signal: options.signal
		})
	});
	let finalResult = result;
	let resumed = false;
	if (protocol.sessionIdFromOutput) agentSessionId = agentSessionId ?? protocol.sessionIdFromOutput(`${result.stdout}\n${result.stderr}`);
	if (protocol.buildResumeInvocation && result.exitCode !== 0 && agentSessionId && !result.limitExceeded) {
		const resumeInvocation = protocol.buildResumeInvocation({
			profile: options.profile,
			sessionId: agentSessionId,
			executionCwd
		});
		const { tmux: _resumeTmux, ...resumeResult } = await finalizeExecutorCancellationOnError({
			path: run.metadataPath,
			patch: {
				command: resumeInvocation.command,
				args: resumeInvocation.args,
				executionHost,
				projectRoot: workspace.rootPath,
				executionCwd,
				timeoutMs: limits.timeoutMs,
				maxStdoutBytes: limits.maxStdoutBytes,
				maxStderrBytes: limits.maxStderrBytes,
				resumed: true
			},
			run: () => executeProcess({
				command: resumeInvocation.command,
				args: resumeInvocation.args,
				cwd: executionCwd,
				stdin: resumeInvocation.stdin,
				env,
				host: executionHost,
				pathArgIndexes: resumeInvocation.pathArgIndexes,
				limits,
				stdoutPath: join(run.runDir, "resume-stdout.md"),
				stderrPath: join(run.runDir, "resume-stderr.log"),
				tmux: {
					runDir: join(run.runDir, "resume"),
					runId: `${run.runId}-resume`,
					ownerRunId: options.tmuxOwnerRunId,
					ref: options.claim.ref,
					kind: "block",
					enabled: options.tmuxEnabled
				},
				sessionIdFromOutput: protocol.sessionIdFromOutput,
				onSessionId,
				signal: options.signal
			})
		});
		finalResult = {
			stdout: [
				result.stdout.trim(),
				"--- resume stdout ---",
				resumeResult.stdout.trim()
			].filter(Boolean).join("\n"),
			stderr: [
				result.stderr.trim(),
				"--- resume stderr ---",
				resumeResult.stderr.trim()
			].filter(Boolean).join("\n"),
			exitCode: resumeResult.exitCode,
			timedOut: result.timedOut || resumeResult.timedOut,
			limitExceeded: resumeResult.limitExceeded
		};
		if (protocol.sessionIdFromOutput) agentSessionId = agentSessionId ?? protocol.sessionIdFromOutput(`${resumeResult.stdout}\n${resumeResult.stderr}`);
		resumed = true;
	}
	if (protocol.buildResumeInvocation) {
		await writeFile(join(run.runDir, "stdout.md"), finalResult.stdout, "utf8");
		await writeFile(join(run.runDir, "stderr.log"), finalResult.stderr, "utf8");
	}
	const interpretation = await protocol.interpretResult?.({
		profile: options.profile,
		executorName: options.executorName,
		result: finalResult,
		invocation,
		runDir: run.runDir,
		agentSessionId,
		resumed
	}) ?? {};
	if (interpretation.agentSessionId !== void 0) agentSessionId = interpretation.agentSessionId;
	const formatFailure = protocol.formatFailureMessage ?? defaultFailureMessage;
	const failureReason = (finalResult.exitCode !== 0 ? formatFailure({
		executorName: options.executorName,
		result: finalResult,
		limits
	}) : null) ?? interpretation.successFailureReason ?? null;
	const metadataPatch = {
		command: invocation.command,
		args: invocation.args,
		projectRoot: workspace.rootPath,
		executionCwd,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		...sessionResultFields(protocol.sessionMetadataKey, agentSessionId),
		...protocol.finishMetadata?.({
			kind: "block",
			profile: options.profile,
			invocation,
			agentSessionId,
			resumed,
			failureReason
		}) ?? {}
	};
	if (failureReason) {
		await finalizeExecutorAttemptMetadata({
			path: run.metadataPath,
			outcome: "failed",
			exitCode: finalResult.exitCode,
			timedOut: finalResult.timedOut,
			failureReason,
			patch: metadataPatch
		});
		throw new Error(failureReason);
	}
	const sessionFields = sessionResultFields(protocol.sessionMetadataKey, agentSessionId);
	const adapter = protocol.adapter;
	if (options.claim.blockType === "review") {
		if (!reviewResultPath) {
			const reason = `Executor '${options.executorName}' did not prepare a review result path.`;
			await finalizeExecutorAttemptMetadata({
				path: run.metadataPath,
				outcome: "failed",
				exitCode: finalResult.exitCode,
				timedOut: finalResult.timedOut,
				failureReason: reason,
				patch: metadataPatch
			});
			throw new Error(reason);
		}
		let artifactReference;
		try {
			let raw;
			if (protocol.reviewResultMode === "stdout-json") raw = JSON.parse(finalResult.stdout.trim());
			else {
				await assertReviewResultJsonReadable({
					executorName: options.executorName,
					resultPath: reviewResultPath
				});
				raw = await readJsonFile(reviewResultPath);
			}
			artifactReference = await materializeReviewArtifact({
				ref: options.claim.ref,
				taskId: options.claim.taskId,
				reviewResult: raw,
				path: reviewResultPath
			});
		} catch (error) {
			const reason = `Executor '${options.executorName}' produced an invalid review artifact: ${error instanceof Error ? error.message : String(error)}`;
			await finalizeExecutorAttemptMetadata({
				path: run.metadataPath,
				outcome: "failed",
				exitCode: finalResult.exitCode,
				timedOut: finalResult.timedOut,
				failureReason: reason,
				patch: metadataPatch
			});
			throw new Error(reason);
		}
		await finalizeExecutorAttemptMetadata({
			path: run.metadataPath,
			outcome: "succeeded",
			exitCode: finalResult.exitCode,
			timedOut: finalResult.timedOut,
			failureReason: null,
			patch: {
				...metadataPatch,
				artifactReference
			}
		});
		return {
			kind: "review",
			resultPath: reviewResultPath,
			runId: run.runId,
			executor: options.executorName,
			adapter,
			agentId: options.profile.agent,
			runnerKind: options.profile.runner.transport,
			...sessionFields,
			...finalResult
		};
	}
	const reportPath = join(run.runDir, "report.md");
	let artifactReference;
	try {
		artifactReference = await materializeImplementationArtifact({
			ref: options.claim.ref,
			taskId: options.claim.taskId,
			reportMarkdown: interpretation.reportContent ?? finalResult.stdout,
			path: reportPath
		});
	} catch (error) {
		const reason = `Executor '${options.executorName}' produced an invalid implementation artifact: ${error instanceof Error ? error.message : String(error)}`;
		await finalizeExecutorAttemptMetadata({
			path: run.metadataPath,
			outcome: "failed",
			exitCode: finalResult.exitCode,
			timedOut: finalResult.timedOut,
			failureReason: reason,
			patch: metadataPatch
		});
		throw new Error(reason);
	}
	await finalizeExecutorAttemptMetadata({
		path: run.metadataPath,
		outcome: "succeeded",
		exitCode: finalResult.exitCode,
		timedOut: finalResult.timedOut,
		failureReason: null,
		patch: {
			...metadataPatch,
			artifactReference
		}
	});
	return {
		kind: "block",
		reportPath,
		runId: run.runId,
		executor: options.executorName,
		adapter,
		agentId: options.profile.agent,
		runnerKind: options.profile.runner.transport,
		...sessionFields,
		...finalResult
	};
}
/**
* Shared feedback lifecycle for terminal-agent executors.
* Resume is intentionally not applied to feedback runs.
*/
async function runTerminalAgentProtocolFeedback(options) {
	const protocol = options.protocol;
	const executeProcess = options.executeProcess;
	const runRoot = join(options.workspaceResultsDir, "feedback-runs");
	const runId = await allocateRunId(runRoot);
	const runDir = join(runRoot, runId);
	const metadataPath = join(runDir, "metadata.json");
	const promptPath = join(runDir, "prompt.md");
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	await writeFile(promptPath, options.claim.content, "utf8");
	const invocation = protocol.buildInvocation({
		profile: options.profile,
		prompt: options.claim.content,
		promptPath,
		executionCwd: options.executionCwd
	});
	const limits = executorRuntimeLimits(options.profile);
	const executionHost = executorProfileExecutionHost(options.profile);
	await writeJsonFile(metadataPath, {
		runId,
		feedbackId: options.claim.feedbackId,
		sourceReviewBlockRef: options.claim.sourceReviewBlockRef,
		taskId: options.claim.taskId,
		executor: options.executorName,
		adapter: protocol.adapter,
		agentId: options.profile.agent,
		runnerKind: options.profile.runner.transport,
		executionHost,
		projectRoot: options.projectRoot,
		executionCwd: options.executionCwd,
		startedAt,
		finishedAt: null,
		exitCode: null,
		command: invocation.command,
		args: invocation.args,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		timedOut: false,
		...sessionResultFields(protocol.sessionMetadataKey, null)
	});
	let agentSessionId = null;
	const onSessionId = async (sessionId) => {
		if (agentSessionId) return;
		agentSessionId = sessionId;
		await finishRunMetadata(metadataPath, sessionResultFields(protocol.sessionMetadataKey, sessionId));
	};
	if (invocation.sessionId) await onSessionId(invocation.sessionId);
	const { tmux: _tmux, ...result } = await finalizeExecutorCancellationOnError({
		path: metadataPath,
		patch: {
			command: invocation.command,
			args: invocation.args,
			timeoutMs: limits.timeoutMs,
			maxStdoutBytes: limits.maxStdoutBytes,
			maxStderrBytes: limits.maxStderrBytes
		},
		run: () => executeProcess({
			command: invocation.command,
			args: invocation.args,
			cwd: options.executionCwd,
			stdin: invocation.stdin,
			env: workspaceExecutorEnv({ planweaveHome: options.planweaveHome }),
			host: executionHost,
			pathArgIndexes: invocation.pathArgIndexes,
			limits,
			stdoutPath: join(runDir, "stdout.md"),
			stderrPath: join(runDir, "stderr.log"),
			tmux: {
				runDir,
				runId,
				ownerRunId: options.tmuxOwnerRunId,
				kind: "feedback",
				enabled: options.tmuxEnabled
			},
			sessionIdFromOutput: protocol.sessionIdFromOutput,
			onSessionId,
			onTmuxReady: async (tmux) => finishRunMetadata(metadataPath, tmuxMetadataPatch(tmux)),
			signal: options.signal
		})
	});
	if (protocol.sessionIdFromOutput) agentSessionId = agentSessionId ?? protocol.sessionIdFromOutput(`${result.stdout}\n${result.stderr}`);
	const interpretation = await protocol.interpretResult?.({
		profile: options.profile,
		executorName: options.executorName,
		result,
		invocation,
		runDir,
		agentSessionId,
		resumed: false
	}) ?? {};
	if (interpretation.agentSessionId !== void 0) agentSessionId = interpretation.agentSessionId;
	const formatFailure = protocol.formatFailureMessage ?? defaultFailureMessage;
	const failureReason = (result.exitCode !== 0 ? formatFailure({
		executorName: options.executorName,
		result,
		limits
	}) : null) ?? interpretation.successFailureReason ?? null;
	const metadataPatch = {
		command: invocation.command,
		args: invocation.args,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		...sessionResultFields(protocol.sessionMetadataKey, agentSessionId),
		...protocol.finishMetadata?.({
			kind: "feedback",
			profile: options.profile,
			invocation,
			agentSessionId,
			resumed: false,
			failureReason
		}) ?? {}
	};
	if (failureReason) {
		await finalizeExecutorAttemptMetadata({
			path: metadataPath,
			outcome: "failed",
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			failureReason,
			patch: metadataPatch
		});
		throw new Error(failureReason);
	}
	const reportPath = join(runDir, "feedback-report.md");
	let artifactReference;
	try {
		artifactReference = await materializeFeedbackArtifact({
			feedbackId: options.claim.feedbackId,
			sourceReviewBlockRef: options.claim.sourceReviewBlockRef,
			taskId: options.claim.taskId,
			reportMarkdown: interpretation.reportContent ?? result.stdout,
			path: reportPath
		});
	} catch (error) {
		const reason = `Executor '${options.executorName}' produced an invalid feedback artifact: ${error instanceof Error ? error.message : String(error)}`;
		await finalizeExecutorAttemptMetadata({
			path: metadataPath,
			outcome: "failed",
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			failureReason: reason,
			patch: metadataPatch
		});
		throw new Error(reason);
	}
	await finalizeExecutorAttemptMetadata({
		path: metadataPath,
		outcome: "succeeded",
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		failureReason: null,
		patch: {
			...metadataPatch,
			artifactReference
		}
	});
	return {
		kind: "feedback",
		reportPath,
		runId,
		executor: options.executorName,
		adapter: protocol.adapter,
		agentId: options.profile.agent,
		runnerKind: options.profile.runner.transport,
		...sessionResultFields(protocol.sessionMetadataKey, agentSessionId),
		...result
	};
}
var init_terminalAgentExecutor = __esmMin((() => {
	init_json();
	init_loadPackage();
	init_types();
	init_executorShared();
	init_reviewResultContract();
	init_runnerArtifactMaterialization();
	init_tmuxExecutor();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/simpleTerminalAgent.js
/** Protocol preset for a terminal dialect that uses profile argv and has no session capture. */
function simpleTerminalProtocol(adapter) {
	return {
		adapter,
		reviewResultMode: "result-file",
		buildInvocation({ profile, prompt }) {
			return {
				command: profile.command,
				args: profile.args,
				stdin: prompt
			};
		}
	};
}
function runSimpleTerminalAgentBlock(options) {
	return runTerminalAgentProtocolBlock(options);
}
function runSimpleTerminalAgentFeedback(options) {
	return runTerminalAgentProtocolFeedback(options);
}
var init_simpleTerminalAgent = __esmMin((() => {
	init_terminalAgentExecutor();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/claudeCodeIntegration.js
var claudeCodeProtocol, claudeCodeAgentDefinition;
var init_claudeCodeIntegration = __esmMin((() => {
	init_executorIntegration();
	init_executorShared();
	init_simpleTerminalAgent();
	claudeCodeProtocol = simpleTerminalProtocol("claude-code-exec");
	claudeCodeAgentDefinition = {
		agent: "claude-code",
		builtinProfiles: {
			"claude-code": {
				adapter: "agent",
				agent: "claude-code",
				runner: { transport: "cli" },
				command: "claude",
				args: ["-p"]
			},
			"claude-code-auto": {
				adapter: "agent",
				agent: "claude-code",
				runner: { transport: "cli" },
				command: "claude",
				args: ["-p"]
			},
			"claude-code-acp": {
				adapter: "agent",
				agent: "claude-code",
				runner: { transport: "acp" }
			}
		},
		cli: {
			integration: "claude-code-exec",
			runBlock(input, context) {
				if (input.profile.agent !== "claude-code") throw executorProfileMismatch("claude-code-exec", input.profile);
				return runSimpleTerminalAgentBlock({
					projectRoot: input.projectRoot,
					claim: input.claim,
					prompt: input.prompt,
					executorName: input.executorName,
					profile: input.profile,
					protocol: claudeCodeProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executionWaveId: input.executionWaveId,
					executeProcess: context.executeProcess
				});
			},
			runFeedback(input, context) {
				if (input.profile.agent !== "claude-code") throw executorProfileMismatch("claude-code-exec", input.profile);
				return runSimpleTerminalAgentFeedback({
					projectRoot: input.workspace.rootPath,
					executionCwd: workspaceExecutionCwd(input.workspace),
					planweaveHome: input.workspace.planweaveHome,
					workspaceResultsDir: input.workspace.resultsDir,
					claim: input.claim,
					executorName: input.executorName,
					profile: input.profile,
					protocol: claudeCodeProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executeProcess: context.executeProcess
				});
			}
		},
		acp: {
			launch: {
				command: "claude-agent-acp",
				args: [],
				source: {
					registryId: "claude-acp",
					version: "0.58.1",
					url: "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
					descriptor: "@agentclientprotocol/claude-agent-acp@0.58.1"
				}
			},
			capabilities: [
				"session",
				"prompt",
				"cancel",
				"streaming",
				"tool-updates"
			],
			optionalCapabilities: [
				"permission",
				"authentication",
				"image",
				"embedded-context",
				"session-close",
				"history-load"
			],
			limitations: ["Requires a separately installed claude-agent-acp executable and agent-owned authentication."]
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/codexProtocol.js
function codexExecArgs(profile) {
	if (!profile.sandbox) return profile.args;
	const stdinPromptIndex = profile.args.lastIndexOf("-");
	const sandboxArgs = ["--sandbox", profile.sandbox];
	if (stdinPromptIndex === -1) return [...profile.args, ...sandboxArgs];
	return [
		...profile.args.slice(0, stdinPromptIndex),
		...sandboxArgs,
		...profile.args.slice(stdinPromptIndex)
	];
}
function codexResumeArgs(profile, sessionId, prompt) {
	const execIndex = profile.args.indexOf("exec");
	const prefix = execIndex === -1 ? [] : profile.args.slice(0, execIndex);
	const sandboxArgs = profile.sandbox ? ["--sandbox", profile.sandbox] : [];
	return [
		...prefix,
		"exec",
		...sandboxArgs,
		"resume",
		sessionId,
		prompt
	];
}
function findSessionIdValue(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const object = value;
	for (const key of [
		"codexSessionId",
		"sessionId",
		"session_id",
		"threadId",
		"thread_id"
	]) {
		const sessionId = object[key];
		if (typeof sessionId === "string" && sessionId.trim()) return sessionId;
	}
	for (const key of ["session", "thread"]) {
		const nested = object[key];
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const id = nested.id;
			if (typeof id === "string" && id.trim()) return id;
		}
	}
	for (const nested of Object.values(object)) {
		const sessionId = findSessionIdValue(nested);
		if (sessionId) return sessionId;
	}
	return null;
}
function extractCodexSessionId(output) {
	for (const line of output.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const sessionId = findSessionIdValue(JSON.parse(trimmed));
			if (sessionId) return sessionId;
		} catch {
			const match = trimmed.match(/^(?:codexSessionId|sessionId|session_id|session id|threadId|thread_id)\s*[:=]\s*([A-Za-z0-9_.:-]+)$/i);
			if (match) return match[1];
			const statusSessionMatch = trimmed.match(CODEX_STATUS_SESSION_PATTERN);
			if (statusSessionMatch) return statusSessionMatch[1];
		}
	}
	return null;
}
var CODEX_STATUS_SESSION_PATTERN;
var init_codexProtocol = __esmMin((() => {
	CODEX_STATUS_SESSION_PATTERN = /(?:^|[\s│|>])Session\s*:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|[│|]|$)/i;
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/codexExecutor.js
async function runCodexBlock(options) {
	return runTerminalAgentProtocolBlock({
		...options,
		protocol: codexProtocol
	});
}
async function runCodexFeedback(options) {
	return runTerminalAgentProtocolFeedback({
		...options,
		protocol: codexProtocol
	});
}
var codexProtocol;
var init_codexExecutor = __esmMin((() => {
	init_codexProtocol();
	init_terminalAgentExecutor();
	codexProtocol = {
		adapter: "codex-exec",
		sessionMetadataKey: "codexSessionId",
		reviewResultMode: "stdout-json",
		usesReviewResultEnvironment: false,
		preparePrompt({ prompt }) {
			return prompt;
		},
		buildInvocation({ profile, prompt }) {
			return {
				command: profile.command,
				args: codexExecArgs(profile),
				stdin: prompt
			};
		},
		sessionIdFromOutput: extractCodexSessionId,
		buildResumeInvocation({ profile, sessionId }) {
			return {
				command: profile.command,
				args: codexResumeArgs(profile, sessionId, "continue this block and produce the required report"),
				stdin: ""
			};
		},
		finishMetadata({ kind, profile, resumed }) {
			if (kind === "feedback") return {};
			return {
				sandbox: profile.sandbox ?? null,
				role: profile.role ?? null,
				resumed
			};
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/codexIntegration.js
var codexAgentDefinition;
var init_codexIntegration = __esmMin((() => {
	init_codexExecutor();
	init_executorShared();
	init_executorIntegration();
	codexAgentDefinition = {
		agent: "codex",
		builtinProfiles: {
			codex: {
				adapter: "agent",
				agent: "codex",
				runner: { transport: "cli" },
				command: "codex",
				args: ["exec", "-"]
			},
			"codex-auto": {
				adapter: "agent",
				agent: "codex",
				runner: { transport: "cli" },
				command: "codex",
				args: ["exec", "-"]
			},
			"codex-acp": {
				adapter: "agent",
				agent: "codex",
				runner: { transport: "acp" }
			}
		},
		cli: {
			integration: "codex-exec",
			runBlock(input, context) {
				if (input.profile.agent !== "codex") throw executorProfileMismatch("codex-exec", input.profile);
				return runCodexBlock({
					projectRoot: input.projectRoot,
					claim: input.claim,
					prompt: input.prompt,
					executorName: input.executorName,
					profile: input.profile,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executionWaveId: input.executionWaveId,
					executeProcess: context.executeProcess
				});
			},
			runFeedback(input, context) {
				if (input.profile.agent !== "codex") throw executorProfileMismatch("codex-exec", input.profile);
				return runCodexFeedback({
					projectRoot: input.workspace.rootPath,
					executionCwd: workspaceExecutionCwd(input.workspace),
					planweaveHome: input.workspace.planweaveHome,
					workspaceResultsDir: input.workspace.resultsDir,
					claim: input.claim,
					executorName: input.executorName,
					profile: input.profile,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executeProcess: context.executeProcess
				});
			}
		},
		acp: {
			launch: {
				command: "codex-acp",
				args: [],
				source: {
					registryId: "codex-acp",
					version: "1.1.2",
					url: "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
					descriptor: "@agentclientprotocol/codex-acp@1.1.2"
				}
			},
			capabilities: [
				"session",
				"prompt",
				"cancel",
				"streaming",
				"tool-updates"
			],
			optionalCapabilities: [
				"permission",
				"authentication",
				"image",
				"embedded-context",
				"session-close",
				"history-load"
			],
			limitations: ["Requires a separately installed codex-acp executable and agent-owned authentication."]
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/grokIntegration.js
var grokProtocol, grokAgentDefinition;
var init_grokIntegration = __esmMin((() => {
	init_executorIntegration();
	init_executorShared();
	init_simpleTerminalAgent();
	grokProtocol = {
		adapter: "grok-exec",
		reviewResultMode: "result-file",
		buildInvocation({ profile, promptPath }) {
			return {
				command: profile.command,
				args: [...profile.args, promptPath],
				pathArgIndexes: [profile.args.length],
				stdin: ""
			};
		}
	};
	grokAgentDefinition = {
		agent: "grok",
		builtinProfiles: {
			grok: {
				adapter: "agent",
				agent: "grok",
				runner: { transport: "cli" },
				command: "grok",
				args: ["--no-auto-update", "--prompt-file"]
			},
			"grok-acp": {
				adapter: "agent",
				agent: "grok",
				runner: { transport: "acp" }
			}
		},
		cli: {
			integration: "grok-exec",
			runBlock(input, context) {
				if (input.profile.agent !== "grok") throw executorProfileMismatch("grok-exec", input.profile);
				return runSimpleTerminalAgentBlock({
					projectRoot: input.projectRoot,
					claim: input.claim,
					prompt: input.prompt,
					executorName: input.executorName,
					profile: input.profile,
					protocol: grokProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executionWaveId: input.executionWaveId,
					executeProcess: context.executeProcess
				});
			},
			runFeedback(input, context) {
				if (input.profile.agent !== "grok") throw executorProfileMismatch("grok-exec", input.profile);
				return runSimpleTerminalAgentFeedback({
					projectRoot: input.workspace.rootPath,
					executionCwd: workspaceExecutionCwd(input.workspace),
					planweaveHome: input.workspace.planweaveHome,
					workspaceResultsDir: input.workspace.resultsDir,
					claim: input.claim,
					executorName: input.executorName,
					profile: input.profile,
					protocol: grokProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executeProcess: context.executeProcess
				});
			}
		},
		acp: {
			launch: {
				command: "grok",
				args: [
					"--no-auto-update",
					"agent",
					"stdio"
				],
				source: {
					registryId: "xai-grok-cli",
					version: "0.2.101",
					url: "https://docs.x.ai/build/cli/headless-scripting",
					descriptor: "xAI Grok CLI 0.2.101: grok --no-auto-update agent stdio (verified 2026-07-15)"
				}
			},
			authentication: {
				preferredMethodIds: ["xai.api_key", "cached_token"],
				headlessSafeMethodIds: ["cached_token"]
			},
			capabilities: [
				"session",
				"prompt",
				"cancel",
				"streaming",
				"tool-updates"
			],
			optionalCapabilities: [
				"permission",
				"authentication",
				"image",
				"embedded-context",
				"session-close",
				"history-load"
			],
			limitations: ["The trusted launch was verified against xAI Grok CLI 0.2.101 help and xAI Headless & Scripting documentation on 2026-07-15.", "Interactive Grok authentication must be completed outside headless PlanWeave execution before retrying; ACP never falls back to the Grok CLI runner."]
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/opencodeInvocation.js
function hasOption(args, name) {
	return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}
function optionValue(args, name) {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === name) return args[index + 1] ?? null;
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}
function shortOptionValue(args, name) {
	for (let index = 0; index < args.length; index += 1) if (args[index] === name) return args[index + 1] ?? null;
	return null;
}
function withWorkingDirectory(args, cwd) {
	if (hasOption(args, "--dir")) return args;
	const next = [...args];
	const runIndex = next.indexOf("run");
	next.splice(runIndex + 1, 0, "--dir", cwd);
	return next;
}
function withSandbox(args, sandbox) {
	if (sandbox !== "danger-full-access" || hasOption(args, "--auto")) return args;
	const runIndex = args.indexOf("run");
	if (runIndex === -1) return args;
	const next = [...args];
	next.splice(runIndex + 1, 0, "--auto");
	return next;
}
function isDirectOpencodeRun(profile) {
	return basename(profile.command) === "opencode" && profile.args.includes("run");
}
function opencodeInvocation(profile, prompt, cwd) {
	if (!isDirectOpencodeRun(profile)) return {
		args: profile.args,
		stdin: prompt,
		jsonMode: false,
		sessionId: null
	};
	const args = withSandbox(withWorkingDirectory(profile.args, cwd), profile.sandbox);
	const sessionId = optionValue(args, "--session") ?? shortOptionValue(args, "-s");
	const runIndex = args.indexOf("run");
	const promptPlaceholderIndex = args.lastIndexOf("-");
	if (promptPlaceholderIndex > runIndex) args[promptPlaceholderIndex] = prompt;
	else args.push(prompt);
	return {
		args,
		stdin: "",
		jsonMode: optionValue(args, "--format") === "json",
		sessionId
	};
}
var init_opencodeInvocation = __esmMin((() => {}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/opencodeOutput.js
function stringValue(value) {
	return typeof value === "string" && value.trim() ? value : null;
}
function isRecord$1(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractSessionIdFromObject(value) {
	if (!isRecord$1(value)) return null;
	return stringValue(value.sessionID) ?? stringValue(value.sessionId) ?? stringValue(value.session_id) ?? stringValue(value.threadId) ?? stringValue(value.thread_id) ?? extractSessionIdFromObject(value.part);
}
function normalizeTerminalLine(line) {
	return line.replace(ansiEscapePattern, "").trim();
}
function cleanSessionToken(value) {
	const cleaned = value?.replace(/^[`'"]+|[`'",;]+$/g, "");
	if (!cleaned || !/^[A-Za-z0-9_.:-]+$/.test(cleaned)) return null;
	return cleaned;
}
function firstSessionToken(value) {
	for (const token of value.replaceAll("*", "").trim().split(/\s+/)) {
		const sessionId = cleanSessionToken(token);
		if (sessionId) return sessionId;
	}
	return null;
}
function labeledSessionId(line) {
	const colonIndex = line.indexOf(":");
	const equalsIndex = line.indexOf("=");
	const separatorIndex = colonIndex === -1 ? equalsIndex : equalsIndex === -1 ? colonIndex : Math.min(colonIndex, equalsIndex);
	if (separatorIndex === -1) return null;
	const label = line.slice(0, separatorIndex).replaceAll("*", "").toLowerCase().replace(/[\s_-]/g, "");
	if (!sessionLabels.has(label)) return null;
	return firstSessionToken(line.slice(separatorIndex + 1));
}
function commandSessionId(line) {
	const tokens = line.split(/\s+/).filter(Boolean);
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index] !== "opencode") continue;
		const option = tokens[index + 1];
		if (option === "-s" || option === "--session") return cleanSessionToken(tokens[index + 2]);
	}
	return null;
}
function extractOpencodeSessionId(output) {
	const jsonSessionId = parseOpencodeJsonOutput(output).sessionId;
	if (jsonSessionId) return jsonSessionId;
	for (const line of output.split(/\r?\n/)) {
		const trimmed = normalizeTerminalLine(line);
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			const sessionId = parsed.sessionID ?? parsed.sessionId ?? parsed.session_id ?? parsed.threadId ?? parsed.thread_id;
			if (typeof sessionId === "string" && sessionId.trim()) return sessionId;
		} catch {
			const sessionId = labeledSessionId(trimmed) ?? commandSessionId(trimmed);
			if (sessionId) return sessionId;
		}
	}
	return null;
}
function textPart(value) {
	if (!isRecord$1(value)) return null;
	const part = value.part;
	if (isRecord$1(part) && part.type === "text") return stringValue(part.text);
	if (value.type === "text") return stringValue(value.text);
	return null;
}
function toolSummary(value) {
	if (!isRecord$1(value)) return null;
	const part = isRecord$1(value.part) ? value.part : value;
	if (part.type !== "tool" && value.type !== "tool_use") return null;
	const tool = stringValue(part.tool) ?? "tool";
	const title = stringValue(part.title);
	const state = isRecord$1(part.state) ? part.state : {};
	const status = stringValue(state.status);
	const output = stringValue(state.output);
	return [
		`- ${tool}`,
		title ? ` ${title}` : "",
		status ? ` (${status})` : "",
		output ? `: ${output}` : ""
	].join("");
}
function errorDetails(value, options = {}) {
	if (!isRecord$1(value)) return null;
	let error = null;
	if (isRecord$1(value.error)) error = value.error;
	else if (value.type === "error" || options.allowBareErrorObject) error = value;
	if (!error) return null;
	const data = isRecord$1(error.data) ? error.data : {};
	const name = stringValue(error.name);
	const message = stringValue(data.message) ?? stringValue(error.message);
	const ref = stringValue(data.ref) ?? stringValue(error.ref);
	return name || message || ref ? {
		name,
		message,
		ref
	} : null;
}
function formatErrorDetails(details) {
	return `${details.name ? `OpenCode error ${details.name}` : "OpenCode error"}${details.message && details.message !== details.name ? `: ${details.message}` : ""}${details.ref ? ` (ref: ${details.ref})` : ""}`;
}
function jsonObjectCandidates(input) {
	const candidates = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			continue;
		}
		if (char === "{") {
			if (depth === 0) start = index;
			depth += 1;
			continue;
		}
		if (char !== "}" || depth === 0) continue;
		depth -= 1;
		if (depth === 0 && start >= 0) {
			candidates.push({
				json: input.slice(start, index + 1),
				start
			});
			start = -1;
		}
	}
	return candidates;
}
function hasTerminalErrorPrefix(input, jsonStart) {
	const prefix = input.slice(Math.max(0, jsonStart - 80), jsonStart);
	return /(?:^|\s)(?:Error|OpenCode error)\s*:\s*$/i.test(prefix);
}
function formatOpencodeErrorOutput(stdout, stderr) {
	const combined = `${stdout}\n${stderr}`.replace(ansiEscapePattern, "");
	for (const line of combined.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const details = errorDetails(JSON.parse(trimmed));
			if (details) return formatErrorDetails(details);
		} catch {}
	}
	for (const candidate of jsonObjectCandidates(combined)) try {
		const details = errorDetails(JSON.parse(candidate.json), { allowBareErrorObject: hasTerminalErrorPrefix(combined, candidate.start) });
		if (details) return formatErrorDetails(details);
	} catch {}
	return null;
}
function parseOpencodeJsonOutput(output) {
	const textParts = [];
	const toolSummaries = [];
	let parsedAny = false;
	let sessionId = null;
	let error = null;
	for (const line of output.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		parsedAny = true;
		sessionId = sessionId ?? extractSessionIdFromObject(parsed);
		const details = errorDetails(parsed);
		error = error ?? (details ? formatErrorDetails(details) : null);
		const text = textPart(parsed);
		if (text) textParts.push(text);
		const summary = toolSummary(parsed);
		if (summary) toolSummaries.push(summary);
	}
	return {
		parsedAny,
		sessionId,
		error,
		text: textParts.join("\n\n").trim(),
		toolSummaries
	};
}
function withSessionListHint(report, output, fallbackStdout, fallbackStderr, knownSessionId) {
	if ((knownSessionId ?? output.sessionId ?? extractOpencodeSessionId(`${fallbackStdout}\n${fallbackStderr}`)) || !report.trim()) return report;
	return `${report.trim()}\n\n---\n${sessionListHint}`;
}
function opencodeReport(output, fallbackStdout, fallbackStderr, knownSessionId) {
	let report;
	if (output.text) report = output.text;
	else if (output.toolSummaries.length > 0) report = [
		"## OpenCode Tool Summary",
		"",
		...output.toolSummaries
	].join("\n");
	else report = fallbackStdout.trim() || fallbackStderr.trim();
	return withSessionListHint(report, output, fallbackStdout, fallbackStderr, knownSessionId);
}
var ansiEscapePattern, sessionLabels, sessionListHint;
var init_opencodeOutput = __esmMin((() => {
	ansiEscapePattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;
	sessionLabels = /* @__PURE__ */ new Set([
		"opencodesessionid",
		"sessionid",
		"threadid"
	]);
	sessionListHint = "OpenCode session id was not found in this run output. Run `opencode session list` in the execution directory to find the latest OpenCode session.";
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/opencodeExecutor.js
async function runOpencodeBlock(options) {
	return runTerminalAgentProtocolBlock({
		...options,
		protocol: opencodeProtocol
	});
}
async function runOpencodeFeedback(options) {
	return runTerminalAgentProtocolFeedback({
		...options,
		protocol: opencodeProtocol
	});
}
var opencodeProtocol;
var init_opencodeExecutor = __esmMin((() => {
	init_executorShared();
	init_opencodeInvocation();
	init_opencodeOutput();
	init_terminalAgentExecutor();
	opencodeProtocol = {
		adapter: "opencode-exec",
		sessionMetadataKey: "opencodeSessionId",
		reviewResultMode: "result-file",
		buildInvocation({ profile, prompt, executionCwd }) {
			const invocation = opencodeInvocation(profile, prompt, executionCwd);
			return {
				command: profile.command,
				args: invocation.args,
				stdin: invocation.stdin,
				sessionId: invocation.sessionId,
				jsonMode: invocation.jsonMode
			};
		},
		sessionIdFromOutput: extractOpencodeSessionId,
		formatFailureMessage({ executorName, result, limits }) {
			if (result.limitExceeded) return executorLimitFailureMessage({
				executorName,
				limitExceeded: result.limitExceeded
			});
			const opencodeError = formatOpencodeErrorOutput(result.stdout, result.stderr);
			if (opencodeError) return `Executor '${executorName}' failed: ${opencodeError}`;
			return result.timedOut ? `Executor '${executorName}' timed out after ${limits.timeoutMs}ms.` : result.stderr.trim() || `Executor '${executorName}' exited with code ${result.exitCode}.`;
		},
		async interpretResult({ executorName, result, invocation, runDir, agentSessionId }) {
			const jsonOutput = parseOpencodeJsonOutput(result.stdout);
			const nextSessionId = agentSessionId ?? jsonOutput.sessionId ?? extractOpencodeSessionId(`${result.stdout}\n${result.stderr}`);
			if (jsonOutput.parsedAny || invocation.jsonMode) await writeFile(join(runDir, "events.ndjson"), result.stdout, "utf8");
			const structuredError = formatOpencodeErrorOutput(result.stdout, result.stderr) ?? jsonOutput.error;
			return {
				agentSessionId: nextSessionId,
				successFailureReason: structuredError ? `Executor '${executorName}' returned an OpenCode error event: ${structuredError}` : null,
				reportContent: opencodeReport(jsonOutput, result.stdout, result.stderr, nextSessionId)
			};
		},
		finishMetadata({ kind, profile, failureReason }) {
			if (kind === "feedback") return { failureReason };
			return {
				sandbox: profile.sandbox ?? null,
				resumed: false,
				failureReason
			};
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/opencodeIntegration.js
var opencodeAgentDefinition;
var init_opencodeIntegration = __esmMin((() => {
	init_executorIntegration();
	init_executorShared();
	init_opencodeExecutor();
	opencodeAgentDefinition = {
		agent: "opencode",
		builtinProfiles: {
			opencode: {
				adapter: "agent",
				agent: "opencode",
				runner: { transport: "cli" },
				command: "opencode",
				args: ["run", "-"]
			},
			"opencode-acp": {
				adapter: "agent",
				agent: "opencode",
				runner: { transport: "acp" }
			}
		},
		cli: {
			integration: "opencode-exec",
			runBlock(input, context) {
				if (input.profile.agent !== "opencode") throw executorProfileMismatch("opencode-exec", input.profile);
				return runOpencodeBlock({
					projectRoot: input.projectRoot,
					claim: input.claim,
					prompt: input.prompt,
					executorName: input.executorName,
					profile: input.profile,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executionWaveId: input.executionWaveId,
					executeProcess: context.executeProcess
				});
			},
			runFeedback(input, context) {
				if (input.profile.agent !== "opencode") throw executorProfileMismatch("opencode-exec", input.profile);
				return runOpencodeFeedback({
					projectRoot: input.workspace.rootPath,
					executionCwd: workspaceExecutionCwd(input.workspace),
					planweaveHome: input.workspace.planweaveHome,
					workspaceResultsDir: input.workspace.resultsDir,
					claim: input.claim,
					executorName: input.executorName,
					profile: input.profile,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executeProcess: context.executeProcess
				});
			}
		},
		acp: {
			launch: {
				command: "opencode",
				args: ["acp"],
				source: {
					registryId: "opencode",
					version: "1.17.18",
					url: "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
					descriptor: "opencode v1.17.18 binary: opencode acp"
				}
			},
			capabilities: [
				"session",
				"prompt",
				"cancel",
				"streaming",
				"tool-updates"
			],
			optionalCapabilities: [
				"permission",
				"authentication",
				"image",
				"embedded-context",
				"session-close",
				"history-load"
			],
			limitations: ["Requires an installed OpenCode v1.17.18-compatible binary and agent-owned provider configuration."]
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/piIntegration.js
var piProtocol, piAgentDefinition;
var init_piIntegration = __esmMin((() => {
	init_executorIntegration();
	init_executorShared();
	init_simpleTerminalAgent();
	piProtocol = simpleTerminalProtocol("pi-exec");
	piAgentDefinition = {
		agent: "pi",
		builtinProfiles: {
			pi: {
				adapter: "agent",
				agent: "pi",
				runner: { transport: "cli" },
				command: "pi",
				args: ["-p"]
			},
			"pi-auto": {
				adapter: "agent",
				agent: "pi",
				runner: { transport: "cli" },
				command: "pi",
				args: ["-p"]
			},
			"pi-acp": {
				adapter: "agent",
				agent: "pi",
				runner: { transport: "acp" }
			}
		},
		cli: {
			integration: "pi-exec",
			runBlock(input, context) {
				if (input.profile.agent !== "pi") throw executorProfileMismatch("pi-exec", input.profile);
				return runSimpleTerminalAgentBlock({
					projectRoot: input.projectRoot,
					claim: input.claim,
					prompt: input.prompt,
					executorName: input.executorName,
					profile: input.profile,
					protocol: piProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executionWaveId: input.executionWaveId,
					executeProcess: context.executeProcess
				});
			},
			runFeedback(input, context) {
				if (input.profile.agent !== "pi") throw executorProfileMismatch("pi-exec", input.profile);
				return runSimpleTerminalAgentFeedback({
					projectRoot: input.workspace.rootPath,
					executionCwd: workspaceExecutionCwd(input.workspace),
					planweaveHome: input.workspace.planweaveHome,
					workspaceResultsDir: input.workspace.resultsDir,
					claim: input.claim,
					executorName: input.executorName,
					profile: input.profile,
					protocol: piProtocol,
					tmuxEnabled: input.runtime?.tmuxEnabled ?? input.profile.runner.tmuxEnabled,
					tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
					signal: input.runtime?.signal,
					executeProcess: context.executeProcess
				});
			}
		},
		acp: {
			launch: {
				command: "pi-acp",
				args: [],
				source: {
					registryId: "pi-acp",
					version: "0.0.31",
					url: "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
					descriptor: "pi-acp@0.0.31"
				}
			},
			capabilities: [
				"session",
				"prompt",
				"cancel",
				"streaming",
				"tool-updates"
			],
			optionalCapabilities: [
				"authentication",
				"image",
				"embedded-context",
				"session-close",
				"history-load"
			],
			limitations: ["Requires separately installed pi-acp and pi executables; filesystem and terminal delegation are not supported."]
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/agentRegistry.js
function registeredAgentDefinitions() {
	return [
		definitions.codex,
		definitions.opencode,
		definitions["claude-code"],
		definitions.pi,
		definitions.grok
	];
}
function builtinAgentProfiles() {
	const profiles = {};
	for (const definition of registeredAgentDefinitions()) for (const [name, profile] of Object.entries(definition.builtinProfiles)) profiles[name] = profile;
	return profiles;
}
var definitions;
var init_agentRegistry = __esmMin((() => {
	init_claudeCodeIntegration();
	init_codexIntegration();
	init_grokIntegration();
	init_opencodeIntegration();
	init_piIntegration();
	definitions = {
		codex: codexAgentDefinition,
		opencode: opencodeAgentDefinition,
		"claude-code": claudeCodeAgentDefinition,
		pi: piAgentDefinition,
		grok: grokAgentDefinition
	};
}));
var init_desktopAgentSettings = __esmMin((() => {
	init_types();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/streamingExecutor.js
function appendScanBuffer(previous, chunk) {
	return `${previous}${chunk}`.slice(-8192);
}
async function readStreamedCommandResult(result) {
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		limitExceeded: result.limitExceeded
	};
}
async function runStreamingCommandWithSessionCapture(options) {
	let scanBuffer = "";
	let capturedSessionId = null;
	const captureSessionId = async (chunk) => {
		if (capturedSessionId) return;
		scanBuffer = appendScanBuffer(scanBuffer, chunk);
		const sessionId = options.sessionIdFromOutput(scanBuffer);
		if (!sessionId) return;
		capturedSessionId = sessionId;
		await options.onSessionId(sessionId);
	};
	return readStreamedCommandResult(await execWithStreaming({
		command: options.command,
		args: options.args,
		cwd: options.cwd,
		stdin: options.stdin,
		env: options.env,
		host: options.host,
		pathArgIndexes: options.pathArgIndexes,
		stdoutPath: options.stdoutPath,
		stderrPath: options.stderrPath,
		timeoutMs: options.timeoutMs,
		maxStdoutBytes: options.maxStdoutBytes,
		maxStderrBytes: options.maxStderrBytes,
		tmux: options.tmux,
		onStdout: captureSessionId,
		onStderr: captureSessionId,
		signal: options.signal
	}));
}
var init_streamingExecutor = __esmMin((() => {
	init_executorShared();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/cliProcess.js
var executeCliProcess;
var init_cliProcess = __esmMin((() => {
	init_streamingExecutor();
	init_tmuxExecutor();
	executeCliProcess = async (request) => {
		const host = request.host ?? { kind: "native" };
		if (host.kind === "wsl" && request.tmux.enabled === true) throw new Error("tmux monitoring is not supported for WSL execution hosts.");
		const tmux = await createTmuxSessionInfo({
			runDir: request.tmux.runDir,
			runId: request.tmux.runId,
			tmuxOwnerRunId: request.tmux.ownerRunId,
			ref: request.tmux.ref,
			kind: request.tmux.kind,
			enabled: request.tmux.enabled
		});
		await request.onTmuxReady?.(tmux);
		return {
			...await runStreamingCommandWithSessionCapture({
				command: request.command,
				args: request.args,
				cwd: request.cwd,
				stdin: request.stdin,
				env: request.env,
				host,
				pathArgIndexes: request.pathArgIndexes,
				timeoutMs: request.limits.timeoutMs,
				maxStdoutBytes: request.limits.maxStdoutBytes,
				maxStderrBytes: request.limits.maxStderrBytes,
				stdoutPath: request.stdoutPath,
				stderrPath: request.stderrPath,
				tmux,
				sessionIdFromOutput: request.sessionIdFromOutput ?? (() => null),
				onSessionId: request.onSessionId ?? (() => Promise.resolve()),
				signal: request.signal
			}),
			tmux
		};
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/localReviewExecutor.js
function executorFailureMessage(input) {
	if (input.result.limitExceeded) return executorLimitFailureMessage({
		executorName: input.executorName,
		limitExceeded: input.result.limitExceeded
	});
	return input.result.timedOut ? `Executor '${input.executorName}' timed out after ${input.limits.timeoutMs}ms.` : input.result.stderr.trim() || `Executor '${input.executorName}' exited with code ${input.result.exitCode}.`;
}
async function runLocalReviewBlock(options) {
	if (options.claim.blockType !== "review") throw new Error(`Executor '${options.executorName}' uses local-review and can only run review blocks.`);
	const run = await prepareBlockRun({
		projectRoot: options.projectRoot,
		claim: options.claim,
		executorName: options.executorName,
		adapter: "local-review",
		profile: options.profile,
		prompt: options.prompt
	});
	const workspace = await resolvePackageWorkspace(options.projectRoot);
	const executionCwd = workspaceExecutionCwd(workspace);
	const { blockId } = parseBlockRef(options.claim.ref);
	const stdoutPath = join(run.runDir, "stdout.md");
	const stderrPath = join(run.runDir, "stderr.log");
	const limits = executorRuntimeLimits(options.profile);
	const { tmux: _tmux, ...processResult } = await finalizeExecutorCancellationOnError({
		path: run.metadataPath,
		patch: {
			command: options.profile.command,
			args: options.profile.args,
			projectRoot: workspace.rootPath,
			executionCwd,
			sandbox: options.profile.sandbox ?? null,
			timeoutMs: limits.timeoutMs,
			maxStdoutBytes: limits.maxStdoutBytes,
			maxStderrBytes: limits.maxStderrBytes,
			agentSessionId: null,
			codexSessionId: null,
			resumed: false
		},
		run: () => options.executeProcess({
			command: options.profile.command,
			args: options.profile.args,
			cwd: executionCwd,
			stdin: options.prompt,
			env: workspaceExecutorEnv(workspace, {
				PLANWEAVE_REVIEW_BLOCK_REF: options.claim.ref,
				PLANWEAVE_TASK_ID: options.claim.taskId,
				PLANWEAVE_BLOCK_ID: blockId
			}),
			limits,
			stdoutPath,
			stderrPath,
			tmux: {
				runDir: run.runDir,
				runId: run.runId,
				ownerRunId: options.tmuxOwnerRunId,
				ref: options.claim.ref,
				kind: "block",
				enabled: options.tmuxEnabled
			},
			onTmuxReady: async (tmux) => finishRunMetadata(run.metadataPath, tmuxMetadataPatch(tmux)),
			signal: options.signal
		})
	});
	const streamed = {
		...processResult,
		stdoutPath,
		stderrPath
	};
	const failureReason = streamed.exitCode === 0 ? null : executorFailureMessage({
		executorName: options.executorName,
		result: streamed,
		limits
	});
	const metadataPatch = {
		command: options.profile.command,
		args: options.profile.args,
		projectRoot: workspace.rootPath,
		executionCwd,
		sandbox: options.profile.sandbox ?? null,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		agentSessionId: null,
		codexSessionId: null,
		resumed: false
	};
	if (failureReason) {
		await finalizeExecutorAttemptMetadata({
			path: run.metadataPath,
			outcome: "failed",
			exitCode: streamed.exitCode,
			timedOut: streamed.timedOut,
			failureReason,
			patch: metadataPatch
		});
		throw new Error(failureReason);
	}
	const resultPath = join(run.runDir, "review-result.json");
	let artifactReference;
	try {
		artifactReference = await materializeReviewArtifact({
			ref: options.claim.ref,
			taskId: options.claim.taskId,
			reviewResult: JSON.parse(streamed.stdout.trim()),
			path: resultPath
		});
	} catch (error) {
		const reason = `Executor '${options.executorName}' produced an invalid review artifact: ${error instanceof Error ? error.message : String(error)}`;
		await finalizeExecutorAttemptMetadata({
			path: run.metadataPath,
			outcome: "failed",
			exitCode: streamed.exitCode,
			timedOut: streamed.timedOut,
			failureReason: reason,
			patch: metadataPatch
		});
		throw new Error(reason);
	}
	await finalizeExecutorAttemptMetadata({
		path: run.metadataPath,
		outcome: "succeeded",
		exitCode: streamed.exitCode,
		timedOut: streamed.timedOut,
		failureReason: null,
		patch: {
			...metadataPatch,
			artifactReference
		}
	});
	return {
		kind: "review",
		resultPath,
		runId: run.runId,
		executor: options.executorName,
		adapter: "local-review",
		agentId: null,
		runnerKind: null,
		agentSessionId: null,
		codexSessionId: null,
		...streamed
	};
}
async function runLocalReviewFeedback(options) {
	const runRoot = join(options.workspaceResultsDir, "feedback-runs");
	const runId = await allocateRunId(runRoot);
	const runDir = join(runRoot, runId);
	const metadataPath = join(runDir, "metadata.json");
	const stdoutPath = join(runDir, "stdout.md");
	const stderrPath = join(runDir, "stderr.log");
	const limits = executorRuntimeLimits(options.profile);
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	await writeFile(join(runDir, "prompt.md"), options.claim.content, "utf8");
	await writeJsonFile(metadataPath, {
		runId,
		feedbackId: options.claim.feedbackId,
		sourceReviewBlockRef: options.claim.sourceReviewBlockRef,
		taskId: options.claim.taskId,
		executor: options.executorName,
		adapter: "local-review",
		agentId: null,
		runnerKind: null,
		projectRoot: options.projectRoot,
		executionCwd: options.executionCwd,
		startedAt,
		finishedAt: null,
		exitCode: null,
		command: options.profile.command,
		args: options.profile.args,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		timedOut: false,
		agentSessionId: null,
		codexSessionId: null
	});
	const { tmux: _tmux, ...processResult } = await finalizeExecutorCancellationOnError({
		path: metadataPath,
		patch: {
			command: options.profile.command,
			args: options.profile.args,
			timeoutMs: limits.timeoutMs,
			maxStdoutBytes: limits.maxStdoutBytes,
			maxStderrBytes: limits.maxStderrBytes,
			agentSessionId: null,
			codexSessionId: null
		},
		run: () => options.executeProcess({
			command: options.profile.command,
			args: options.profile.args,
			cwd: options.executionCwd,
			stdin: options.claim.content,
			env: workspaceExecutorEnv({ planweaveHome: options.planweaveHome }),
			limits,
			stdoutPath,
			stderrPath,
			tmux: {
				runDir,
				runId,
				ownerRunId: options.tmuxOwnerRunId,
				kind: "feedback",
				enabled: options.tmuxEnabled
			},
			onTmuxReady: async (tmux) => finishRunMetadata(metadataPath, tmuxMetadataPatch(tmux)),
			signal: options.signal
		})
	});
	const streamed = {
		...processResult,
		stdoutPath,
		stderrPath
	};
	const failureReason = streamed.exitCode === 0 ? null : executorFailureMessage({
		executorName: options.executorName,
		result: streamed,
		limits
	});
	const metadataPatch = {
		command: options.profile.command,
		args: options.profile.args,
		timeoutMs: limits.timeoutMs,
		maxStdoutBytes: limits.maxStdoutBytes,
		maxStderrBytes: limits.maxStderrBytes,
		agentSessionId: null,
		codexSessionId: null
	};
	if (failureReason) {
		await finalizeExecutorAttemptMetadata({
			path: metadataPath,
			outcome: "failed",
			exitCode: streamed.exitCode,
			timedOut: streamed.timedOut,
			failureReason,
			patch: metadataPatch
		});
		throw new Error(failureReason);
	}
	const reportPath = join(runDir, "feedback-report.md");
	let artifactReference;
	try {
		artifactReference = await materializeFeedbackArtifact({
			feedbackId: options.claim.feedbackId,
			sourceReviewBlockRef: options.claim.sourceReviewBlockRef,
			taskId: options.claim.taskId,
			reportMarkdown: streamed.stdout,
			path: reportPath
		});
	} catch (error) {
		const reason = `Executor '${options.executorName}' produced an invalid feedback artifact: ${error instanceof Error ? error.message : String(error)}`;
		await finalizeExecutorAttemptMetadata({
			path: metadataPath,
			outcome: "failed",
			exitCode: streamed.exitCode,
			timedOut: streamed.timedOut,
			failureReason: reason,
			patch: metadataPatch
		});
		throw new Error(reason);
	}
	await finalizeExecutorAttemptMetadata({
		path: metadataPath,
		outcome: "succeeded",
		exitCode: streamed.exitCode,
		timedOut: streamed.timedOut,
		failureReason: null,
		patch: {
			...metadataPatch,
			artifactReference
		}
	});
	return {
		kind: "feedback",
		reportPath,
		runId,
		executor: options.executorName,
		adapter: "local-review",
		agentId: null,
		runnerKind: null,
		agentSessionId: null,
		codexSessionId: null,
		...streamed
	};
}
var init_localReviewExecutor = __esmMin((() => {
	init_compileTaskGraph();
	init_json();
	init_loadPackage();
	init_runnerArtifactMaterialization();
	init_executorShared();
	init_tmuxExecutor();
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/localReviewIntegration.js
var localReviewExecutor;
var init_localReviewIntegration = __esmMin((() => {
	init_executorIntegration();
	init_cliProcess();
	init_executorShared();
	init_localReviewExecutor();
	localReviewExecutor = {
		adapter: "local-review",
		builtinProfiles: {},
		runBlock(input) {
			if (input.profile.adapter !== "local-review") throw executorProfileMismatch("local-review", input.profile);
			return runLocalReviewBlock({
				projectRoot: input.projectRoot,
				claim: input.claim,
				prompt: input.prompt,
				executorName: input.executorName,
				profile: input.profile,
				tmuxEnabled: input.runtime?.tmuxEnabled,
				tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
				signal: input.runtime?.signal,
				executeProcess: executeCliProcess
			});
		},
		runFeedback(input) {
			if (input.profile.adapter !== "local-review") throw executorProfileMismatch("local-review", input.profile);
			return runLocalReviewFeedback({
				projectRoot: input.workspace.rootPath,
				executionCwd: workspaceExecutionCwd(input.workspace),
				planweaveHome: input.workspace.planweaveHome,
				workspaceResultsDir: input.workspace.resultsDir,
				claim: input.claim,
				executorName: input.executorName,
				profile: input.profile,
				tmuxEnabled: input.runtime?.tmuxEnabled,
				tmuxOwnerRunId: input.runtime?.tmuxOwnerRunId,
				signal: input.runtime?.signal,
				executeProcess: executeCliProcess
			});
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/@planweave-ai+runtime@0.4.0/node_modules/@planweave-ai/runtime/dist/autoRun/manualExecutor.js
async function runManualBlock(input) {
	if (input.profile.adapter !== "manual") throw executorProfileMismatch("manual", input.profile);
	const run = await prepareBlockRun({
		projectRoot: input.projectRoot,
		claim: input.claim,
		executorName: input.executorName,
		adapter: "manual",
		profile: input.profile,
		prompt: input.prompt,
		executionWaveId: input.executionWaveId
	});
	const workspace = await resolvePackageWorkspace(input.projectRoot);
	const canvasFlag = await canvasCommandFlagForWorkspace(workspace);
	return {
		kind: "manual",
		executor: input.executorName,
		adapter: "manual",
		agentId: null,
		runnerKind: null,
		promptPath: run.promptPath,
		runDir: run.runDir,
		runId: run.runId,
		nextCommand: input.claim.blockType === "review" ? `planweave submit-review${canvasFlag} ${input.claim.ref} --result <review-result.json>` : `planweave submit-result${canvasFlag} ${input.claim.ref} --report <report.md>`
	};
}
async function runManualFeedback(input) {
	if (input.profile.adapter !== "manual") throw executorProfileMismatch("manual", input.profile);
	const canvasFlag = await canvasCommandFlagForWorkspace(input.workspace);
	const feedbackRoot = join(input.workspace.resultsDir, "feedback-runs");
	const runId = await allocateRunId(feedbackRoot);
	const runDir = join(feedbackRoot, runId);
	const promptPath = join(runDir, "feedback.md");
	const metadataPath = join(runDir, "metadata.json");
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	const nextCommand = `planweave submit-feedback${canvasFlag} --report <feedback-report.md>`;
	const executionCwd = workspaceExecutionCwd(input.workspace);
	await writeFile(promptPath, input.claim.content, "utf8");
	await writeJsonFile(metadataPath, {
		runId,
		feedbackId: input.claim.feedbackId,
		sourceReviewBlockRef: input.claim.sourceReviewBlockRef,
		taskId: input.claim.taskId,
		executor: input.executorName,
		adapter: "manual",
		agentId: null,
		runnerKind: null,
		projectRoot: input.workspace.rootPath,
		executionCwd,
		startedAt,
		finishedAt: null,
		exitCode: null,
		nextCommand
	});
	return {
		kind: "manual",
		executor: input.executorName,
		adapter: "manual",
		agentId: null,
		runnerKind: null,
		promptPath,
		runDir,
		runId,
		nextCommand
	};
}
var manualExecutor;
var init_manualExecutor = __esmMin((() => {
	init_loadPackage();
	init_canvasCommandScope();
	init_json();
	init_executorShared();
	init_executorIntegration();
	manualExecutor = {
		adapter: "manual",
		builtinProfiles: {
			default: { adapter: "manual" },
			manual: { adapter: "manual" }
		},
		runBlock: runManualBlock,
		runFeedback: runManualFeedback
	};
})), directExecutors;
var init_profileExecutor = __esmMin((() => {
	init_agentRegistry();
	init_localReviewIntegration();
	init_manualExecutor();
	directExecutors = {
		manual: manualExecutor,
		"local-review": localReviewExecutor
	};
	({
		...directExecutors.manual.builtinProfiles,
		...directExecutors["local-review"].builtinProfiles,
		...builtinAgentProfiles()
	});
}));
__esmMin((() => {
	init_desktopAgentSettings();
	init_profileExecutor();
}));
//#endregion
export {};

//# sourceMappingURL=executors-COVpN5Gh.mjs.map