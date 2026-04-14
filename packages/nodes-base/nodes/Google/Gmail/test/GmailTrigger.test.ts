import * as mailparser from 'mailparser';
import nock from 'nock';

import { testPollingTriggerNode } from '@test/nodes/TriggerHelpers';

import { GmailTrigger } from '../GmailTrigger.node';
import type { Message, ListMessage, MessageListResponse } from '../types';

jest.mock('mailparser');

describe('GmailTrigger', () => {
	const baseUrl = 'https://www.googleapis.com';

	function createMessage(message: Partial<Message> = {}): Message {
		const content = Buffer.from('test');
		const contentBase64 = content.toString('base64');
		const size = content.byteLength;

		return {
			historyId: 'testHistoryId',
			id: 'testId',
			internalDate: '1727777957863',
			raw: contentBase64,
			labelIds: ['testLabelId'],
			sizeEstimate: size,
			snippet: content.toString('utf-8'),
			threadId: 'testThreadId',
			payload: {
				body: { attachmentId: 'testAttachmentId', data: contentBase64, size },
				filename: 'foo.txt',
				headers: [{ name: 'testHeader', value: 'testHeaderValue' }],
				mimeType: 'text/plain',
				partId: 'testPartId',
				parts: [],
			},
			...message,
		};
	}

	function createListMessage(message: Partial<ListMessage> = {}): ListMessage {
		return { id: 'testId', threadId: 'testThreadId', ...message };
	}

	beforeAll(() => {
		jest.spyOn(mailparser, 'simpleParser').mockResolvedValue({
			headers: new Map([['headerKey', 'headerValue']]),
			attachments: [],
			headerLines: [{ key: 'headerKey', line: 'headerValue' }],
			html: '<p>test</p>',
			date: new Date('2024-08-31'),
			from: {
				text: 'from@example.com',
				value: [{ name: 'From', address: 'from@example.com' }],
				html: 'from@example.com',
			},
			to: {
				text: 'to@example.com',
				value: [{ name: 'To', address: 'to@example.com' }],
				html: 'to@example.com',
			},
		});
	});

	it('should return incoming emails', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
			resultSizeEstimate: 123,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1' }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2' }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3 },
		});

		expect(response).toEqual([
			[
				{
					json: {
						date: '2024-08-31T00:00:00.000Z',
						from: {
							html: 'from@example.com',
							text: 'from@example.com',
							value: [{ address: 'from@example.com', name: 'From' }],
						},
						headers: { headerKey: 'headerValue' },
						html: '<p>test</p>',
						id: '1',
						labelIds: ['testLabelId'],
						sizeEstimate: 4,
						threadId: 'testThreadId',
						to: {
							html: 'to@example.com',
							text: 'to@example.com',
							value: [{ address: 'to@example.com', name: 'To' }],
						},
					},
				},
				{
					json: {
						date: '2024-08-31T00:00:00.000Z',
						from: {
							html: 'from@example.com',
							text: 'from@example.com',
							value: [{ address: 'from@example.com', name: 'From' }],
						},
						headers: { headerKey: 'headerValue' },
						html: '<p>test</p>',
						id: '2',
						labelIds: ['testLabelId'],
						sizeEstimate: 4,
						threadId: 'testThreadId',
						to: {
							html: 'to@example.com',
							text: 'to@example.com',
							value: [{ address: 'to@example.com', name: 'To' }],
						},
					},
				},
			],
		]);
	});

	it('should simplify output when enabled', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
			resultSizeEstimate: 123,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1' }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2' }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
		});

		expect(response).toEqual([
			[
				{
					json: {
						historyId: 'testHistoryId',
						id: '1',
						internalDate: '1727777957863',
						labels: [{ id: 'testLabelId', name: 'Test Label Name' }],
						payload: {
							body: { attachmentId: 'testAttachmentId', data: 'dGVzdA==', size: 4 },
							filename: 'foo.txt',
							mimeType: 'text/plain',
							partId: 'testPartId',
							parts: [],
						},
						raw: 'dGVzdA==',
						sizeEstimate: 4,
						snippet: 'test',
						testHeader: 'testHeaderValue',
						threadId: 'testThreadId',
					},
				},
				{
					json: {
						historyId: 'testHistoryId',
						id: '2',
						internalDate: '1727777957863',
						labels: [{ id: 'testLabelId', name: 'Test Label Name' }],
						payload: {
							body: { attachmentId: 'testAttachmentId', data: 'dGVzdA==', size: 4 },
							filename: 'foo.txt',
							mimeType: 'text/plain',
							partId: 'testPartId',
							parts: [],
						},
						raw: 'dGVzdA==',
						sizeEstimate: 4,
						snippet: 'test',
						testHeader: 'testHeaderValue',
						threadId: 'testThreadId',
					},
				},
			],
		]);
	});

	it('should filter out emails that were already processed', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [],
			resultSizeEstimate: 0,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
			workflowStaticData: {
				'Gmail Trigger': { lastTimeChecked: new Date('2024-10-31').getTime() / 1000 },
			},
		});

		expect(response).toEqual(null);
	});

	it('should handle duplicates and different date fields', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [
				createListMessage({ id: '1' }),
				createListMessage({ id: '2' }),
				createListMessage({ id: '3' }),
				createListMessage({ id: '4' }),
				createListMessage({ id: '5' }),
			],
			resultSizeEstimate: 123,
		};

		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', internalDate: '1727777957863', date: undefined }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', internalDate: undefined, date: '1727777957863' }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
			.reply(
				200,
				createMessage({
					id: '3',
					internalDate: undefined,
					date: undefined,
					headers: { date: 'Thu, 5 Dec 2024 08:30:00 -0800' },
				}),
			);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/4?.*'))
			.reply(
				200,
				createMessage({
					id: '4',
					internalDate: undefined,
					date: undefined,
					headers: undefined,
				}),
			);
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages/5?.*')).reply(200, {});

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
			workflowStaticData: {
				'Gmail Trigger': {
					lastTimeChecked: new Date('2024-10-31').getTime() / 1000,
					possibleDuplicates: ['1'],
				},
			},
		});

		expect(response).toMatchSnapshot();
	});

	it('should skip DRAFTS when option is set', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
			resultSizeEstimate: 2,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, {
				labels: [
					{ id: 'INBOX', name: 'INBOX' },
					{ id: 'DRAFT', name: 'DRAFT' },
				],
			});
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', labelIds: ['DRAFT'] }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', labelIds: ['INBOX'] }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { filters: { includeDrafts: false } } },
		});

		expect(response).toEqual([
			[
				{
					binary: undefined,
					json: {
						attachements: undefined,
						date: '2024-08-31T00:00:00.000Z',
						from: {
							html: 'from@example.com',
							text: 'from@example.com',
							value: [{ address: 'from@example.com', name: 'From' }],
						},
						headerlines: undefined,
						headers: { headerKey: 'headerValue' },
						html: '<p>test</p>',
						id: '2',
						labelIds: ['INBOX'],
						sizeEstimate: 4,
						threadId: 'testThreadId',
						to: {
							html: 'to@example.com',
							text: 'to@example.com',
							value: [{ address: 'to@example.com', name: 'To' }],
						},
					},
				},
			],
		]);
	});

	it('should skip emails with SENT label', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
			resultSizeEstimate: 2,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, {
				labels: [
					{ id: 'INBOX', name: 'INBOX' },
					{ id: 'SENT', name: 'SENT' },
				],
			});
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', labelIds: ['INBOX'] }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', labelIds: ['SENT'] }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3 },
		});

		expect(response).toEqual([
			[
				{
					binary: undefined,
					json: {
						attachements: undefined,
						date: '2024-08-31T00:00:00.000Z',
						from: {
							html: 'from@example.com',
							text: 'from@example.com',
							value: [{ address: 'from@example.com', name: 'From' }],
						},
						headerlines: undefined,
						headers: { headerKey: 'headerValue' },
						html: '<p>test</p>',
						id: '1',
						labelIds: ['INBOX'],
						sizeEstimate: 4,
						threadId: 'testThreadId',
						to: {
							html: 'to@example.com',
							text: 'to@example.com',
							value: [{ address: 'to@example.com', name: 'To' }],
						},
					},
				},
			],
		]);
	});

	it('should not skip emails that were sent to own account', async () => {
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
			resultSizeEstimate: 2,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, {
				labels: [
					{ id: 'INBOX', name: 'INBOX' },
					{ id: 'SENT', name: 'SENT' },
				],
			});
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', labelIds: ['INBOX', 'SENT'] }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', labelIds: ['SENT'] }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3 },
		});
		expect(response).toEqual([
			[
				{
					binary: undefined,
					json: {
						attachements: undefined,
						date: '2024-08-31T00:00:00.000Z',
						from: {
							html: 'from@example.com',
							text: 'from@example.com',
							value: [{ address: 'from@example.com', name: 'From' }],
						},
						headerlines: undefined,
						headers: { headerKey: 'headerValue' },
						html: '<p>test</p>',
						id: '1',
						labelIds: ['INBOX', 'SENT'],
						sizeEstimate: 4,
						threadId: 'testThreadId',
						to: {
							html: 'to@example.com',
							text: 'to@example.com',
							value: [{ address: 'to@example.com', name: 'To' }],
						},
					},
				},
			],
		]);
	});

	it('should handle multiple emails with the same timestamp', async () => {
		const timestamp = '1727777957000';
		const messageListResponse: MessageListResponse = {
			messages: [
				createListMessage({ id: '1' }),
				createListMessage({ id: '2' }),
				createListMessage({ id: '3' }),
			],
			resultSizeEstimate: 3,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', internalDate: timestamp }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', internalDate: timestamp }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
			.reply(200, createMessage({ id: '3', internalDate: timestamp }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
			workflowStaticData: {
				'Gmail Trigger': {
					lastTimeChecked: Number(timestamp) / 1000,
					possibleDuplicates: ['1', '2'],
				},
			},
		});

		expect(response).toEqual([[{ json: expect.objectContaining({ id: '3' }) }]]);
	});

	it('should not skip emails when no messages are found', async () => {
		const initialTimestamp = 1727777957;
		const emailTimestamp = String((initialTimestamp + 1) * 1000);
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' })],
			resultSizeEstimate: 1,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', internalDate: emailTimestamp }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
			workflowStaticData: {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			},
		});

		expect(response).toEqual([[{ json: expect.objectContaining({ id: '1' }) }]]);
	});

	it('should update timestamp even when all emails are filtered (prevents infinite re-fetch)', async () => {
		const initialTimestamp = 1727777957;
		const draftEmailTimestamp = String((initialTimestamp + 1) * 1000);
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: 'draft-1' })],
			resultSizeEstimate: 1,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, {
				labels: [
					{ id: 'INBOX', name: 'INBOX' },
					{ id: 'DRAFT', name: 'DRAFT' },
				],
			});
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/draft-1?.*'))
			.reply(
				200,
				createMessage({ id: 'draft-1', internalDate: draftEmailTimestamp, labelIds: ['DRAFT'] }),
			);

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { filters: { includeDrafts: false } } },
			workflowStaticData: {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			},
		});

		expect(response).toBeNull();
	});

	it('should handle emails with invalid dates by using startDate fallback', async () => {
		const initialTimestamp = 1727777957;
		const messageListResponse: MessageListResponse = {
			messages: [createListMessage({ id: '1' })],
			resultSizeEstimate: 1,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		// Email without any date fields - should be treated as invalid
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', internalDate: undefined }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { simple: true } },
			workflowStaticData: {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			},
		});

		// Should still return the email even though it has invalid date
		expect(response).toHaveLength(1);
		expect(response?.[0]?.[0]?.json?.id).toBe('1');
	});

	it('should handle mixed valid and filtered emails with same timestamp', async () => {
		const timestamp = '1727777957000';
		const messageListResponse: MessageListResponse = {
			messages: [
				createListMessage({ id: '1' }),
				createListMessage({ id: '2' }),
				createListMessage({ id: '3' }),
			],
			resultSizeEstimate: 3,
		};
		nock(baseUrl)
			.get('/gmail/v1/users/me/labels')
			.reply(200, {
				labels: [
					{ id: 'INBOX', name: 'INBOX' },
					{ id: 'DRAFT', name: 'DRAFT' },
				],
			});
		nock(baseUrl).get(new RegExp('/gmail/v1/users/me/messages?.*')).reply(200, messageListResponse);
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
			.reply(200, createMessage({ id: '1', internalDate: timestamp, labelIds: ['INBOX'] }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
			.reply(200, createMessage({ id: '2', internalDate: timestamp, labelIds: ['DRAFT'] }));
		nock(baseUrl)
			.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
			.reply(200, createMessage({ id: '3', internalDate: timestamp, labelIds: ['INBOX'] }));

		const { response } = await testPollingTriggerNode(GmailTrigger, {
			node: { typeVersion: 1.3, parameters: { filters: { includeDrafts: false } } },
			workflowStaticData: {
				'Gmail Trigger': {
					lastTimeChecked: Number(timestamp) / 1000 - 1,
				},
			},
		});

		// Should return 2 emails (1 and 3), filtering out the draft (2)
		expect(response).toHaveLength(1);
		expect(response?.[0]).toHaveLength(2);
		expect(response?.[0]?.[0]?.json?.id).toBe('1');
		expect(response?.[0]?.[1]?.json?.id).toBe('3');
	});

	describe('v2 - maxResults limit', () => {
		it('should fetch only maxResults messages from a larger list', async () => {
			// Gmail list returns 3 IDs, but maxResults=2 so only 2 full messages are fetched
			const messageListResponse: MessageListResponse = {
				messages: [
					createListMessage({ id: '3' }),
					createListMessage({ id: '2' }),
					createListMessage({ id: '1' }),
				],
				resultSizeEstimate: 3,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, messageListResponse);
			// Only first 2 messages are fetched (3 and 2)
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
				.reply(200, createMessage({ id: '3', internalDate: '3000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '2000000000000' }));

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
			});

			expect(response).toHaveLength(1);
			expect(response?.[0]).toHaveLength(2);
			expect(response?.[0]?.[0]?.json?.id).toBe('3');
			expect(response?.[0]?.[1]?.json?.id).toBe('2');
		});

		it('should store pending IDs and advance lastTimeChecked when more messages remain', async () => {
			const initialTimestamp = 1000000;
			const messageListResponse: MessageListResponse = {
				messages: [
					createListMessage({ id: '3' }),
					createListMessage({ id: '2' }),
					createListMessage({ id: '1' }),
				],
				resultSizeEstimate: 3,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, messageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
				.reply(200, createMessage({ id: '3', internalDate: '3000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '2000000000000' }));

			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			};

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			// lastTimeChecked advances to the max date of fetched messages
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(3000000000);
			// Remaining unfetched message ID stored as pending
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual(['1']);
		});

		it('should pick up pending messages on subsequent poll', async () => {
			// Simulates poll 2: pending IDs from previous poll are fetched directly,
			// then new messages are listed.
			const newMessageListResponse: MessageListResponse = {
				messages: [],
				resultSizeEstimate: 0,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			// Pending message fetched by ID
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '1000000000000' }));
			// Then list for new messages (returns nothing)
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, newMessageListResponse);

			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': {
					lastTimeChecked: 3000000000,
					pendingMessageIds: ['1'],
				},
			};

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(response).toHaveLength(1);
			expect(response?.[0]).toHaveLength(1);
			expect(response?.[0]?.[0]?.json?.id).toBe('1');
			// Pending cleared
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual([]);
			// lastTimeChecked must NOT regress — pending message 1 has an older date (1s)
			// than the already-advanced lastTimeChecked (3s) from poll 1
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(3000000000);
		});

		it('should process pending and new messages in one poll when budget allows', async () => {
			const newMessageListResponse: MessageListResponse = {
				messages: [createListMessage({ id: '4' })],
				resultSizeEstimate: 1,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			// Pending message fetched by ID
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '1000000000000' }));
			// New messages listed
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, newMessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/4?.*'))
				.reply(200, createMessage({ id: '4', internalDate: '4000000000000' }));

			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': {
					lastTimeChecked: 3000000000,
					pendingMessageIds: ['1'],
				},
			};

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 5 } },
				workflowStaticData,
			});

			expect(response).toHaveLength(1);
			expect(response?.[0]).toHaveLength(2);
			expect(response?.[0]?.[0]?.json?.id).toBe('1');
			expect(response?.[0]?.[1]?.json?.id).toBe('4');
			// lastTimeChecked advances to newest message
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(4000000000);
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual([]);
		});

		it('should advance lastTimeChecked when all messages fit within limit', async () => {
			const initialTimestamp = 1000000;
			const messageListResponse: MessageListResponse = {
				messages: [createListMessage({ id: '1' })],
				resultSizeEstimate: 1,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, messageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '2000000000000' }));

			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			};

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 5 } },
				workflowStaticData,
			});

			// 1 message with maxResults=5, all fetched — advance normally
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(2000000000);
			// No pending messages
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toBeUndefined();
		});

		it('should not produce duplicates across a 3-poll pending drain cycle', async () => {
			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: 1000000 },
			};

			// Poll 1: 3 messages arrive, maxResults=2 → fetch 3,2; pending=['1']
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [
						createListMessage({ id: '3' }),
						createListMessage({ id: '2' }),
						createListMessage({ id: '1' }),
					],
					resultSizeEstimate: 3,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
				.reply(200, createMessage({ id: '3', internalDate: '3000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '2000000000000' }));

			const poll1 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(poll1.response?.[0]).toHaveLength(2);
			expect(poll1.response?.[0]?.[0]?.json?.id).toBe('3');
			expect(poll1.response?.[0]?.[1]?.json?.id).toBe('2');
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual(['1']);

			// Poll 2: drain pending msg 1, no new messages
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '1000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, { messages: [], resultSizeEstimate: 0 } satisfies MessageListResponse);

			const poll2 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(poll2.response?.[0]).toHaveLength(1);
			expect(poll2.response?.[0]?.[0]?.json?.id).toBe('1');
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(3000000000);

			// Poll 3: Gmail returns msg 3 again (boundary inclusive) → should be filtered
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [createListMessage({ id: '3' })],
					resultSizeEstimate: 1,
				} satisfies MessageListResponse);
			// No fetch mock for msg 3 — it's filtered at ID level by possibleDuplicates

			const poll3 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			// No duplicates — msg 3 was already returned in poll 1
			expect(poll3.response).toBeNull();
		});

		it('should reset possibleDuplicates when lastTimeChecked advances after a merge', async () => {
			// Verifies that the possibleDuplicates merge from pending drain is temporary —
			// once a newer message arrives and advances lastTimeChecked, duplicates reset.
			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: 1000000 },
			};

			// Poll 1: 3 messages, maxResults=2 → fetch 3,2; pending=['1']
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [
						createListMessage({ id: '3' }),
						createListMessage({ id: '2' }),
						createListMessage({ id: '1' }),
					],
					resultSizeEstimate: 3,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
				.reply(200, createMessage({ id: '3', internalDate: '3000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '2000000000000' }));

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			// Poll 2: drain pending msg 1, no new messages → merge happens
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '1000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, { messages: [], resultSizeEstimate: 0 } satisfies MessageListResponse);

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			// After merge: possibleDuplicates should include all three
			expect(workflowStaticData['Gmail Trigger'].possibleDuplicates).toEqual(
				expect.arrayContaining(['1', '2', '3']),
			);

			// Poll 3: new message 4 at a newer timestamp → lastTimeChecked advances
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [createListMessage({ id: '4' })],
					resultSizeEstimate: 1,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/4?.*'))
				.reply(200, createMessage({ id: '4', internalDate: '5000000000000' }));

			const poll3 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(poll3.response?.[0]).toHaveLength(1);
			expect(poll3.response?.[0]?.[0]?.json?.id).toBe('4');
			// possibleDuplicates reset to only msg 4 — old IDs purged
			expect(workflowStaticData['Gmail Trigger'].possibleDuplicates).toEqual(['4']);
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(5000000000);
		});

		it('should handle same-timestamp messages split across pending boundary', async () => {
			// 3 messages all at t=3000s, maxResults=2 → fetch 2, pending 1.
			// After drain, all 3 should be in possibleDuplicates.
			const ts = '3000000000000';
			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: 1000000 },
			};

			// Poll 1: fetch msgs A and B, pending=['C']
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [
						createListMessage({ id: 'A' }),
						createListMessage({ id: 'B' }),
						createListMessage({ id: 'C' }),
					],
					resultSizeEstimate: 3,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/A?.*'))
				.reply(200, createMessage({ id: 'A', internalDate: ts }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/B?.*'))
				.reply(200, createMessage({ id: 'B', internalDate: ts }));

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(workflowStaticData['Gmail Trigger'].possibleDuplicates).toEqual(
				expect.arrayContaining(['A', 'B']),
			);

			// Poll 2: drain pending C, no new messages
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/C?.*'))
				.reply(200, createMessage({ id: 'C', internalDate: ts }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, { messages: [], resultSizeEstimate: 0 } satisfies MessageListResponse);

			const poll2 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(poll2.response?.[0]).toHaveLength(1);
			expect(poll2.response?.[0]?.[0]?.json?.id).toBe('C');
			// All three same-timestamp messages tracked as possible duplicates
			expect(workflowStaticData['Gmail Trigger'].possibleDuplicates).toEqual(
				expect.arrayContaining(['A', 'B', 'C']),
			);
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(3000000000);
		});

		it('should advance lastTimeChecked when all V2 fetched messages are filtered as drafts', async () => {
			const initialTimestamp = 1000000;
			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: initialTimestamp },
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'DRAFT', name: 'DRAFT' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [createListMessage({ id: '1' }), createListMessage({ id: '2' })],
					resultSizeEstimate: 2,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '5000000000000', labelIds: ['DRAFT'] }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '4000000000000', labelIds: ['DRAFT'] }));

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				node: {
					typeVersion: 2,
					parameters: { simple: true, maxResults: 5, filters: { includeDrafts: false } },
				},
				workflowStaticData,
			});

			// No output — both messages are drafts
			expect(response).toBeNull();
			// But lastTimeChecked still advances (prevents infinite re-fetch)
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(5000000000);
		});

		it('should pick up new messages in the same poll after draining pending', async () => {
			// Poll 1: 5 messages, maxResults=2 → fetch [5,4], pending=[3,2,1]
			// Poll 2: drain [3,2], pending=[1], early return (budget exhausted)
			// Poll 3: drain [1], budget left=1, list returns new msg 6 → fetch it
			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': { lastTimeChecked: 1000000 },
			};

			// Poll 1
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [
						createListMessage({ id: '5' }),
						createListMessage({ id: '4' }),
						createListMessage({ id: '3' }),
						createListMessage({ id: '2' }),
						createListMessage({ id: '1' }),
					],
					resultSizeEstimate: 5,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/5?.*'))
				.reply(200, createMessage({ id: '5', internalDate: '5000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/4?.*'))
				.reply(200, createMessage({ id: '4', internalDate: '4000000000000' }));

			await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual(['3', '2', '1']);

			// Poll 2: drain [3,2], budget exhausted, pending=[1], early return
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/3?.*'))
				.reply(200, createMessage({ id: '3', internalDate: '3000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/2?.*'))
				.reply(200, createMessage({ id: '2', internalDate: '2000000000000' }));

			const poll2 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(poll2.response?.[0]).toHaveLength(2);
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual(['1']);

			// Poll 3: drain [1] (budget=2, uses 1), then list returns new msg 6
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1', internalDate: '1000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, {
					messages: [createListMessage({ id: '6' })],
					resultSizeEstimate: 1,
				} satisfies MessageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/6?.*'))
				.reply(200, createMessage({ id: '6', internalDate: '6000000000000' }));

			const poll3 = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			// Both pending msg 1 and new msg 6 returned in one poll
			expect(poll3.response?.[0]).toHaveLength(2);
			expect(poll3.response?.[0]?.[0]?.json?.id).toBe('1');
			expect(poll3.response?.[0]?.[1]?.json?.id).toBe('6');
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(6000000000);
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual([]);
		});

		it('should early-return when budget is fully consumed by pending messages', async () => {
			// maxResults=2, pending has 3 IDs → fetch 2, keep 1 pending, no listing
			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/A?.*'))
				.reply(200, createMessage({ id: 'A', internalDate: '1000000000000' }));
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/B?.*'))
				.reply(200, createMessage({ id: 'B', internalDate: '2000000000000' }));
			// No list mock — listing should NOT happen because budget is exhausted

			const workflowStaticData: Record<string, Record<string, unknown>> = {
				'Gmail Trigger': {
					lastTimeChecked: 5000000000,
					pendingMessageIds: ['A', 'B', 'C'],
					possibleDuplicates: ['X', 'Y'],
				},
			};

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
				workflowStaticData,
			});

			expect(response?.[0]).toHaveLength(2);
			expect(response?.[0]?.[0]?.json?.id).toBe('A');
			expect(response?.[0]?.[1]?.json?.id).toBe('B');
			// One pending ID remains
			expect(workflowStaticData['Gmail Trigger'].pendingMessageIds).toEqual(['C']);
			// possibleDuplicates and lastTimeChecked unchanged (early return path)
			expect(workflowStaticData['Gmail Trigger'].possibleDuplicates).toEqual(['X', 'Y']);
			expect(workflowStaticData['Gmail Trigger'].lastTimeChecked).toBe(5000000000);
		});

		it('should not apply limit in manual mode', async () => {
			const messageListResponse: MessageListResponse = {
				messages: [createListMessage({ id: '1' })],
				resultSizeEstimate: 1,
			};

			nock(baseUrl)
				.get('/gmail/v1/users/me/labels')
				.reply(200, { labels: [{ id: 'testLabelId', name: 'Test Label Name' }] });
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages?.*'))
				.reply(200, messageListResponse);
			nock(baseUrl)
				.get(new RegExp('/gmail/v1/users/me/messages/1?.*'))
				.reply(200, createMessage({ id: '1' }));

			const { response } = await testPollingTriggerNode(GmailTrigger, {
				mode: 'manual',
				node: { typeVersion: 2, parameters: { simple: true, maxResults: 2 } },
			});

			expect(response).toHaveLength(1);
			expect(response?.[0]?.[0]?.json?.id).toBe('1');
		});
	});
});
