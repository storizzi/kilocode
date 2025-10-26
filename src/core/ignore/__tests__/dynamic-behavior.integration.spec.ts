// npx vitest core/ignore/__tests__/dynamic-behavior.integration.spec.ts

import { RooIgnoreController } from "../RooIgnoreController"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { vi, beforeEach, afterEach, describe, test, expect } from "vitest"

// Mock vscode
vi.mock("vscode", () => {
	const mockDisposable = {
		dispose: vi.fn(),
	}

	const mockFileWatcher = {
		onDidCreate: vi.fn().mockReturnValue(mockDisposable),
		onDidDelete: vi.fn().mockReturnValue(mockDisposable),
		onDidChange: vi.fn().mockReturnValue(mockDisposable),
		dispose: vi.fn(),
	}

	return {
		workspace: {
			workspaceFolders: [
				{
					uri: {
						fsPath: "/mock/workspace",
					},
				},
			],
			getWorkspaceFolder: vi.fn().mockReturnValue({
				uri: {
					fsPath: "/mock/workspace",
				},
			}),
			fs: {
				readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
			},
			createFileSystemWatcher: vi.fn().mockReturnValue(mockFileWatcher),
			onDidChangeConfiguration: vi.fn().mockReturnValue(mockDisposable),
		},
		Uri: {
			file: vi.fn().mockImplementation((path) => path),
			joinPath: vi.fn().mockImplementation((base, ...segments) => ({
				fsPath: path.join(base.fsPath || base, ...segments),
			})),
		},
		RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
		window: {
			activeTextEditor: {
				document: {
					uri: {
						fsPath: "/mock/workspace",
					},
				},
			},
		},
	}
})

