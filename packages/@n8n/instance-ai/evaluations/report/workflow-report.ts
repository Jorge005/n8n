/**
 * HTML report generator for workflow test case evaluations.
 *
 * Produces a self-contained HTML file optimized for three tasks:
 * 1. Triage — which scenarios failed? (seconds)
 * 2. Diagnose — why did they fail? (minutes)
 * 3. Compare — what changed between runs? (cross-report)
 */

import fs from 'fs';
import path from 'path';

import type {
	MultiRunEvaluation,
	ScenarioResult,
	ScenarioAggregation,
	TestCaseAggregation,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Scenario rendering (single run detail)
// ---------------------------------------------------------------------------

function renderScenarioRun(sr: ScenarioResult, id: string): string {
	const icon = sr.success ? '&#10003;' : '&#10007;';
	const statusClass = sr.success ? 'pass' : 'fail';

	return `<div class="scenario ${statusClass}${sr.success ? '' : ' expanded'}">
		<div class="scenario-header" onclick="this.parentElement.classList.toggle('expanded')">
			<span class="scenario-icon ${statusClass}">${icon}</span>
			<span class="scenario-name">${escapeHtml(sr.scenario.name)}</span>
			${sr.success ? `<span class="scenario-summary-inline">${escapeHtml((sr.reasoning || 'All checks passed').slice(0, 150))}${sr.reasoning && sr.reasoning.length > 150 ? '...' : ''}</span>` : `<span class="scenario-desc">${escapeHtml(sr.scenario.description)}</span>`}
		</div>
		<div class="scenario-detail" id="${id}">
			${renderScenarioDetail(sr)}
		</div>
	</div>`;
}

function renderScenarioDetail(sr: ScenarioResult): string {
	let html = '';

	if (!sr.evalResult) {
		if (sr.reasoning) {
			html += `<div class="diagnosis">${escapeHtml(sr.reasoning)}</div>`;
		}
		return html;
	}

	// Failure category badge
	if (!sr.success && sr.failureCategory) {
		const catClass =
			sr.failureCategory === 'builder_issue'
				? 'warn'
				: sr.failureCategory === 'mock_issue'
					? 'fail'
					: 'info';
		html += `<div class="category-badge category-${catClass}">${escapeHtml(sr.failureCategory)}${sr.rootCause ? ': ' + escapeHtml(sr.rootCause) : ''}</div>`;
	}

	// 1. Error — what broke
	if (sr.evalResult.errors.length > 0) {
		html += `<div class="error-box">${escapeHtml(sr.evalResult.errors.join('; '))}</div>`;
	}

	// Phase 1 warnings
	const warnings = sr.evalResult.hints?.warnings ?? [];
	if (warnings.length > 0) {
		html += `<div class="warning-box">${escapeHtml(warnings.join('; '))}</div>`;
	}

	// 2. Diagnosis — verifier's reasoning
	if (sr.reasoning) {
		html += '<details class="section" open><summary>Diagnosis</summary>';
		html += `<div class="diagnosis">${escapeHtml(sr.reasoning)}</div>`;
		html += '</details>';
	}

	// 3. Mock data plan — Phase 1 hints
	if (sr.evalResult.hints) {
		html += '<details class="section"><summary>Mock data plan</summary>';
		const { globalContext, triggerContent, nodeHints } = sr.evalResult.hints;

		if (globalContext) {
			html += '<div class="subsection-label">Global context</div>';
			html += `<div class="hint-text">${escapeHtml(globalContext)}</div>`;
		}

		if (Object.keys(triggerContent ?? {}).length > 0) {
			html += '<div class="subsection-label">Trigger content</div>';
			html += `<pre class="json-block"><code>${escapeHtml(JSON.stringify(triggerContent, null, 2))}</code></pre>`;
		} else {
			html +=
				'<div class="warning-inline">No trigger content generated \u2014 start node has no input data</div>';
		}

		if (nodeHints && Object.keys(nodeHints).length > 0) {
			html += '<div class="subsection-label">Per-node hints</div>';
			for (const [nodeName, hint] of Object.entries(nodeHints)) {
				html += `<details class="node-hint"><summary>${escapeHtml(nodeName)}</summary>`;
				html += `<div class="hint-text">${escapeHtml(hint)}</div>`;
				html += '</details>';
			}
		}
		html += '</details>';
	}

	// 4. Execution trace — per-node results
	const nodeEntries = Object.entries(sr.evalResult.nodeResults);
	if (nodeEntries.length > 0) {
		html += '<details class="section"><summary>Execution trace</summary>';
		html +=
			'<div class="trace-legend"><span class="node-mode-mocked">mocked</span> <span class="node-mode-pinned">pinned</span> <span class="node-mode-real">real</span></div>';

		for (const [nodeName, nr] of nodeEntries) {
			const modeClass = `node-mode-${nr.executionMode}`;
			const hasError = nr.configIssues && Object.keys(nr.configIssues).length > 0;
			const configWarning = hasError
				? `<span class="build-issue">Build issue: ${escapeHtml(Object.values(nr.configIssues!).flat().join('; '))}</span>`
				: '';

			html += '<div class="trace-node">';
			html += '<div class="trace-node-header">';
			html += `<span class="${modeClass}">[${nr.executionMode}]</span> <strong>${escapeHtml(nodeName)}</strong>`;
			if (nr.interceptedRequests.length > 0) {
				html += ` <span class="request-count">${String(nr.interceptedRequests.length)} request(s)</span>`;
			}
			html += '</div>';
			if (configWarning) html += configWarning;

			// Intercepted requests
			for (const req of nr.interceptedRequests) {
				html += '<div class="request-pair">';
				html += '<div class="request-header">Request sent</div>';
				html += `<div class="request-method">${escapeHtml(req.method)} ${escapeHtml(req.url)}</div>`;
				if (req.requestBody) {
					html += `<pre class="json-block json-sm"><code>${escapeHtml(JSON.stringify(req.requestBody, null, 2))}</code></pre>`;
				}
				html += '<div class="response-header">Mock returned</div>';
				if (req.mockResponse) {
					html += `<pre class="json-block json-sm"><code>${escapeHtml(JSON.stringify(req.mockResponse, null, 2))}</code></pre>`;
				} else {
					html += '<div class="muted">no mock response</div>';
				}
				html += '</div>';
			}

			// Node output
			if (nr.output !== null && nr.output !== undefined) {
				html += '<details class="node-output-toggle"><summary>Node output</summary>';
				html += `<pre class="json-block"><code>${escapeHtml(JSON.stringify(nr.output, null, 2))}</code></pre>`;
				html += '</details>';
			} else {
				html += '<div class="muted">no output</div>';
			}

			html += '</div>';
		}
		html += '</details>';
	}

	return html;
}

// ---------------------------------------------------------------------------
// Scenario aggregation rendering (multi-run)
// ---------------------------------------------------------------------------

function renderScenarioAggregation(
	sa: ScenarioAggregation,
	tcIndex: number,
	sIndex: number,
	totalRuns: number,
): string {
	const allPass = sa.passCount === totalRuns;
	const allFail = sa.passCount === 0;
	const statusClass = allPass ? 'pass' : allFail ? 'fail' : 'mixed';
	const icon = allPass ? '&#10003;' : allFail ? '&#10007;' : '&#9679;';

	const passRatePct = Math.round(sa.passRate * 100);
	const passAtN = Math.round((sa.passAtK[totalRuns - 1] ?? 0) * 100);
	const passHatN = Math.round((sa.passHatK[totalRuns - 1] ?? 0) * 100);

	let runsHtml = '';
	for (let r = 0; r < sa.runs.length; r++) {
		const sr = sa.runs[r];
		const runIcon = sr.success ? '&#10003;' : '&#10007;';
		const runStatus = sr.success ? 'pass' : 'fail';
		runsHtml += `<details class="run-detail">
			<summary><span class="scenario-icon ${runStatus}">${runIcon}</span> Run ${String(r + 1)}</summary>
			<div class="run-detail-content">${renderScenarioDetail(sr)}</div>
		</details>`;
	}

	return `<div class="scenario ${statusClass}${allFail ? ' expanded' : ''}">
		<div class="scenario-header" onclick="this.parentElement.classList.toggle('expanded')">
			<span class="scenario-icon ${statusClass}">${icon}</span>
			<span class="scenario-name">${escapeHtml(sa.scenario.name)}</span>
			<span class="pass-rate-inline">${String(sa.passCount)}/${String(totalRuns)} (${String(passRatePct)}%)</span>
			<span class="badge badge-${passAtN >= 80 ? 'pass' : 'fail'}">pass@${String(totalRuns)}: ${String(passAtN)}%</span>
			<span class="badge badge-${passHatN >= 80 ? 'pass' : 'fail'}">pass^${String(totalRuns)}: ${String(passHatN)}%</span>
		</div>
		<div class="scenario-detail" id="scenario-${String(tcIndex)}-${String(sIndex)}">
			${runsHtml}
		</div>
	</div>`;
}

// ---------------------------------------------------------------------------
// Workflow summary
// ---------------------------------------------------------------------------

function renderWorkflowSummary(result: {
	scenarioResults: ScenarioResult[];
	workflowJson?: unknown;
}): string {
	const firstEval = result.scenarioResults[0]?.evalResult;

	let nodesHtml = '';
	if (firstEval) {
		const nodes = Object.entries(firstEval.nodeResults);
		if (nodes.length > 0) {
			const nodeList = nodes
				.map(([name, nr]) => {
					const mode = nr.executionMode;
					const requests = nr.interceptedRequests.length;
					const issues = nr.configIssues ? Object.values(nr.configIssues).flat().join('; ') : '';
					let line = `<span class="node-mode-${mode}">[${mode}]</span> ${escapeHtml(name)}`;
					if (requests > 0) line += ` <span class="muted">(${String(requests)} req)</span>`;
					if (issues)
						line += ` <span class="build-issue">Build issue: ${escapeHtml(issues)}</span>`;
					return `<li>${line}</li>`;
				})
				.join('');
			nodesHtml = `<details class="section"><summary>Built workflow (${String(nodes.length)} nodes)</summary><ul class="node-list">${nodeList}</ul></details>`;
		}
	}

	let jsonHtml = '';
	if (result.workflowJson) {
		const raw = JSON.stringify(result.workflowJson, null, 2);
		jsonHtml = `<details class="section"><summary>Agent output (raw JSON)</summary><pre class="json-block"><code>${escapeHtml(raw)}</code></pre></details>`;
	}

	return nodesHtml + jsonHtml;
}

// ---------------------------------------------------------------------------
// Test case rendering
// ---------------------------------------------------------------------------

function renderTestCaseSingleRun(tc: TestCaseAggregation, tcIndex: number): string {
	const result = tc.runs[0];
	const passCount = result.scenarioResults.filter((sr) => sr.success).length;
	const totalCount = result.scenarioResults.length;
	const allPass = passCount === totalCount && totalCount > 0;
	const statusClass = result.workflowBuildSuccess ? (allPass ? 'pass' : 'mixed') : 'fail';

	const buildBadge = result.workflowBuildSuccess
		? '<span class="badge badge-pass">BUILT</span>'
		: '<span class="badge badge-fail">BUILD FAILED</span>';

	const scoreBadge =
		totalCount > 0
			? `<span class="badge badge-${allPass ? 'pass' : 'fail'}">${String(passCount)}/${String(totalCount)}</span>`
			: '';

	const prompt = result.testCase.prompt;
	const truncatedPrompt = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;

	const scenarioIndicators = result.scenarioResults
		.map(
			(sr) =>
				`<span class="scenario-indicator ${sr.success ? 'pass' : 'fail'}" title="${escapeHtml(sr.scenario.name)}">${sr.success ? '\u2713' : '\u2717'} ${escapeHtml(sr.scenario.name)}</span>`,
		)
		.join(' ');

	let scenariosHtml = '';
	if (result.scenarioResults.length > 0) {
		scenariosHtml = result.scenarioResults
			.map((sr, i) => renderScenarioRun(sr, `scenario-${String(tcIndex)}-${String(i)}`))
			.join('');
	} else if (!result.workflowBuildSuccess) {
		const errorDetail = result.buildError
			? `<div class="error-box">${escapeHtml(result.buildError)}</div>`
			: '';
		scenariosHtml = `<div class="muted">Workflow failed to build \u2014 no scenarios executed</div>${errorDetail}`;
	}

	return `<div class="test-case ${statusClass}">
		<div class="test-case-header" onclick="this.parentElement.classList.toggle('expanded')">
			<div class="test-case-title">
				${buildBadge} ${scoreBadge}
				<span class="test-case-prompt">${escapeHtml(truncatedPrompt)}</span>
			</div>
			<div class="test-case-meta">
				<span class="badge badge-tag">${escapeHtml(result.testCase.complexity)}</span>
				${result.workflowId ? `<span class="workflow-id">${escapeHtml(result.workflowId)}</span>` : ''}
			</div>
			<div class="scenario-indicators">${scenarioIndicators}</div>
		</div>
		<div class="test-case-detail">
			<details class="section"><summary>Prompt</summary><div class="prompt-text">${escapeHtml(prompt)}</div></details>
			${renderWorkflowSummary(result)}
			${scenariosHtml}
		</div>
	</div>`;
}

function renderTestCaseMultiRun(
	tc: TestCaseAggregation,
	tcIndex: number,
	totalRuns: number,
): string {
	const allPass = tc.scenarios.every((s) => s.passCount === totalRuns);
	const anyPass = tc.scenarios.some((s) => s.passCount > 0);
	const allBuilt = tc.buildSuccessCount === totalRuns;
	const statusClass = allBuilt && allPass ? 'pass' : !anyPass ? 'fail' : 'mixed';

	const buildBadge = `<span class="badge badge-${allBuilt ? 'pass' : 'fail'}">BUILT ${String(tc.buildSuccessCount)}/${String(totalRuns)}</span>`;

	// Average pass@1 across scenarios as the headline metric
	const totalScenarios = tc.scenarios.length;
	const avgPassAtN =
		totalScenarios > 0
			? Math.round(
					(tc.scenarios.reduce((sum, s) => sum + (s.passAtK[totalRuns - 1] ?? 0), 0) /
						totalScenarios) *
						100,
				)
			: 0;
	const avgPassHatN =
		totalScenarios > 0
			? Math.round(
					(tc.scenarios.reduce((sum, s) => sum + (s.passHatK[totalRuns - 1] ?? 0), 0) /
						totalScenarios) *
						100,
				)
			: 0;

	const prompt = tc.testCase.prompt;
	const truncatedPrompt = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;

	const scenarioIndicators = tc.scenarios
		.map((sa) => {
			const p = sa.passCount;
			const cls = p === totalRuns ? 'pass' : p > 0 ? 'mixed' : 'fail';
			const sym = p === totalRuns ? '\u2713' : p > 0 ? '~' : '\u2717';
			return `<span class="scenario-indicator ${cls}" title="${escapeHtml(sa.scenario.name)}: ${String(p)}/${String(totalRuns)}">${sym} ${escapeHtml(sa.scenario.name)}</span>`;
		})
		.join(' ');

	const scenariosHtml = tc.scenarios
		.map((sa, sIdx) => renderScenarioAggregation(sa, tcIndex, sIdx, totalRuns))
		.join('');

	return `<div class="test-case ${statusClass}">
		<div class="test-case-header" onclick="this.parentElement.classList.toggle('expanded')">
			<div class="test-case-title">
				${buildBadge}
				<span class="badge badge-${avgPassAtN >= 80 ? 'pass' : 'fail'}">pass@${String(totalRuns)}: ${String(avgPassAtN)}%</span>
				<span class="badge badge-${avgPassHatN >= 80 ? 'pass' : 'fail'}">pass^${String(totalRuns)}: ${String(avgPassHatN)}%</span>
				<span class="test-case-prompt">${escapeHtml(truncatedPrompt)}</span>
			</div>
			<div class="test-case-meta">
				<span class="badge badge-tag">${escapeHtml(tc.testCase.complexity)}</span>
			</div>
			<div class="scenario-indicators">${scenarioIndicators}</div>
		</div>
		<div class="test-case-detail">
			<details class="section"><summary>Prompt</summary><div class="prompt-text">${escapeHtml(prompt)}</div></details>
			${scenariosHtml}
		</div>
	</div>`;
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

export function generateWorkflowReport(evaluation: MultiRunEvaluation): string {
	const { totalRuns, testCases } = evaluation;
	const isMultiRun = totalRuns > 1;

	const totalTestCases = testCases.length;
	const allScenarios = testCases.flatMap((tc) => tc.scenarios);
	const totalScenarios = allScenarios.length;

	// Compute average pass@n and pass^n (k = n = totalRuns)
	const avgPassAtN =
		totalScenarios > 0
			? Math.round(
					(allScenarios.reduce((sum, s) => sum + (s.passAtK[totalRuns - 1] ?? 0), 0) /
						totalScenarios) *
						100,
				)
			: 0;
	const avgPassHatN =
		totalScenarios > 0
			? Math.round(
					(allScenarios.reduce((sum, s) => sum + (s.passHatK[totalRuns - 1] ?? 0), 0) /
						totalScenarios) *
						100,
				)
			: 0;

	// Single-run fallback metrics (backward compatible)
	const builtCount = testCases.filter((tc) => tc.buildSuccessCount > 0).length;

	// Dashboard cards
	let dashboardHtml: string;
	if (isMultiRun) {
		dashboardHtml = `
		<div class="stat-card">
			<div class="label">pass@${String(totalRuns)}</div>
			<div class="value${avgPassAtN >= 80 ? ' pass' : avgPassAtN >= 50 ? ' mixed' : ' fail'}">${String(avgPassAtN)}%</div>
		</div>
		<div class="stat-card">
			<div class="label">pass^${String(totalRuns)}</div>
			<div class="value${avgPassHatN >= 80 ? ' pass' : avgPassHatN >= 50 ? ' mixed' : ' fail'}">${String(avgPassHatN)}%</div>
		</div>
		<div class="stat-card">
			<div class="label">Runs</div>
			<div class="value">${String(totalRuns)}</div>
		</div>
		<div class="stat-card">
			<div class="label">Built (any run)</div>
			<div class="value${builtCount === totalTestCases ? ' pass' : ' mixed'}">${String(builtCount)}/${String(totalTestCases)}</div>
		</div>`;
	} else {
		const singlePassCount = allScenarios.filter((s) => s.passCount > 0).length;
		const singleFailCount = totalScenarios - singlePassCount;
		const passRate = totalScenarios > 0 ? Math.round((singlePassCount / totalScenarios) * 100) : 0;

		dashboardHtml = `
		<div class="stat-card">
			<div class="label">Pass rate</div>
			<div class="value${passRate >= 80 ? ' pass' : passRate >= 50 ? ' mixed' : ' fail'}">${String(passRate)}%</div>
		</div>
		<div class="stat-card">
			<div class="label">Passed</div>
			<div class="value pass">${String(singlePassCount)}</div>
		</div>
		<div class="stat-card">
			<div class="label">Failed</div>
			<div class="value${singleFailCount > 0 ? ' fail' : ''}">${String(singleFailCount)}</div>
		</div>
		<div class="stat-card">
			<div class="label">Built</div>
			<div class="value${builtCount === totalTestCases ? ' pass' : ' mixed'}">${String(builtCount)}/${String(totalTestCases)}</div>
		</div>`;
	}

	const subtitle = isMultiRun
		? `Generated ${new Date().toLocaleString()} &mdash; ${String(totalScenarios)} scenarios across ${String(totalTestCases)} test cases &times; ${String(totalRuns)} runs`
		: `Generated ${new Date().toLocaleString()} &mdash; ${String(totalScenarios)} scenarios across ${String(totalTestCases)} test cases`;

	const testCaseCards = isMultiRun
		? testCases.map((tc, i) => renderTestCaseMultiRun(tc, i, totalRuns)).join('')
		: testCases.map((tc, i) => renderTestCaseSingleRun(tc, i)).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow evaluation report</title>
<style>
	:root {
		--bg-primary: #0d1117;
		--bg-secondary: #161b22;
		--bg-tertiary: #1c2129;
		--border: #30363d;
		--border-light: #21262d;
		--text-primary: #f0f6fc;
		--text-secondary: #c9d1d9;
		--text-muted: #8b949e;
		--color-pass: #3fb950;
		--color-fail: #f85149;
		--color-warn: #d29922;
		--color-info: #58a6ff;
		--color-purple: #bc8cff;
		--color-pass-bg: #23863622;
		--color-fail-bg: #da363322;
		--color-warn-bg: #d2992222;
	}

	* { margin: 0; padding: 0; box-sizing: border-box; }
	body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg-primary); color: var(--text-secondary); padding: 24px; max-width: 1400px; margin: 0 auto; font-size: 14px; line-height: 1.5; }

	/* Header */
	h1 { color: var(--text-primary); font-size: 20px; margin-bottom: 2px; }
	.subtitle { color: var(--text-muted); font-size: 13px; margin-bottom: 20px; }

	/* Dashboard */
	.dashboard { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; align-items: stretch; }
	.stat-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 14px 20px; min-width: 120px; }
	.stat-card .label { color: var(--text-muted); font-size: 12px; }
	.stat-card .value { color: var(--text-primary); font-size: 26px; font-weight: 700; margin-top: 2px; }
	.stat-card .value.pass { color: var(--color-pass); }
	.stat-card .value.fail { color: var(--color-fail); }
	.stat-card .value.mixed { color: var(--color-warn); }
	.stat-card .stat-sub { color: var(--text-muted); font-size: 12px; }

	/* Toolbar */
	.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
	.toolbar button { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); padding: 6px 12px; font-size: 12px; cursor: pointer; }
	.toolbar button:hover { background: var(--bg-tertiary); color: var(--text-primary); }
	.toolbar button.active { border-color: var(--color-info); color: var(--color-info); }

	/* Badges */
	.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 4px; }
	.badge-pass { background: var(--color-pass-bg); color: var(--color-pass); }
	.badge-fail { background: var(--color-fail-bg); color: var(--color-fail); }
	.badge-tag { background: var(--border); color: var(--text-muted); }

	/* Test case cards */
	.test-case { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
	.test-case.pass { border-left: 3px solid var(--color-pass); }
	.test-case.fail { border-left: 3px solid var(--color-fail); }
	.test-case.mixed { border-left: 3px solid var(--color-warn); }
	.test-case-header { padding: 12px 16px; cursor: pointer; }
	.test-case-header:hover { background: var(--bg-tertiary); }
	.test-case-title { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
	.test-case-prompt { color: var(--text-primary); font-weight: 500; font-size: 13px; }
	.test-case-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
	.workflow-id { color: var(--text-muted); font-size: 11px; font-family: monospace; }
	.scenario-indicators { display: flex; gap: 8px; flex-wrap: wrap; }
	.scenario-indicator { font-size: 11px; font-family: monospace; }
	.scenario-indicator.pass { color: var(--color-pass); }
	.scenario-indicator.fail { color: var(--color-fail); }
	.scenario-indicator.mixed { color: var(--color-warn); }
	.test-case-detail { display: none; padding: 0 16px 16px; }
	.test-case.expanded .test-case-detail { display: block; }

	/* Sections (collapsible) */
	.section { margin: 8px 0; }
	.section > summary { cursor: pointer; color: var(--color-info); font-size: 12px; font-weight: 600; padding: 4px 0; }
	.section > summary:hover { text-decoration: underline; }

	/* Scenarios */
	.scenario { border: 1px solid var(--border-light); border-radius: 6px; margin-bottom: 6px; overflow: hidden; }
	.scenario-header { padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; }
	.scenario-header:hover { background: var(--bg-tertiary); }
	.scenario-icon { font-weight: bold; font-size: 14px; min-width: 16px; }
	.scenario-icon.pass { color: var(--color-pass); }
	.scenario-icon.fail { color: var(--color-fail); }
	.scenario-icon.mixed { color: var(--color-warn); }
	.scenario-name { color: var(--text-primary); font-weight: 600; }
	.scenario-desc { color: var(--text-muted); font-size: 12px; }
	.scenario-summary-inline { color: var(--text-muted); font-size: 12px; flex: 1; }
	.pass-rate-inline { color: var(--text-muted); font-size: 12px; font-family: monospace; }
	.scenario-detail { display: none; padding: 10px 12px; border-top: 1px solid var(--border-light); background: var(--bg-primary); }
	.scenario.expanded .scenario-detail { display: block; }

	/* Run detail (multi-run) */
	.run-detail { margin: 4px 0; border: 1px solid var(--border-light); border-radius: 4px; }
	.run-detail > summary { cursor: pointer; padding: 6px 10px; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
	.run-detail > summary:hover { background: var(--bg-tertiary); }
	.run-detail-content { padding: 8px 10px; border-top: 1px solid var(--border-light); }

	/* Error and warning boxes */
	.error-box { color: var(--color-fail); font-size: 12px; padding: 6px 10px; background: var(--color-fail-bg); border-radius: 4px; margin-bottom: 8px; border-left: 3px solid var(--color-fail); }
	.warning-box { color: var(--color-warn); font-size: 12px; padding: 6px 10px; background: var(--color-warn-bg); border-radius: 4px; margin-bottom: 8px; border-left: 3px solid var(--color-warn); }
	.warning-inline { color: var(--color-warn); font-size: 11px; margin: 4px 0; }
	.build-issue { color: var(--color-warn); font-size: 11px; display: block; margin-top: 2px; }

	/* Diagnosis */
	.diagnosis { color: var(--text-secondary); font-size: 12px; line-height: 1.6; padding: 6px 0; }

	/* Prompt */
	.prompt-text { color: var(--text-secondary); font-size: 13px; line-height: 1.6; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; white-space: pre-wrap; }

	/* Execution trace */
	.trace-legend { font-size: 11px; margin-bottom: 8px; display: flex; gap: 12px; }
	.trace-node { border: 1px solid var(--border-light); border-radius: 4px; margin-bottom: 6px; padding: 8px; }
	.trace-node-header { font-size: 12px; font-family: monospace; margin-bottom: 4px; }
	.request-count { color: var(--text-muted); font-size: 11px; }

	/* Request/response pairs */
	.request-pair { border: 1px solid var(--border-light); border-radius: 4px; margin: 6px 0; overflow: hidden; }
	.request-header { background: #1c3a5e; color: var(--color-info); font-size: 10px; font-weight: 700; padding: 3px 8px; letter-spacing: 0.5px; }
	.response-header { background: #2a1f3e; color: var(--color-purple); font-size: 10px; font-weight: 700; padding: 3px 8px; letter-spacing: 0.5px; }
	.request-method { font-size: 11px; color: var(--text-primary); padding: 4px 8px; font-family: monospace; font-weight: 600; background: var(--bg-primary); }

	/* JSON blocks */
	.json-block { font-size: 11px; margin: 4px 0; padding: 8px; background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: 4px; overflow-x: auto; }
	.json-sm { font-size: 10px; }
	pre { overflow-x: auto; margin: 0; }
	code { color: var(--text-secondary); }

	/* Node list */
	.node-list { list-style: none; padding: 4px 0; font-size: 12px; font-family: monospace; }
	.node-list li { padding: 3px 0; }
	.node-mode-mocked { color: var(--color-info); font-weight: 600; }
	.node-mode-pinned { color: var(--color-warn); font-weight: 600; }
	.node-mode-real { color: var(--color-pass); font-weight: 600; }

	/* Node output toggle */
	.node-output-toggle { margin: 4px 0; }
	.node-output-toggle > summary { cursor: pointer; color: var(--text-muted); font-size: 11px; }

	/* Node hint */
	.node-hint { margin: 2px 0; }
	.node-hint > summary { cursor: pointer; color: var(--text-secondary); font-size: 11px; font-family: monospace; }
	.hint-text { color: var(--text-muted); font-size: 11px; padding: 4px 0; line-height: 1.5; }
	.subsection-label { color: var(--text-primary); font-size: 11px; font-weight: 600; margin-top: 8px; margin-bottom: 2px; }

	/* Category badges */
	.category-badge { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px; margin-bottom: 8px; }
	.category-warn { background: var(--color-warn-bg); color: var(--color-warn); border-left: 3px solid var(--color-warn); }
	.category-fail { background: var(--color-fail-bg); color: var(--color-fail); border-left: 3px solid var(--color-fail); }
	.category-info { background: #1c3a5e33; color: var(--color-info); border-left: 3px solid var(--color-info); }

	/* pass@k tables */
	.pass-k-table { margin: 8px 0; font-size: 11px; font-family: monospace; }
	.pass-k-row { display: flex; gap: 8px; padding: 2px 0; }
	.pass-k-row .pass-k-label { color: var(--text-muted); min-width: 70px; }
	.pass-k-row span { color: var(--text-secondary); }
	.pass-k-dashboard-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace; margin-bottom: 24px; }
	.pass-k-dashboard-table th, .pass-k-dashboard-table td { padding: 6px 12px; border: 1px solid var(--border); text-align: center; }
	.pass-k-dashboard-table th { background: var(--bg-tertiary); color: var(--text-muted); font-weight: 600; }
	.pass-k-dashboard-table td { background: var(--bg-secondary); color: var(--text-secondary); }
	.pass-k-dashboard-table .pass-k-label { text-align: left; color: var(--text-muted); font-weight: 600; }

	/* Utilities */
	.muted { color: var(--text-muted); font-size: 12px; }
</style>
</head>
<body>

<h1>Workflow evaluation report</h1>
<p class="subtitle">${subtitle}</p>

<div class="dashboard">
	${dashboardHtml}
</div>

<div class="toolbar">
	<button onclick="document.querySelectorAll('.test-case').forEach(e => e.classList.add('expanded'))">Expand all</button>
	<button onclick="document.querySelectorAll('.test-case').forEach(e => e.classList.remove('expanded'))">Collapse all</button>
	<button onclick="document.querySelectorAll('.test-case').forEach(e => { e.style.display = e.classList.contains('pass') ? 'none' : '' }); this.classList.toggle('active')">Show failures only</button>
</div>

${testCaseCards}

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Write report to disk
// ---------------------------------------------------------------------------

export function writeWorkflowReport(evaluation: MultiRunEvaluation): string {
	const reportDir = path.join(__dirname, '..', '..', '.data');
	if (!fs.existsSync(reportDir)) {
		fs.mkdirSync(reportDir, { recursive: true });
	}
	const html = generateWorkflowReport(evaluation);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const reportPath = path.join(reportDir, `workflow-eval-${timestamp}.html`);
	fs.writeFileSync(reportPath, html);

	// Also write to the stable filename for quick access
	fs.writeFileSync(path.join(reportDir, 'workflow-eval-report.html'), html);

	return reportPath;
}
