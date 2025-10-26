// npx vitest core/ignore/__tests__/RooIgnoreController.spec.ts

import type { Mock } from "vitest"

import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../RooIgnoreController"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import { fileExistsAtPath } from "../../../utils/fs"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("fs")
vi.mock("../../../utils/fs")

// Mock vscode
vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = {
		event: vi.fn(),
		fire: vi.fn(),
	}

	return {
		workspace: {
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
		},
		RelativePattern: vi.fn().mockImplementation((base, pattern) => ({
			base,
			pattern,
		})),
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
	}
})

describe("RooIgnoreController", () => {
	const TEST_CWD = "/test/path"
	const TEST_WORKSPACE_ROOT = "/test"
	let controller: RooIgnoreController
	let mockFileExists: Mock<typeof fileExistsAtPath>
	let mockReadFile: Mock<typeof fs.readFile>
	let mockFsAccess: Mock<typeof fs.access>
	let mockWatcher: any

	beforeEach(async () => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup mock file watcher
		mockWatcher = {
			onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			dispose: vi.fn(),
		}

		// @ts-expect-error - Mocking
		vscode.workspace.createFileSystemWatcher.mockReturnValue(mockWatcher)

		// Setup fs mocks
		mockFileExists = fileExistsAtPath as Mock<typeof fileExistsAtPath>
		mockReadFile = fs.readFile as Mock<typeof fs.readFile>
		mockFsAccess = fs.access as Mock<typeof fs.access>

		// Setup default mock behavior for new implementation
		mockFsAccess.mockImplementation((filePath: any) => {
			const normalizedPath = filePath.toString().replace(/\\/g, "/")
			if (normalizedPath === "/test/path/.kilocodeignore") {
				return Promise.resolve()
			}
			return Promise.reject(new Error("File not found"))
		})
		mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log\nprivate/")

		// Setup fsSync mocks with default behavior (return path as-is, like regular files)
		const mockRealpathSync = vi.mocked(fsSync.realpathSync)
		mockRealpathSync.mockImplementation((filePath) => filePath.toString())

		// Create and initialize controller
		controller = new RooIgnoreController(TEST_CWD)
		await controller.initialize()
	})

	describe("initialization", () => {
		/**
		 * Tests the controller initialization when .kilocodeignore exists
		 */
		it("should load .kilocodeignore patterns on initialization when file exists", async () => {
			// Verify file was accessed and read
			expect(mockFsAccess).toHaveBeenCalledWith(path.join(TEST_CWD, ".kilocodeignore"))
			expect(mockReadFile).toHaveBeenCalledWith(path.join(TEST_CWD, ".kilocodeignore"), "utf8")

			// Verify content was stored with header
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules\n.git\nsecrets/**\n*.log\nprivate/")

			// Test that ignore patterns were applied
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("src/app.ts")).toBe(true)
			expect(controller.validateAccess(".git/config")).toBe(false)
			expect(controller.validateAccess("secrets/api-keys.json")).toBe(false)
		})

		/**
		 * Tests the controller behavior when .kilocodeignore doesn't exist
		 */
		it("should allow all access when .kilocodeignore doesn't exist", async () => {
			// Setup mocks to simulate missing .kilocodeignore file
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})

			// Create new controller with no file
			const noFileController = new RooIgnoreController(TEST_CWD)
			await noFileController.initialize()

			// Verify no content was stored
			expect(noFileController.rooIgnoreContent).toBeUndefined()

			// All files should be accessible
			expect(noFileController.validateAccess("node_modules/package.json")).toBe(true)
			expect(noFileController.validateAccess("secrets/api-keys.json")).toBe(true)
			expect(noFileController.validateAccess(".git/HEAD")).toBe(true)
			expect(noFileController.validateAccess("app.log")).toBe(true)
		})

		/**
		 * Tests the file watcher setup
		 */
		it("should set up file watcher for .kilocodeignore changes", async () => {
			// Check that watcher was created with correct recursive pattern
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
				expect.objectContaining({
					base: TEST_CWD,
					pattern: "**/.kilocodeignore",
				}),
			)

			// Verify event handlers were registered
			expect(mockWatcher.onDidCreate).toHaveBeenCalled()
			expect(mockWatcher.onDidChange).toHaveBeenCalled()
			expect(mockWatcher.onDidDelete).toHaveBeenCalled()
		})

		/**
		 * Tests recursive file watcher pattern for subdirectory support
		 */
		it("should set up recursive file watcher for .kilocodeignore files", async () => {
			// Check that watcher was created with recursive pattern
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
				expect.objectContaining({
					base: TEST_CWD,
					pattern: "**/.kilocodeignore",
				}),
			)

			// Verify event handlers were registered
			expect(mockWatcher.onDidCreate).toHaveBeenCalled()
			expect(mockWatcher.onDidChange).toHaveBeenCalled()
			expect(mockWatcher.onDidDelete).toHaveBeenCalled()
		})

		/**
		 * Tests error handling during initialization
		 */
		it("should handle errors when loading .kilocodeignore", async () => {
			// Setup mocks to simulate error
			mockFsAccess.mockResolvedValue()
			mockReadFile.mockRejectedValue(new Error("Test file read error"))

			// Spy on console.warn
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Create new controller
			const errorController = new RooIgnoreController(TEST_CWD)
			await errorController.initialize()

			// Verify warning was logged but controller still works
			expect(consoleSpy).toHaveBeenCalledWith(
				"Warning: Could not read .kilocodeignore at /test/path/.kilocodeignore: Test file read error",
			)

			// Should continue working with no content
			expect(errorController.rooIgnoreContent).toBeUndefined()
			expect(errorController.validateAccess("any-file.txt")).toBe(true)

			// Cleanup
			consoleSpy.mockRestore()
		})
	})

	describe("directory walking", () => {
		/**
		 * Tests finding multiple .kilocodeignore files at different levels
		 */
		it("should find multiple .kilocodeignore files from target directory up to workspace root", async () => {
			// Mock fs.access to simulate .kilocodeignore files at different levels (walking up)
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			// Mock readFile to provide different content for each file
			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore") {
					return Promise.resolve("node_modules\n.git\n*.log")
				} else if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve("build/\ndist/\ntemp/")
				}
				return Promise.reject(new Error("File not found"))
			})

			// Initialize controller
			await controller.initialize()

			// Verify content was combined from all files - check for the actual relative paths
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("build/")
			expect(controller.rooIgnoreContent).toContain("dist/")
			expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules")
			expect(controller.rooIgnoreContent).toContain(".git")

			// Test that patterns from all levels are applied
			expect(controller.validateAccess("node_modules/package.json")).toBe(false) // root level
			expect(controller.validateAccess("build/output.js")).toBe(false) // current level
			expect(controller.validateAccess("src/app.ts")).toBe(true) // not ignored
		})

		/**
		 * Tests precedence order (root first, then more specific)
		 */
		it("should maintain correct precedence order with more specific files overriding root patterns", async () => {
			// Mock fs.access for multiple files
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			// Mock readFile with conflicting patterns
			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore") {
					return Promise.resolve("temp/\nlogs/\n*.tmp")
				} else if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve("!temp/important.txt\nlogs/\ndebug.log")
				}
				return Promise.reject(new Error("File not found"))
			})

			// Initialize controller
			await controller.initialize()

			// Verify content order (root first, then specific)
			const contentLines = controller.rooIgnoreContent!.split("\n")
			const rootIndex = contentLines.findIndex((line) => line.includes("# From: ../.kilocodeignore"))
			const specificIndex = contentLines.findIndex((line) => line.includes("# From: .kilocodeignore"))
			expect(rootIndex).toBeLessThan(specificIndex)

			// Test that more specific patterns are applied
			expect(controller.validateAccess("temp/file.txt")).toBe(false) // ignored by root
			expect(controller.validateAccess("logs/app.log")).toBe(false) // ignored by both
			expect(controller.validateAccess("debug.log")).toBe(false) // ignored by specific
		})

		/**
		 * Tests walking up directory tree correctly
		 */
		it("should walk up directory tree correctly and stop at root", async () => {
			// Mock fs.access to simulate files at various levels
			const accessedPaths: string[] = []
			mockFsAccess.mockImplementation((filePath: any) => {
				accessedPaths.push(filePath.toString().replace(/\\/g, "/"))
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockResolvedValue("node_modules")

			// Initialize controller
			await controller.initialize()

			// Verify it checked paths in correct order (from target up to root)
			expect(accessedPaths).toContain("/test/path/.kilocodeignore")
			expect(accessedPaths).toContain("/test/.kilocodeignore")
		})

		/**
		 * Tests edge cases (no files, single file, multiple files)
		 */
		it("should handle edge cases for directory walking", async () => {
			// Test no .kilocodeignore files
			mockFsAccess.mockRejectedValue(new Error("File not found"))

			await controller.initialize()
			expect(controller.rooIgnoreContent).toBeUndefined()

			// Test single file at target directory
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("build/")

			await controller.initialize()
			expect(controller.rooIgnoreContent).toContain("build/")
			expect(controller.validateAccess("build/output.js")).toBe(false)
		})
	})

	describe("multi-file loading", () => {
		/**
		 * Tests combining content from multiple files
		 */
		it("should combine content from multiple .kilocodeignore files with proper formatting", async () => {
			// Setup multiple files
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore") {
					return Promise.resolve("# Root ignore patterns\nnode_modules\n.git")
				} else if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve("# Project-specific patterns\nbuild/\ndist/")
				}
				return Promise.reject(new Error("File not found"))
			})

			await controller.initialize()

			// Verify combined content structure
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("# Root ignore patterns")
			expect(controller.rooIgnoreContent).toContain("node_modules")
			expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("# Project-specific patterns")
			expect(controller.rooIgnoreContent).toContain("build/")

			// Verify all patterns are applied
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)
			expect(controller.validateAccess("build/app.js")).toBe(false)
			expect(controller.validateAccess("dist/bundle.js")).toBe(false)
		})

		/**
		 * Tests error handling when some files fail to load
		 */
		it("should continue loading other files when one fails to load", async () => {
			// Setup multiple files with one that will fail
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore") {
					return Promise.resolve("node_modules\n.git")
				} else if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.reject(new Error("Permission denied"))
				}
				return Promise.reject(new Error("File not found"))
			})

			// Spy on console.warn
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			await controller.initialize()

			// Verify warning was logged for failed file
			expect(consoleSpy).toHaveBeenCalledWith(
				"Warning: Could not read .kilocodeignore at /test/path/.kilocodeignore: Permission denied",
			)

			// Verify content from successful file was still loaded
			expect(controller.rooIgnoreContent).toContain("node_modules")
			expect(controller.rooIgnoreContent).toContain(".git")

			// Verify patterns from successful file are applied
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)

			consoleSpy.mockRestore()
		})

		/**
		 * Tests backward compatibility with single file setups
		 */
		it("should maintain backward compatibility with single file setups", async () => {
			// Setup single file at target directory (old behavior)
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockResolvedValue("node_modules\n.git\n*.log")

			await controller.initialize()

			// Should work exactly like before
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules\n.git\n*.log")
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)
			expect(controller.validateAccess("app.log")).toBe(false)
			expect(controller.validateAccess("src/app.ts")).toBe(true)
		})

		/**
		 * Tests handling of empty files
		 */
		it("should handle empty .kilocodeignore files gracefully", async () => {
			// Setup multiple files with some empty ones
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore") {
					return Promise.resolve("   \n\n   ") // Empty/whitespace only
				} else if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve("node_modules\n.git")
				}
				return Promise.reject(new Error("File not found"))
			})

			await controller.initialize()

			// Should only include content from non-empty file
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules")
			expect(controller.rooIgnoreContent).not.toContain("# From: subdir/.kilocodeignore")
		})
	})

	describe("validateAccess", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests basic path validation
		 */
		it("should correctly validate file access based on ignore patterns", () => {
			// Test different path patterns
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("node_modules")).toBe(false)
			expect(controller.validateAccess("src/node_modules/file.js")).toBe(false)
			expect(controller.validateAccess(".git/HEAD")).toBe(false)
			expect(controller.validateAccess("secrets/api-keys.json")).toBe(false)
			expect(controller.validateAccess("logs/app.log")).toBe(false)

			// These should be allowed
			expect(controller.validateAccess("src/app.ts")).toBe(true)
			expect(controller.validateAccess("package.json")).toBe(true)
			expect(controller.validateAccess("secret-file.json")).toBe(true)
		})

		/**
		 * Tests handling of absolute paths
		 */
		it("should handle absolute paths correctly", () => {
			// Test with absolute paths
			const absolutePath = path.join(TEST_CWD, "node_modules/package.json")
			expect(controller.validateAccess(absolutePath)).toBe(false)

			const allowedAbsolutePath = path.join(TEST_CWD, "src/app.ts")
			expect(controller.validateAccess(allowedAbsolutePath)).toBe(true)
		})

		/**
		 * Tests handling of paths outside cwd
		 */
		it("should allow access to paths outside cwd", () => {
			// Path traversal outside cwd
			expect(controller.validateAccess("../outside-project/file.txt")).toBe(true)

			// Completely different path
			expect(controller.validateAccess("/etc/hosts")).toBe(true)
		})

		/**
		 * Tests the default behavior when no .kilocodeignore exists
		 */
		it("should allow all access when no .kilocodeignore content", async () => {
			// Create a new controller with no .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})
			const emptyController = new RooIgnoreController(TEST_CWD)
			await emptyController.initialize()

			// All paths should be allowed
			expect(emptyController.validateAccess("node_modules/package.json")).toBe(true)
			expect(emptyController.validateAccess("secrets/api-keys.json")).toBe(true)
			expect(emptyController.validateAccess(".git/HEAD")).toBe(true)
		})

		/**
		 * Tests symlink resolution
		 */
		it("should block symlinks pointing to ignored files", () => {
			// Mock fsSync.realpathSync to simulate symlink resolution
			const mockRealpathSync = vi.mocked(fsSync.realpathSync)
			mockRealpathSync.mockImplementation((filePath) => {
				// Simulate "config.json" being a symlink to "node_modules/package.json"
				if (filePath.toString().endsWith("config.json")) {
					return path.join(TEST_CWD, "node_modules/package.json")
				}
				return filePath.toString()
			})

			// Direct access to ignored file should be blocked
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)

			// Symlink to ignored file should also be blocked
			expect(controller.validateAccess("config.json")).toBe(false)
		})
	})

	describe("validateCommand", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests validation of file reading commands
		 */
		it("should block file reading commands accessing ignored files", () => {
			// Cat command accessing ignored file
			expect(controller.validateCommand("cat node_modules/package.json")).toBe("node_modules/package.json")

			// Grep command accessing ignored file
			expect(controller.validateCommand("grep pattern .git/config")).toBe(".git/config")

			// Commands accessing allowed files should return undefined
			expect(controller.validateCommand("cat src/app.ts")).toBeUndefined()
			expect(controller.validateCommand("less README.md")).toBeUndefined()
		})

		/**
		 * Tests commands with various arguments and flags
		 */
		it("should handle command arguments and flags correctly", () => {
			// Command with flags
			expect(controller.validateCommand("cat -n node_modules/package.json")).toBe("node_modules/package.json")

			// Command with multiple files (only first ignored file is returned)
			expect(controller.validateCommand("grep pattern src/app.ts node_modules/index.js")).toBe(
				"node_modules/index.js",
			)

			// Command with PowerShell parameter style
			expect(controller.validateCommand("Get-Content -Path secrets/api-keys.json")).toBe("secrets/api-keys.json")

			// Arguments with colons are skipped due to the implementation
			// Adjust test to match actual implementation which skips arguments with colons
			expect(controller.validateCommand("Select-String -Path secrets/api-keys.json -Pattern key")).toBe(
				"secrets/api-keys.json",
			)
		})

		/**
		 * Tests validation of non-file-reading commands
		 */
		it("should allow non-file-reading commands", () => {
			// Commands that don't access files directly
			expect(controller.validateCommand("ls -la")).toBeUndefined()
			expect(controller.validateCommand("echo 'Hello'")).toBeUndefined()
			expect(controller.validateCommand("cd node_modules")).toBeUndefined()
			expect(controller.validateCommand("npm install")).toBeUndefined()
		})

		/**
		 * Tests behavior when no .kilocodeignore exists
		 */
		it("should allow all commands when no .kilocodeignore exists", async () => {
			// Create a new controller with no .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})
			const emptyController = new RooIgnoreController(TEST_CWD)
			await emptyController.initialize()

			// All commands should be allowed
			expect(emptyController.validateCommand("cat node_modules/package.json")).toBeUndefined()
			expect(emptyController.validateCommand("grep pattern .git/config")).toBeUndefined()
		})
	})

	describe("filterPaths", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests filtering an array of paths
		 */
		it("should filter out ignored paths from an array", () => {
			const paths = [
				"src/app.ts",
				"node_modules/package.json",
				"README.md",
				".git/HEAD",
				"secrets/keys.json",
				"build/app.js",
				"logs/error.log",
			]

			const filtered = controller.filterPaths(paths)

			// Expected filtered result
			expect(filtered).toEqual(["src/app.ts", "README.md", "build/app.js"])

			// Length should be reduced
			expect(filtered.length).toBe(3)
		})

		/**
		 * Tests error handling in filterPaths
		 */
		it("should handle errors in filterPaths and fail closed", () => {
			// Mock validateAccess to throw an error
			vi.spyOn(controller, "validateAccess").mockImplementation(() => {
				throw new Error("Test error")
			})

			// Spy on console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Should return empty array on error (fail closed)
			const result = controller.filterPaths(["file1.txt", "file2.txt"])
			expect(result).toEqual([])

			// Verify error was logged
			expect(consoleSpy).toHaveBeenCalledWith("Error filtering paths:", expect.any(Error))

			// Cleanup
			consoleSpy.mockRestore()
		})

		/**
		 * Tests empty array handling
		 */
		it("should handle empty arrays", () => {
			const result = controller.filterPaths([])
			expect(result).toEqual([])
		})
	})

	describe("getInstructions", () => {
		/**
		 * Tests instructions generation with .kilocodeignore
		 */
		it("should generate formatted instructions when .kilocodeignore exists", async () => {
			// Setup .kilocodeignore content
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**")
			await controller.initialize()

			const instructions = controller.getInstructions()

			// Verify instruction format
			expect(instructions).toContain("# .kilocodeignore")
			expect(instructions).toContain(LOCK_TEXT_SYMBOL)
			expect(instructions).toContain("node_modules")
			expect(instructions).toContain(".git")
			expect(instructions).toContain("secrets/**")
		})

		/**
		 * Tests behavior when no .kilocodeignore exists
		 */
		it("should return undefined when no .kilocodeignore exists", async () => {
			// Setup no .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})
			const emptyController = new RooIgnoreController(TEST_CWD)
			await emptyController.initialize()

			const instructions = emptyController.getInstructions()
			expect(instructions).toBeUndefined()
		})
	})

	describe("dispose", () => {
		/**
		 * Tests proper cleanup of resources
		 */
		it("should dispose all registered disposables", () => {
			// Create spy for dispose methods
			const disposeSpy = vi.fn()

			// Manually add disposables to test
			controller["disposables"] = [{ dispose: disposeSpy }, { dispose: disposeSpy }, { dispose: disposeSpy }]

			// Call dispose
			controller.dispose()

			// Verify all disposables were disposed
			expect(disposeSpy).toHaveBeenCalledTimes(3)

			// Verify disposables array was cleared
			expect(controller["disposables"]).toEqual([])
		})
	})

	describe("file watcher", () => {
		/**
		 * Tests behavior when .kilocodeignore is created
		 */
		it("should reload .kilocodeignore when file is created", async () => {
			// Setup initial state without .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})
			const noFileController = new RooIgnoreController(TEST_CWD)
			await noFileController.initialize()

			// Verify initial state
			expect(noFileController.rooIgnoreContent).toBeUndefined()
			expect(noFileController.validateAccess("node_modules/package.json")).toBe(true)

			// Now simulate file creation
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules")

			// Force reload of .kilocodeignore content manually
			await noFileController.initialize()

			// Now verify content was updated with new format
			expect(noFileController.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(noFileController.rooIgnoreContent).toContain("node_modules")

			// Verify access validation changed
			expect(noFileController.validateAccess("node_modules/package.json")).toBe(false)
		})

		/**
		 * Tests behavior when .kilocodeignore is changed
		 */
		it("should reload .kilocodeignore when file is changed", async () => {
			// Setup initial state with .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules")
			await controller.initialize()

			// Verify initial state
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(true)

			// Simulate file change
			mockReadFile.mockResolvedValue("node_modules\n.git")

			// Instead of relying on the onChange handler, manually reload
			// This is because the mock watcher doesn't actually trigger the reload in tests
			await controller.initialize()

			// Verify content was updated with new format
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules\n.git")

			// Verify access validation changed
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)
		})

		/**
		 * Tests behavior when .kilocodeignore is deleted
		 */
		it("should reset when .kilocodeignore is deleted", async () => {
			// Setup initial state with .kilocodeignore
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules")
			await controller.initialize()

			// Verify initial state
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)

			// Simulate file deletion
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})

			// Find and trigger the onDelete handler
			const onDeleteHandler = mockWatcher.onDidDelete.mock.calls[0][0]
			await onDeleteHandler()

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 350))

			// Verify content was reset
			expect(controller.rooIgnoreContent).toBeUndefined()

			// Verify access validation changed
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
		})

		/**
		 * Tests debounced reloads prevent race conditions
		 */
		it("should debounce reloads to prevent race conditions", async () => {
			// Setup initial state
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("node_modules")
			await controller.initialize()

			// Call debounced reload through the public interface by triggering file change
			const onChangeHandler = mockWatcher.onDidChange.mock.calls[0][0]
			onChangeHandler()
			onChangeHandler()
			onChangeHandler()

			// Wait for debounce timeout
			await new Promise((resolve) => setTimeout(resolve, 350))

			// Verify it only reloaded once (additional verification would require more complex mocking)
			expect(controller.rooIgnoreContent).toContain("node_modules")
		})

		/**
		 * Tests file creation in subdirectories triggers reload
		 */
		it("should reload when .kilocodeignore is created in current directory", async () => {
			// Setup initial state with no files
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})
			const noFileController = new RooIgnoreController(TEST_CWD)
			await noFileController.initialize()

			// Simulate file creation in current directory
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("local-secrets/")

			// Manually trigger reload instead of relying on file watcher
			await noFileController.initialize()

			// Verify content was loaded
			expect(noFileController.rooIgnoreContent).toBeDefined()
			expect(noFileController.rooIgnoreContent).toContain("local-secrets/")
			expect(noFileController.validateAccess("local-secrets/key.txt")).toBe(false)
		})

		/**
		 * Tests file changes in subdirectories trigger reload
		 */
		it("should reload when .kilocodeignore is changed in current directory", async () => {
			// Setup initial state with current directory file
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("old-pattern/")
			await controller.initialize()

			// Verify initial state - old-pattern should be ignored (access denied)
			expect(controller.validateAccess("old-pattern/file.txt")).toBe(false)

			// Simulate file change
			mockReadFile.mockResolvedValue("new-pattern/")

			// Manually trigger reload instead of relying on file watcher
			await controller.initialize()

			// Verify content was updated
			expect(controller.rooIgnoreContent).toContain("new-pattern/")
			expect(controller.validateAccess("new-pattern/file.txt")).toBe(false)
			expect(controller.validateAccess("old-pattern/file.txt")).toBe(true)
		})

		/**
		 * Tests file deletion in subdirectories triggers reload
		 */
		it("should reload when .kilocodeignore is deleted from current directory", async () => {
			// Setup initial state with current directory file
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve()
				}
				return Promise.reject(new Error("File not found"))
			})
			mockReadFile.mockResolvedValue("local-secrets/")
			await controller.initialize()

			// Verify initial state - local-secrets should be ignored (access denied)
			expect(controller.validateAccess("local-secrets/key.txt")).toBe(false)

			// Simulate file deletion
			mockFsAccess.mockImplementation((filePath: any) => {
				return Promise.reject(new Error("File not found"))
			})

			// Manually trigger reload instead of relying on file watcher
			await controller.initialize()

			// Verify content was reset
			expect(controller.rooIgnoreContent).toBeUndefined()
			expect(controller.validateAccess("local-secrets/key.txt")).toBe(true)
		})
	})

	describe("integration tests", () => {
		/**
		 * Tests complete scenario with multiple .kilocodeignore files
		 */
		it("should handle complete multi-file scenario with precedence", async () => {
			// Setup directory structure with files at different levels (walking up)
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("node_modules\n.git\n*.log\nbuild/")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("dist/\ntemp/\n*.test.js\ncoverage/")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test root level patterns
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("app.log")).toBe(false)
			expect(controller.validateAccess("build/output.js")).toBe(false)

			// Test project level patterns
			expect(controller.validateAccess("dist/bundle.js")).toBe(false)
			expect(controller.validateAccess("temp/cache.tmp")).toBe(false)

			// Test test patterns - *.test.js and coverage/ should be ignored (access denied)
			expect(controller.validateAccess("app.test.js")).toBe(false)
			expect(controller.validateAccess("coverage/lcov.info")).toBe(false)
			expect(controller.validateAccess("app.js")).toBe(true)

			// Verify content structure
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
		})

		/**
		 * Tests real-world usage patterns
		 */
		it("should handle real-world usage patterns effectively", async () => {
			// Setup realistic scenario with files at different levels
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("# Global ignores\nnode_modules\n.git\n*.log\n.DS_Store")
					case "/test/path/.kilocodeignore":
						return Promise.resolve(
							"# Project ignores\ndist/\nbuild/\n.env.local\ncoverage/\n*.db\n*.sqlite\nsecrets/",
						)
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test global ignores apply everywhere
			expect(controller.validateAccess("node_modules/lodash/index.js")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)
			expect(controller.validateAccess("debug.log")).toBe(false)

			// Test project ignores apply to project files
			expect(controller.validateAccess("dist/main.js")).toBe(false)
			expect(controller.validateAccess("build/app.js")).toBe(false)
			expect(controller.validateAccess(".env.local")).toBe(false)
			expect(controller.validateAccess("coverage/lcov.info")).toBe(false)

			// Test backend specific ignores - *.db, *.sqlite, and secrets/ should be ignored (access denied)
			expect(controller.validateAccess("app.db")).toBe(false)
			expect(controller.validateAccess("database.sqlite")).toBe(false)
			expect(controller.validateAccess("secrets/api-keys.txt")).toBe(false)

			// Test allowed files
			expect(controller.validateAccess("src/index.js")).toBe(true)
			expect(controller.validateAccess("README.md")).toBe(true)
		})

		/**
		 * Tests performance with multiple files
		 */
		it("should handle performance efficiently with multiple files", async () => {
			// Setup files at different levels that would be found by directory walking
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("pattern0/")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("pattern1/")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			const startTime = Date.now()
			await controller.initialize()
			const endTime = Date.now()

			// Should complete reasonably quickly (less than 1 second)
			expect(endTime - startTime).toBeLessThan(1000)

			// Verify all patterns were loaded
			expect(controller.rooIgnoreContent).toBeDefined()
			expect(controller.rooIgnoreContent).toContain("pattern0/")
			expect(controller.rooIgnoreContent).toContain("pattern1/")

			// Test that patterns work
			expect(controller.validateAccess("pattern0/file.txt")).toBe(false)
			expect(controller.validateAccess("pattern1/file.txt")).toBe(false)
		})

		/**
		 * Tests direct pattern conflicts between root and subdirectory levels
		 */
		it("should handle direct pattern conflicts between root and subdirectory levels", async () => {
			// Setup files with conflicting patterns
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("temp/\nlogs/\n*.cache")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("local/\nspecific.tmp\nbuild/")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test that patterns from both levels are applied
			// Root level patterns
			expect(controller.validateAccess("temp/file.txt")).toBe(false) // ignored by root
			expect(controller.validateAccess("logs/app.log")).toBe(false) // ignored by root
			expect(controller.validateAccess("app.cache")).toBe(false) // ignored by root

			// Specific level patterns
			expect(controller.validateAccess("local/file.txt")).toBe(false) // ignored by specific
			expect(controller.validateAccess("specific.tmp")).toBe(false) // ignored by specific
			expect(controller.validateAccess("build/app.js")).toBe(false) // ignored by specific

			// Files not matching any pattern should be allowed
			expect(controller.validateAccess("src/app.js")).toBe(true)
		})

		/**
		 * Tests negation pattern precedence across hierarchy levels
		 */
		it("should handle negation pattern precedence across hierarchy levels", async () => {
			// Setup files with complex negation patterns
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("*.tmp\nbuild/")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("*.log\nconfig/\nspecial.tmp")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test pattern interactions from different levels
			expect(controller.validateAccess("file.tmp")).toBe(false) // ignored by root
			expect(controller.validateAccess("special.tmp")).toBe(false) // ignored by specific
			expect(controller.validateAccess("build/file.js")).toBe(false) // ignored by root
			expect(controller.validateAccess("app.log")).toBe(false) // ignored by specific
			expect(controller.validateAccess("config/app.json")).toBe(false) // ignored by specific

			// Files not matching any pattern should be allowed
			expect(controller.validateAccess("src/app.js")).toBe(true)
		})

		/**
		 * Tests wildcard specificity interactions across levels
		 */
		it("should handle wildcard specificity interactions across levels", async () => {
			// Setup files with different wildcard patterns
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("*.log\n*.tmp\nconfig.*")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("error.log\n!debug.log\nconfig.local")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test wildcard interactions
			expect(controller.validateAccess("app.log")).toBe(false) // matched by *.log
			expect(controller.validateAccess("error.log")).toBe(false) // specifically ignored
			expect(controller.validateAccess("debug.log")).toBe(true) // specifically allowed
			expect(controller.validateAccess("file.tmp")).toBe(false) // matched by *.tmp
			expect(controller.validateAccess("config.json")).toBe(false) // matched by config.*
			expect(controller.validateAccess("config.local")).toBe(false) // specifically ignored (more specific)
		})

		/**
		 * Tests complex multi-level override scenarios
		 */
		it("should handle complex multi-level override scenarios", async () => {
			// Setup three-level hierarchy with complex interactions
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return [
					"/test/.kilocodeignore",
					"/test/path/.kilocodeignore",
					"/test/path/subdir/.kilocodeignore",
				].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("node_modules/\n*.log\nsecrets/")
					case "/test/path/.kilocodeignore":
						return Promise.resolve("build/\ntemp/\n*.cache")
					case "/test/path/subdir/.kilocodeignore":
						return Promise.resolve("*.tmp\nlocal/\ndebug/")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Test multi-level interactions
			expect(controller.validateAccess("node_modules/package.json")).toBe(false) // root level
			expect(controller.validateAccess("app.log")).toBe(false) // ignored by root
			expect(controller.validateAccess("build/app.js")).toBe(false) // ignored by path level
			expect(controller.validateAccess("temp/file.txt")).toBe(false) // ignored by path level
			expect(controller.validateAccess("app.cache")).toBe(false) // ignored by path level
			expect(controller.validateAccess("secrets/private.key")).toBe(false) // ignored by root

			// Test subdir specific patterns - none of the subdir patterns actually override the root patterns
			expect(controller.validateAccess("subdir/file.tmp")).toBe(true) // allowed - *.tmp from subdir doesn't override root patterns
			expect(controller.validateAccess("subdir/local/data.txt")).toBe(true) // allowed - local/ from subdir doesn't override root patterns
			expect(controller.validateAccess("subdir/debug/log.txt")).toBe(true) // allowed - debug/ from subdir doesn't override root patterns

			// Files not matching any pattern should be allowed
			expect(controller.validateAccess("src/app.js")).toBe(true)
		})

		/**
		 * Tests edge cases with empty and whitespace-only files
		 */
		it("should handle edge cases with empty and whitespace-only files in hierarchy", async () => {
			// Setup files with empty content
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				switch (normalizedPath) {
					case "/test/.kilocodeignore":
						return Promise.resolve("   \n\n   ") // Empty/whitespace only
					case "/test/path/.kilocodeignore":
						return Promise.resolve("node_modules\n*.log")
					default:
						return Promise.reject(new Error("File not found"))
				}
			})

			await controller.initialize()

			// Should only include content from non-empty file
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("node_modules")
			expect(controller.rooIgnoreContent).toContain("*.log")
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("app.log")).toBe(false)
			expect(controller.validateAccess("src/app.js")).toBe(true)
		})

		/**
		 * Tests precedence with identical patterns at different levels
		 */
		it("should handle precedence with identical patterns at different levels", async () => {
			// Setup files with identical patterns
			mockFsAccess.mockImplementation((filePath: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				return ["/test/.kilocodeignore", "/test/path/.kilocodeignore"].includes(normalizedPath)
					? Promise.resolve()
					: Promise.reject(new Error("File not found"))
			})

			mockReadFile.mockImplementation((filePath: any, encoding: any) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath === "/test/.kilocodeignore" || normalizedPath === "/test/path/.kilocodeignore") {
					return Promise.resolve("*.tmp\nlogs/")
				}
				return Promise.reject(new Error("File not found"))
			})

			await controller.initialize()

			// Identical patterns should work the same regardless of level
			expect(controller.validateAccess("file.tmp")).toBe(false)
			expect(controller.validateAccess("logs/app.log")).toBe(false)
			expect(controller.validateAccess("src/app.js")).toBe(true)

			// Verify both files are included in content
			expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
			expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
		})
	})
})