// Mock TelemetryService
vi.mock("../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

describe("Dynamic Behavior - File Watcher Integration Tests", () => {
	let testWorkspace: string

	beforeEach(async () => {
		// Create a temporary workspace for testing
		testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "kilocode-dynamic-test-"))
	})

	afterEach(async () => {
		// Clean up
		if (fs.existsSync(testWorkspace)) {
			fs.rmSync(testWorkspace, { recursive: true, force: true })
		}
	})

	describe("Controller Instance Behavior", () => {
		test("should handle different controller instances with different ignore files", async () => {
			// Create .kilocodeignore file at workspace root
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.log\n")

			// Create controller with ignore file
			const controller1 = new RooIgnoreController(testWorkspace)
			await controller1.initialize()

			// Test that .log files are ignored
			expect(controller1.validateAccess("test.log")).toBe(false)
			expect(controller1.validateAccess("test.js")).toBe(true)

			controller1.dispose()

			// Remove ignore file and create new controller
			fs.unlinkSync(ignoreFilePath)
			const controller2 = new RooIgnoreController(testWorkspace)
			await controller2.initialize()

			// Now .log files should not be ignored
			expect(controller2.validateAccess("test.log")).toBe(true)
			expect(controller2.validateAccess("test.js")).toBe(true)

			controller2.dispose()
		})

		test("should handle hierarchical ignore patterns correctly", async () => {
			const subDir = path.join(testWorkspace, "src")
			fs.mkdirSync(subDir, { recursive: true })

			// Create .kilocodeignore at workspace root
			const rootIgnorePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(rootIgnorePath, "*.log\n")

			// Create .kilocodeignore at subdirectory level
			const subIgnorePath = path.join(subDir, ".kilocodeignore")
			fs.writeFileSync(subIgnorePath, "!important.log\n")

			const controller = new RooIgnoreController(subDir) // Controller for subdirectory
			await controller.initialize()

			// Test hierarchical behavior
			const rootLogFile = "test.log" // Relative to subDir
			const importantLogFile = "important.log" // Relative to subDir

			// The controller should find both ignore files when walking up from subDir
			expect(controller.validateAccess(rootLogFile)).toBe(false) // Ignored by root
			expect(controller.validateAccess(importantLogFile)).toBe(true) // Override pattern

			controller.dispose()
		})

		test("should handle multiple controller instances consistently", async () => {
			// Create .kilocodeignore file at workspace root
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.tmp\n")

			// Create multiple controller instances
			const controller1 = new RooIgnoreController(testWorkspace)
			const controller2 = new RooIgnoreController(testWorkspace)

			await controller1.initialize()
			await controller2.initialize()

			const testFile = "test.tmp"
			const jsFile = "test.js"

			// Both should have the same behavior
			expect(controller1.validateAccess(testFile)).toBe(controller2.validateAccess(testFile))
			expect(controller1.validateAccess(jsFile)).toBe(controller2.validateAccess(jsFile))

			expect(controller1.validateAccess(testFile)).toBe(false)
			expect(controller1.validateAccess(jsFile)).toBe(true)

			controller1.dispose()
			controller2.dispose()
		})
	})

	describe("State Consistency", () => {
		test("should maintain consistent state across multiple calls", async () => {
			// Create .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.log\n*.tmp\n")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const testFiles = ["test1.log", "test2.log", "test3.tmp", "test4.js"]

			// Test multiple calls for consistency
			testFiles.forEach((file) => {
				const result1 = controller.validateAccess(file)
				const result2 = controller.validateAccess(file)
				const result3 = controller.validateAccess(file)

				expect(result1).toBe(result2)
				expect(result2).toBe(result3)
			})

			controller.dispose()
		})

		test("should handle concurrent access safely", async () => {
			// Create .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.log\n")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const testFile = "test.log"

			// Test multiple concurrent calls
			const promises = Array(10)
				.fill(null)
				.map(() => Promise.resolve(controller.validateAccess(testFile)))

			const results = await Promise.all(promises)

			// All results should be consistent
			results.forEach((result: boolean) => {
				expect(typeof result).toBe("boolean")
			})

			// All results should be the same
			const firstResult = results[0]
			results.forEach((result: boolean) => {
				expect(result).toBe(firstResult)
			})

			controller.dispose()
		})
	})

	describe("Error Handling", () => {
		test("should handle invalid ignore patterns gracefully", async () => {
			// Create invalid .kilocodeignore content
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "invalid pattern [\n")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const testFile = "test.log"

			// Should still function despite invalid ignore patterns
			expect(() => controller.validateAccess(testFile)).not.toThrow()

			controller.dispose()
		})

		test("should handle missing ignore files gracefully", async () => {
			// Don't create .kilocodeignore file

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const testFile = "test.log"

			// Should allow all files when no ignore file exists
			expect(controller.validateAccess(testFile)).toBe(true)

			controller.dispose()
		})
	})

	describe("Performance and Edge Cases", () => {
		test("should handle large ignore files efficiently", async () => {
			// Create a large .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			const patterns = []
			for (let i = 0; i < 1000; i++) {
				patterns.push(`*.tmp${i}\n`)
			}
			patterns.push("*.log\n")
			fs.writeFileSync(ignoreFilePath, patterns.join(""))

			const startTime = Date.now()
			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()
			const endTime = Date.now()

			// Should initialize within reasonable time
			expect(endTime - startTime).toBeLessThan(5000) // 5 seconds

			// Should still work correctly
			expect(controller.validateAccess("test.log")).toBe(false)
			expect(controller.validateAccess("test.tmp0")).toBe(false)
			expect(controller.validateAccess("test.js")).toBe(true)

			controller.dispose()
		})

		test("should handle deeply nested directory structures", async () => {
			const deepDir = path.join(testWorkspace, "deep", "nested", "very", "deep", "structure")
			fs.mkdirSync(deepDir, { recursive: true })

			// Create .kilocodeignore at various levels
			fs.writeFileSync(path.join(testWorkspace, ".kilocodeignore"), "*.log\n")
			fs.writeFileSync(path.join(testWorkspace, "deep", ".kilocodeignore"), "*.tmp\n")
			fs.writeFileSync(path.join(deepDir, ".kilocodeignore"), "!important.log\n")

			const controller = new RooIgnoreController(deepDir) // Controller for deepest directory
			await controller.initialize()

			const deepFile = "test.log" // Relative to deepDir
			const importantFile = "important.log" // Relative to deepDir
			const tmpFile = "test.tmp" // Relative to deepDir

			// Test hierarchical pattern application
			// The controller finds ignore files by walking up from deepDir
			// It finds: deepDir/.kilocodeignore, deep/.kilocodeignore, root/.kilocodeignore
			// Patterns are applied in order: root -> deep -> deepDir (most specific last)
			expect(controller.validateAccess(deepFile)).toBe(false) // Still ignored by root *.log
			expect(controller.validateAccess(importantFile)).toBe(true) // Explicitly allowed by !important.log
			expect(controller.validateAccess(tmpFile)).toBe(false) // Ignored by deep/*.tmp

			controller.dispose()
		})

		test("should handle empty ignore files", async () => {
			// Create empty .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const testFile = "test.log"

			// Should allow all files with empty ignore file
			expect(controller.validateAccess(testFile)).toBe(true)

			controller.dispose()
		})
	})

	describe("Filter Operations", () => {
		test("should filter paths correctly", async () => {
			// Create .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.log\n*.tmp\n")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const paths = ["app.js", "test.log", "temp.tmp", "config.json"]

			const filteredPaths = controller.filterPaths(paths)

			// Should only include non-ignored files
			expect(filteredPaths).toContain("app.js")
			expect(filteredPaths).toContain("config.json")
			expect(filteredPaths).not.toContain("test.log")
			expect(filteredPaths).not.toContain("temp.tmp")

			controller.dispose()
		})

		test("should handle empty path arrays", async () => {
			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const filteredPaths = controller.filterPaths([])

			expect(filteredPaths).toEqual([])

			controller.dispose()
		})
	})

	describe("Instructions and Content", () => {
		test("should provide correct instructions when ignore files exist", async () => {
			// Create .kilocodeignore file
			const ignoreFilePath = path.join(testWorkspace, ".kilocodeignore")
			fs.writeFileSync(ignoreFilePath, "*.log\n# This is a comment\n")

			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const instructions = controller.getInstructions()

			expect(instructions).toBeDefined()
			expect(instructions).toContain(".kilocodeignore")
			expect(instructions).toContain("*.log")
			expect(instructions).toContain("# This is a comment")

			controller.dispose()
		})

		test("should return undefined instructions when no ignore files exist", async () => {
			const controller = new RooIgnoreController(testWorkspace)
			await controller.initialize()

			const instructions = controller.getInstructions()

			expect(instructions).toBeUndefined()

			controller.dispose()
		})
	})
})
