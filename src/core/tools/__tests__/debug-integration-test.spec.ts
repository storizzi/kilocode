import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "os"

// Mock formatResponse before importing tools
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn(
			(error: string) => `The tool execution failed with the following error:\n<error>\n${error}\n</error>`,
		),
		rooIgnoreError: vi.fn(
			(path: string) =>
				`Access to ${path} is blocked by the .kilocodeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kilocodeignore file.`,
		),
		toolResult: vi.fn((content: string) => content),
		toolDenied: vi.fn(() => "Tool denied"),
		toolDeniedWithFeedback: vi.fn(() => "Tool denied with feedback"),
		toolApprovedWithFeedback: vi.fn(() => "Tool approved with feedback"),
		formatFilesList: vi.fn(
			(
				absolutePath: string,
				files: string[],
				didHitLimit: boolean,
				rooIgnoreController: any,
				showRooIgnoredFiles: boolean,
				rooProtectedController: any,
			) => {
				// Simulate the real formatFilesList behavior
				const sorted = files
					.map((file: string) => {
						// convert absolute path to relative path
						const relativePath = path.relative(absolutePath, file).toPosix()
						return file.endsWith("/") ? relativePath + "/" : relativePath
					})
					.sort()

				let rooIgnoreParsed: string[] = sorted

				if (rooIgnoreController) {
					rooIgnoreParsed = []
					for (const filePath of sorted) {
						// path is relative to absolute path, not cwd
						// validateAccess expects either path relative to cwd or absolute path
						const absoluteFilePath = path.resolve(absolutePath, filePath)
						const isIgnored = !rooIgnoreController.validateAccess(absoluteFilePath)

						if (isIgnored) {
							// If file is ignored and we're not showing ignored files, skip it
							if (!showRooIgnoredFiles) {
								continue
							}
							// Otherwise, mark it with a lock symbol
							rooIgnoreParsed.push("🔒 " + filePath)
						} else {
							// Check if file is write-protected (only for non-ignored files)
							const isWriteProtected =
								rooProtectedController?.isWriteProtected?.(absoluteFilePath) || false
							if (isWriteProtected) {
								rooIgnoreParsed.push("🛡️ " + filePath)
							} else {
								rooIgnoreParsed.push(filePath)
							}
						}
					}
				}

				return rooIgnoreParsed.join("\n")
			},
		),
	},
}))

// Mock vscode to avoid dependencies
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	RelativePattern: vi.fn(),
}))

// Import tools after mocking
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { readFileTool } from "../readFileTool"

describe("Debug Integration Test", () => {
	let tempDir: string
	let mockCline: any
	let mockApi: any

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(tmpdir(), "kilocode-debug-integration-"))

		// Mock the API
		mockApi = {
			getModel: () => ({
				info: {
					supportsImages: false,
					contextWindow: 1000000,
				},
				id: "test-model",
			}),
			countTokens: vi.fn(() => Promise.resolve(100)),
		}

		// Create mock cline instance
		mockCline = {
			cwd: tempDir,
			api: mockApi,
			providerRef: {
				deref: () => ({
					getState: () =>
						Promise.resolve({
							maxReadFileLine: -1,
							diagnosticsEnabled: true,
							writeDelayMs: 0,
							showRooIgnoredFiles: false,
							allowVeryLargeReads: true,
						}),
				}),
			},
			diffViewProvider: {
				editType: undefined,
				isEditing: false,
				originalContent: "",
				reset: vi.fn(),
				open: vi.fn(),
				update: vi.fn(),
				saveChanges: vi.fn(),
				saveDirectly: vi.fn(),
				revertChanges: vi.fn(),
				scrollToFirstDiff: vi.fn(),
				pushToolWriteResult: vi.fn().mockResolvedValue("File written successfully"),
			},
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			rooIgnoreController: null, // Will be set in tests
			rooProtectedController: { isWriteProtected: vi.fn().mockReturnValue(false) },
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			didEditFile: false,
			diffStrategy: null,
			apiConfiguration: {},
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter"),
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			handleError: vi.fn(),
			processQueuedMessages: vi.fn(),
			consecutiveMistakeCountForApplyDiff: new Map(),
			taskId: "test-task",
		}
	})

	afterEach(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	test("debug hierarchical functionality with controller in subdirectory", async () => {
		// Create directory structure and files
		await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "secret", "key.txt"), "secret-content")
		await fs.writeFile(path.join(tempDir, "build", "app.js"), "build-content")
		await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\ntemp/")
		await fs.writeFile(path.join(tempDir, "secret", ".kilocodeignore"), "*")

		// Create controller in the SECRET directory to test hierarchical behavior
		// This will find both secret/.kilocodeignore (most specific) and root .kilocodeignore
		const controller = new RooIgnoreController(path.join(tempDir, "secret"))
		await controller.initialize()

		// Update mockCline to use the secret directory as cwd
		mockCline.cwd = path.join(tempDir, "secret")
		mockCline.rooIgnoreController = controller

		// Wait for controller to initialize
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Debug: check if controller is working
		const secretAccess = controller.validateAccess("key.txt") // relative to secret dir
		const buildAccess = controller.validateAccess("../build/app.js") // relative to secret dir

		// Show debug info
		console.log("Debug info:")
		console.log("- key.txt access:", secretAccess)
		console.log("- ../build/app.js access:", buildAccess)

		expect(secretAccess).toBe(false) // Should be blocked by secret/.kilocodeignore (* pattern)
		expect(buildAccess, `buildAccess should be true but got ${buildAccess}`).toBe(true) // Should be allowed because ../build/app.js from secret doesn't match build/ pattern

		// Test the secret directory file (should be blocked by secret/.kilocodeignore)
		const mockPushToolResult = vi.fn()

		await readFileTool(
			mockCline,
			{ type: "tool_use", name: "read_file", params: { path: "key.txt" }, partial: false },
			vi.fn().mockResolvedValue(true),
			vi.fn(),
			mockPushToolResult,
			vi.fn(),
		)

		// Should be blocked
		expect(mockPushToolResult.mock.calls.length).toBe(1)
		const result1 = mockPushToolResult.mock.calls[0][0]
		expect(result1).toContain("Access to key.txt is blocked by the .kilocodeignore file settings")

		// Test the build directory file (should be allowed - ../build/app.js from secret doesn't match build/ pattern)
		const mockPushToolResult2 = vi.fn()

		await readFileTool(
			mockCline,
			{ type: "tool_use", name: "read_file", params: { path: "../build/app.js" }, partial: false },
			vi.fn().mockResolvedValue(true),
			vi.fn(),
			mockPushToolResult2,
			vi.fn(),
		)

		// Should be allowed (../build/app.js from secret directory doesn't match build/ pattern)
		expect(mockPushToolResult2.mock.calls.length).toBe(1)
		const result2 = mockPushToolResult2.mock.calls[0][0]
		expect(result2).toContain("build-content")
		expect(result2).toContain("<file>")

		controller.dispose()
	})
})
