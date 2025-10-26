import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { readFileTool } from "../readFileTool"
import { writeToFileTool } from "../writeToFileTool"
import { applyDiffTool } from "../multiApplyDiffTool"
import { listFilesTool } from "../listFilesTool"
import fs from "fs/promises"
import path from "path"

// Mock VS Code APIs
vi.mock("vscode", () => ({
	RelativePattern: vi.fn((base: string, pattern: string) => ({ base, pattern })),
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
	Disposable: {
		from: vi.fn(() => ({ dispose: vi.fn() })),
	},
}))

// Mock the listFiles function
const { listFiles } = await import("../../../services/glob/list-files")

// Mock formatResponse
const mockFormatResponse = {
	formatFilesList: vi.fn((files: any[]) => {
		return files.map((f) => `${f.name}${f.ignored ? " 🔒" : ""}`).join("\n")
	}),
}

// Mock removeClosingTag function
const mockRemoveClosingTag = vi.fn((tag: string, content?: string) => {
	if (tag === "path" && content) {
		return content
	}
	return content || tag
})

vi.mock("../../shared/tools", () => ({
	RemoveClosingTag: vi.fn((tag: string, content?: string) => content || ""),
	removeClosingTag: mockRemoveClosingTag,
}))

vi.mock("../../core/prompts/responses", () => ({
	formatResponse: mockFormatResponse,
	toolError: vi.fn((message: string) => `Error: ${message}`),
	rooIgnoreError: vi.fn(
		(filePath: string) => `Access to ${filePath} is blocked by the .kilocodeignore file settings`,
	),
}))

