#!/usr/bin/env node
import { aggregateResults } from './aggregator';
import { parseCliArgs } from './args';
import { N8nClient } from '../clients/n8n-client';
import { seedCredentials, cleanupCredentials } from '../credentials/seeder';
import { loadWorkflowTestCases } from '../data/workflows';
import { createLogger } from '../harness/logger';
import { runWorkflowTestCase, runWithConcurrency } from '../harness/runner';
import { snapshotWorkflowIds } from '../outcome/workflow-discovery';
import { writeWorkflowReport } from '../report/workflow-report';
import type { WorkflowTestCaseResult } from '../types';

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));

	const testCases = loadWorkflowTestCases(args.filter);
	if (testCases.length === 0) {
		console.log('No workflow test cases found in evaluations/data/workflows/');
		return;
	}

	const totalScenarios = testCases.reduce((sum, tc) => sum + tc.scenarios.length, 0);
	console.log(
		`Running ${String(testCases.length)} workflow test case(s) with ${String(totalScenarios)} scenario(s) x ${String(args.runs)} runs\n`,
	);

	const logger = createLogger(args.verbose);

	// Setup: authenticate, seed credentials, snapshot workflows
	const client = new N8nClient(args.baseUrl);
	logger.info(`Authenticating with ${args.baseUrl}...`);
	await client.login(args.email, args.password);
	logger.success('Authenticated');

	logger.info('Seeding credentials...');
	const seedResult = await seedCredentials(client);
	logger.info(`Seeded ${String(seedResult.credentialIds.length)} credential(s)`);

	// Run test cases with bounded concurrency.
	// Each test case builds a workflow (uses n8n's agent) then runs scenarios
	// (uses our Anthropic key for Phase 1 + Phase 2 mock generation).
	// At Tier 4 (20K RPM) no practical limit is needed — set high to run all in parallel.
	const MAX_CONCURRENT_TEST_CASES = 4;
	const allRunResults: WorkflowTestCaseResult[][] = [];

	try {
		for (let run = 0; run < args.runs; run++) {
			if (args.runs > 1) {
				console.log(`\n--- Run #${String(run + 1)}/${String(args.runs)} ---\n`);
			}

			const preRunWorkflowIds = await snapshotWorkflowIds(client);
			const claimedWorkflowIds = new Set<string>();

			const results = await runWithConcurrency(
				testCases,
				async (testCase) =>
					await runWorkflowTestCase({
						client,
						testCase,
						timeoutMs: args.timeoutMs,
						seededCredentialTypes: seedResult.seededTypes,
						preRunWorkflowIds,
						claimedWorkflowIds,
						logger,
						keepWorkflows: args.keepWorkflows,
					}),
				MAX_CONCURRENT_TEST_CASES,
			);

			allRunResults.push(results);
		}
	} finally {
		await cleanupCredentials(client, seedResult.credentialIds).catch(() => {});
	}

	const aggregatedResults = aggregateResults(allRunResults, args.runs);

	// Generate HTML report
	const reportPath = writeWorkflowReport(aggregatedResults);
	console.log(`Report: ${reportPath}`);

	// Print summary
	console.log('\n=== Workflow Test Case Results ===\n');
	for (const tc of aggregatedResults.testCases) {
		console.log(`${tc.testCase.prompt.slice(0, 70)}...`);
		if (args.runs > 1) {
			console.log(
				`  Build: ${String(tc.buildSuccessCount)}/${String(aggregatedResults.totalRuns)} runs`,
			);
		} else {
			const buildStatus = tc.runs[0].workflowBuildSuccess ? 'BUILT' : 'BUILD FAILED';
			const wfId = tc.runs[0].workflowId;
			console.log(`  Workflow: ${buildStatus}${wfId ? ` (${wfId})` : ''}`);
			if (tc.runs[0].buildError) {
				console.log(`  Error: ${tc.runs[0].buildError.slice(0, 200)}`);
			}
		}

		for (const sa of tc.scenarios) {
			if (args.runs > 1) {
				const n = aggregatedResults.totalRuns;
				const passAtN = Math.round((sa.passAtK[n - 1] ?? 0) * 100);
				const passHatN = Math.round((sa.passHatK[n - 1] ?? 0) * 100);
				console.log(
					`  ${sa.scenario.name}: ${String(sa.passCount)}/${String(n)} passed` +
						` | pass@${String(n)}: ${String(passAtN)}% | pass^${String(n)}: ${String(passHatN)}%`,
				);
			} else {
				const sr = sa.runs[0];
				const icon = sr.success ? '\u2713' : '\u2717';
				console.log(
					`  ${icon} ${sr.scenario.name}: ${sr.success ? 'PASS' : 'FAIL'} (${String(sr.score * 100)}%)`,
				);
				if (!sr.success) {
					console.log(`    ${sr.reasoning.slice(0, 120)}`);
				}
			}
		}
	}

	// Overall metrics for multi-run
	if (args.runs > 1) {
		const allScenarios = aggregatedResults.testCases.flatMap((tc) => tc.scenarios);
		const total = allScenarios.length;
		const n = aggregatedResults.totalRuns;
		const avgPassAtN =
			total > 0
				? Math.round(
						(allScenarios.reduce((sum, s) => sum + (s.passAtK[n - 1] ?? 0), 0) / total) * 100,
					)
				: 0;
		const avgPassHatN =
			total > 0
				? Math.round(
						(allScenarios.reduce((sum, s) => sum + (s.passHatK[n - 1] ?? 0), 0) / total) * 100,
					)
				: 0;

		console.log('=== Aggregate Metrics ===\n');
		console.log(`  pass@${String(n)}: ${String(avgPassAtN)}%`);
		console.log(`  pass^${String(n)}: ${String(avgPassHatN)}%`);
		console.log('');
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
