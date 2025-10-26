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

describe("Debug Find Files", () => {
	let tempDir: string

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(process.cwd(), "test-find-files-"))
	})

	afterEach(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	test("debug findKilocodeIgnoreFiles method", async () => {
		// Create directory structure and files
		await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })
		await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\ntemp/")
		await fs.writeFile(path.join(tempDir, "secret", ".kilocodeignore"), "*")

		// Test 1: Controller in root directory
		console.log("\n=== Test 1: Controller in root directory ===")
		const rootController = new RooIgnoreController(tempDir)
		await rootController.initialize()

		// Check if files exist
		const rootIgnoreExists = await fs
			.access(path.join(tempDir, ".kilocodeignore"))
			.then(() => true)
			.catch(() => false)
		const secretIgnoreExists = await fs
			.access(path.join(tempDir, "secret", ".kilocodeignore"))
			.then(() => true)
			.catch(() => false)
		console.log("Root .kilocodeignore exists:", rootIgnoreExists)
		console.log("Secret .kilocodeignore exists:", secretIgnoreExists)

		// Check rooIgnoreContent to see if patterns were loaded
		console.log("Root controller rooIgnoreContent:", rootController.rooIgnoreContent ? "loaded" : "undefined")

		// Test 2: Controller in secret directory
		console.log("\n=== Test 2: Controller in secret directory ===")
		const secretController = new RooIgnoreController(path.join(tempDir, "secret"))
		await secretController.initialize()

		// Check rooIgnoreContent to see if patterns were loaded
		console.log("Secret controller rooIgnoreContent:", secretController.rooIgnoreContent ? "loaded" : "undefined")

		// Test expectations
		console.log("\n=== Analysis ===")
		console.log("Root controller should have rooIgnoreContent:", !!rootController.rooIgnoreContent)
		console.log("Secret controller should have rooIgnoreContent:", !!secretController.rooIgnoreContent)

		expect(rootController.rooIgnoreContent).toBeDefined() // Should load root .kilocodeignore
		expect(secretController.rooIgnoreContent).toBeDefined() // Should load both files

		// Test validation
		const rootBuildAccess = rootController.validateAccess("build/app.js")
		const secretBuildAccess = secretController.validateAccess("../build/app.js")

		console.log("\n=== Validation Results ===")
		console.log("Root controller - build/app.js access:", rootBuildAccess)
		console.log("Secret controller - ../build/app.js access:", secretBuildAccess)

		expect(rootBuildAccess, `Root controller should block build/app.js but got ${rootBuildAccess}`).toBe(false) // Should be blocked by root .kilocodeignore
		expect(secretBuildAccess, `Secret controller should allow ../build/app.js but got ${secretBuildAccess}`).toBe(
			true,
		) // Should be allowed because ../build/app.js from secret dir doesn't match build/ pattern
	})
})