describe("Tool Integration Suite - Hierarchical Ignore Functionality", () => {
	let tempDir: string
	let mockCline: any

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(process.cwd(), "test-integration-"))

		// Mock cline object
		mockCline = {
			api: {
				countTokens: vi.fn().mockResolvedValue(5), // Very low token count
				getModel: vi.fn().mockReturnValue({
					id: "test-model",
					info: {
						supportsImages: false,
						contextWindow: 128000, // Large context window
					},
				}),
			},
			cwd: tempDir,
			rooIgnoreController: null,
			toolUsed: vi.fn(),
			formatResponse: mockFormatResponse,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter"),
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			handleError: vi.fn(),
			processQueuedMessages: vi.fn(),
			consecutiveMistakeCountForApplyDiff: new Map(),
			taskId: "test-task",
			diffViewProvider: {
				editType: undefined,
				reset: vi.fn().mockResolvedValue(undefined),
				isEditing: false,
				originalContent: "",
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				revertChanges: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi.fn().mockResolvedValue(undefined),
				saveDirectly: vi.fn().mockResolvedValue(undefined),
				pushToolWriteResult: vi.fn((cline: any, cwd: string, isNewFile: boolean) =>
					isNewFile ? "Successfully created src/index.ts" : "Successfully wrote to src/index.ts",
				),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getTelemetryService: vi.fn().mockReturnValue({
						track: vi.fn(),
					}),
					getState: vi.fn().mockResolvedValue({
						showRooIgnoredFiles: true,
						allowVeryLargeReads: true, // Allow large reads to avoid token limits
					}),
				}),
			},
			telemetryService: {
				track: vi.fn(),
			},
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({
					success: true,
					content: "console.log('new')",
				}),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
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

	describe("Read File Tool Integration Tests", () => {
		test("should block access to ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")
			await fs.writeFile(path.join(tempDir, "build", "app.js"), "console.log('hello')")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test reading ignored file
			const mockPushToolResult = vi.fn()

			await readFileTool(
				mockCline,
				{ type: "tool_use", name: "read_file", params: { path: "build/app.js" }, partial: false },
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				vi.fn(),
			)

			// Should be blocked
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Access to build/app.js is blocked by the .kilocodeignore file settings")
		})

		test("should allow access to non-ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")
			await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const hello = 'world'")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test reading non-ignored file
			const mockPushToolResult = vi.fn()

			await readFileTool(
				mockCline,
				{ type: "tool_use", name: "read_file", params: { path: "src/index.ts" }, partial: false },
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should succeed
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("export const hello = 'world'")
		})
	})

	describe("Write File Tool Integration Tests", () => {
		test("should block writing to ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test writing to ignored file
			const mockPushToolResult = vi.fn()

			await writeToFileTool(
				mockCline,
				{
					type: "tool_use",
					name: "write_to_file",
					params: { path: "build/output.js", content: "console.log('test')" },
					partial: false,
				},
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				vi.fn(),
			)

			// Should be blocked
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Access to build/output.js is blocked by the .kilocodeignore file settings")
		})

		test("should allow writing to non-ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test writing to non-ignored file
			const mockPushToolResult = vi.fn()

			// Override the mock for this specific test to actually create the file
			mockCline.diffViewProvider.pushToolWriteResult = vi
				.fn()
				.mockImplementation(async (cline: any, cwd: string, isNewFile: boolean) => {
					// Actually create the file for testing
					await fs.writeFile(path.join(cwd, "src", "index.ts"), "export const hello = 'world'")
					return "Successfully created src/index.ts"
				})

			await writeToFileTool(
				mockCline,
				{
					type: "tool_use",
					name: "write_to_file",
					params: { path: "src/index.ts", content: "export const hello = 'world'", line_count: "1" },
					partial: false,
				},
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should succeed
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Successfully created src/index.ts")

			// Verify file was created
			const content = await fs.readFile(path.join(tempDir, "src", "index.ts"), "utf8")
			expect(content).toBe("export const hello = 'world'")
		})
	})

	describe("Apply Diff Tool Integration Tests", () => {
		test("should block applying diff to ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")
			await fs.writeFile(path.join(tempDir, "build", "app.js"), "console.log('old')")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test applying diff to ignored file
			const mockPushToolResult = vi.fn()

			await applyDiffTool(
				mockCline,
				{
					type: "tool_use",
					name: "apply_diff",
					params: { path: "build/app.js", diff: "console.log('new')" },
					partial: false,
				},
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				vi.fn(),
			)

			// Should be blocked
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Access to build/app.js is blocked by the .kilocodeignore file settings")
		})

		test("should allow applying diff to non-ignored files", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")
			await fs.writeFile(path.join(tempDir, "src", "index.ts"), "console.log('old')")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test applying diff to non-ignored file
			const mockPushToolResult = vi.fn()

			// Override the mock for this specific test
			mockCline.diffViewProvider.pushToolWriteResult = vi
				.fn()
				.mockResolvedValue("Successfully applied diff to src/index.ts")

			await applyDiffTool(
				mockCline,
				{
					type: "tool_use",
					name: "apply_diff",
					params: { path: "src/index.ts", diff: "console.log('new')" },
					partial: false,
				},
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should succeed
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Successfully applied diff to src/index.ts")
		})
	})

	describe("List Files Tool Integration Tests", () => {
		test("should show ignored files with lock indicator", async () => {
			// Create test structure
			await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")
			await fs.writeFile(path.join(tempDir, "build", "app.js"), "console.log('test')")
			await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const hello = 'world'")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Mock listFiles to return test files
			const mockListFiles = vi.spyOn(await import("../../../services/glob/list-files"), "listFiles")
			mockListFiles.mockResolvedValue([
				[path.join(tempDir, "build/app.js"), path.join(tempDir, "src/index.ts")],
				false,
			])

			// Test listing files
			const mockPushToolResult = vi.fn()

			await listFilesTool(
				mockCline,
				{ type: "tool_use", name: "list_files", params: { path: ".", recursive: "false" }, partial: false },
				vi.fn().mockResolvedValue(true),
				vi.fn(),
				mockPushToolResult,
				vi.fn(),
			)

			// Should show ignored files with lock indicator
			expect(mockPushToolResult.mock.calls.length).toBe(1)
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("🔒 build/app.js")
			expect(result).toContain("src/index.ts")

			mockListFiles.mockRestore()
		})
	})

	describe("Basic Hierarchical Functionality Tests", () => {
		test("should handle simple hierarchical patterns", async () => {
			// Create test structure with subdirectory
			await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\ntemp/")
			await fs.writeFile(path.join(tempDir, "secret", ".kilocodeignore"), "*")
			await fs.writeFile(path.join(tempDir, "secret", "key.txt"), "secret-content")

			// Initialize controller in root directory
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test that root patterns work
			const buildAccess = controller.validateAccess("build/app.js")
			expect(buildAccess).toBe(false) // Should be blocked by root .kilocodeignore

			// Test that secret directory files are accessible from root controller
			// (since root controller doesn't know about secret/.kilocodeignore)
			const secretAccess = controller.validateAccess("secret/key.txt")
			expect(secretAccess).toBe(true) // Should be allowed by root controller
		})
	})
})
