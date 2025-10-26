import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
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

describe("Debug Hierarchical Functionality", () => {
	let tempDir: string

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(process.cwd(), "test-hierarchical-"))
	})

	afterEach(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	test("debug hierarchical ignore file discovery", async () => {
		// Create directory structure and files
		await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "build"), { recursive: true })
		await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\ntemp/")
		await fs.writeFile(path.join(tempDir, "secret", ".kilocodeignore"), "*")

		// Test 1: Create controller in root directory
		console.log("\n=== Test 1: Controller in root directory ===")
		const rootController = new RooIgnoreController(tempDir)
		await rootController.initialize()

		// Test what files it finds
		const rootIgnoreFiles = (rootController as any).ignoreFiles
		console.log("Root controller ignore files:", rootIgnoreFiles)

		// Test validation from root
		const rootBuildAccess = rootController.validateAccess("build/app.js")
		const rootSecretAccess = rootController.validateAccess("secret/key.txt")
		console.log("Root controller - build/app.js access:", rootBuildAccess)
		console.log("Root controller - secret/key.txt access:", rootSecretAccess)

		// rootController.dispose() // Skip dispose to avoid mock issues

		// Test 2: Create controller in secret directory
		console.log("\n=== Test 2: Controller in secret directory ===")
		const secretController = new RooIgnoreController(path.join(tempDir, "secret"))
		await secretController.initialize()

		// Test what files it finds
		const secretIgnoreFiles = (secretController as any).ignoreFiles
		console.log("Secret controller ignore files:", secretIgnoreFiles)

		// Test validation from secret directory
		const secretBuildAccess = secretController.validateAccess("../build/app.js")
		const secretSecretAccess = secretController.validateAccess("key.txt")
		console.log("Secret controller - ../build/app.js access:", secretBuildAccess)
		console.log("Secret controller - key.txt access:", secretSecretAccess)

		// secretController.dispose() // Skip dispose to avoid mock issues

		// Test expectations
		expect(rootBuildAccess).toBe(false) // Should be blocked by root .kilocodeignore
		expect(rootSecretAccess).toBe(true) // Should be allowed (no pattern blocks it)

		expect(secretSecretAccess).toBe(false) // Should be blocked by secret/.kilocodeignore
		expect(secretBuildAccess).toBe(true) // Should be allowed because ../build from secret doesn't match build/ pattern
	})
})
