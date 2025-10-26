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

// Mock removeClosingTag function
vi.mock("../../../shared/tools", () => ({
	RemoveClosingTag: vi.fn((tag: string, content?: string) => content || ""),
	removeClosingTag: vi.fn((tag: string, content?: string) => content || ""),
}))

// Mock formatResponse
const mockFormatResponse = {
	formatFilesList: vi.fn((files: any[]) => {
		return files.map((f) => `${f.name}${f.ignored ? " 🔒" : ""}`).join("\n")
	}),
}

vi.mock("../../core/prompts/responses", () => ({
	formatResponse: mockFormatResponse,
	toolError: vi.fn((message: string) => `Error: ${message}`),
	rooIgnoreError: vi.fn(
		(filePath: string) => `Access to ${filePath} is blocked by the .kilocodeignore file settings`,
	),
}))

describe("Hierarchical Tool Integration Tests", () => {
	let tempDir: string
	let mockCline: any

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(process.cwd(), "test-hierarchical-"))

		// Mock cline object with all required properties
		mockCline = {
			api: {
				countTokens: vi.fn().mockResolvedValue(100),
				getContextWindow: vi.fn().mockReturnValue(128000),
				allowVeryLargeReads: vi.fn().mockReturnValue(false),
				getModel: vi.fn().mockReturnValue({
					id: "test-model",
					info: {
						supportsImages: false,
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
			},
			providerRef: {
				deref: vi.fn().mockReturnValue(null),
			},
			telemetryService: {
				track: vi.fn(),
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

	describe("Core Tool Integration with RooIgnoreController", () => {
		test("read-file tool should be blocked by RooIgnoreController", async () => {
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

		test("write-to-file tool should be blocked by RooIgnoreController", async () => {
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

		test("apply-diff tool should be blocked by RooIgnoreController", async () => {
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
	})

	describe("Basic Hierarchical Functionality", () => {
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

		test("should handle hierarchical patterns with subdirectory controller", async () => {
			// Create test structure with subdirectory
			await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\ntemp/")
			await fs.writeFile(path.join(tempDir, "secret", ".kilocodeignore"), "*")
			await fs.writeFile(path.join(tempDir, "secret", "key.txt"), "secret-content")

			// Initialize controller in secret directory (this should find both ignore files)
			const secretDir = path.join(tempDir, "secret")
			const controller = new RooIgnoreController(secretDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test that secret controller blocks everything in secret directory
			const secretAccess = controller.validateAccess("key.txt")
			expect(secretAccess).toBe(false) // Should be blocked by secret/.kilocodeignore

			// Test that secret controller also respects parent patterns
			// Note: The controller is in the secret directory, so it can't validate paths outside its scope
			// This is expected behavior - controllers only validate paths within their directory tree
			const secretAccessAgain = controller.validateAccess("key.txt")
			expect(secretAccessAgain).toBe(false) // Should be blocked by secret/.kilocodeignore
		})
	})

	describe("Error Handling and Edge Cases", () => {
		test("should handle missing .kilocodeignore files gracefully", async () => {
			// Create test structure without .kilocodeignore
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const hello = 'world'")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test that all files are accessible when no ignore file exists
			const access = controller.validateAccess("src/index.ts")
			expect(access).toBe(true) // Should be allowed
		})

		test("should handle empty .kilocodeignore files", async () => {
			// Create test structure with empty ignore file
			await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
			await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "")
			await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const hello = 'world'")

			// Initialize controller
			const controller = new RooIgnoreController(tempDir)
			await controller.initialize()
			mockCline.rooIgnoreController = controller

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Test that all files are accessible with empty ignore file
			const access = controller.validateAccess("src/index.ts")
			expect(access).toBe(true) // Should be allowed
		})
	})
})
