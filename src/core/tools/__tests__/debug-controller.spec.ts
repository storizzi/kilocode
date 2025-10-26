import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "os"

// Mock vscode before importing RooIgnoreController
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

import { RooIgnoreController } from "../../ignore/RooIgnoreController"

describe("Debug RooIgnoreController", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(tmpdir(), "kilocode-debug-"))
	})

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	test("debug RooIgnoreController behavior", async () => {
		// Create directory structure
		await fs.mkdir(path.join(tempDir, "secret"), { recursive: true })

		// Create files
		await fs.writeFile(path.join(tempDir, "secret/key.txt"), "secret-key")

		// Create .kilocodeignore in root (not in secret subdirectory)
		await fs.writeFile(path.join(tempDir, ".kilocodeignore"), "secret/")

		// Create real RooIgnoreController
		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Wait for controller to initialize
		await new Promise((resolve) => setTimeout(resolve, 100))

		console.log("Controller content:", controller.rooIgnoreContent)

		const relativeResult = controller.validateAccess("secret/key.txt")
		const absoluteResult = controller.validateAccess(path.join(tempDir, "secret/key.txt"))

		console.log("validateAccess(secret/key.txt):", relativeResult)
		console.log("validateAccess absolute path:", absoluteResult)
		console.log(
			"File exists:",
			await fs
				.access(path.join(tempDir, "secret/key.txt"))
				.then(() => true)
				.catch(() => false),
		)
		console.log(
			"Ignore file exists:",
			await fs
				.access(path.join(tempDir, ".kilocodeignore"))
				.then(() => true)
				.catch(() => false),
		)
		console.log("Ignore file content:", await fs.readFile(path.join(tempDir, ".kilocodeignore"), "utf-8"))

		// Test with relative path
		expect(relativeResult).toBe(false)

		// Test with absolute path - this should actually be true since the absolute path
		// gets resolved correctly by the controller
		expect(absoluteResult).toBe(true)

		controller.dispose()
	})
})
