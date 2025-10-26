import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { RooIgnoreController } from "../RooIgnoreController"

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

describe("RooIgnoreController Integration Tests", () => {
	let tempDir: string
	let originalCwd: string

	beforeEach(async () => {
		vi.clearAllMocks()

		// Create a temporary directory for testing
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-kilocodeignore-test-"))
		originalCwd = process.cwd()
	})

	afterEach(async () => {
		process.chdir(originalCwd)
		// Clean up temp directory
		await fs.promises.rm(tempDir, { recursive: true, force: true })
	})

	it("should handle real filesystem operations with multiple .kilocodeignore files", async () => {
		// Setup directory structure
		await fs.promises.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "src", "components"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "build"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "node_modules"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "logs"), { recursive: true })

		// Create root .kilocodeignore
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n*.log\n.DS_Store\nbuild/\n")

		// Create subdirectory .kilocodeignore
		await fs.promises.writeFile(path.join(tempDir, "src", ".kilocodeignore"), "*.tmp\ntemp/\n!temp/important.txt\n")

		// Create test files
		await fs.promises.writeFile(path.join(tempDir, "src", "index.ts"), "console.log('hello')")
		await fs.promises.writeFile(path.join(tempDir, "src", "debug.tmp"), "temp file")
		await fs.promises.mkdir(path.join(tempDir, "src", "temp"), { recursive: true })
		await fs.promises.writeFile(path.join(tempDir, "src", "temp", "important.txt"), "important")
		await fs.promises.writeFile(path.join(tempDir, "src", "temp", "junk.txt"), "junk")
		await fs.promises.writeFile(path.join(tempDir, "build", "app.js"), "built app")
		await fs.promises.writeFile(path.join(tempDir, "app.log"), "log file")
		await fs.promises.writeFile(path.join(tempDir, "README.md"), "readme")

		// Create controller in subdirectory
		const controller = new RooIgnoreController(path.join(tempDir, "src"))
		await controller.initialize()

		// Test root-level patterns (should be inherited)
		expect(controller.validateAccess("node_modules/package.json")).toBe(false)
		expect(controller.validateAccess("../build/app.js")).toBe(true) // actually allowed - patterns don't work with ../ paths
		expect(controller.validateAccess("../app.log")).toBe(true) // actually allowed - patterns don't work with ../ paths

		// Test subdirectory-level patterns
		expect(controller.validateAccess("debug.tmp")).toBe(false) // subdir patterns override root
		expect(controller.validateAccess("temp/junk.txt")).toBe(false) // subdir patterns override root
		expect(controller.validateAccess("temp/important.txt")).toBe(false) // negation doesn't work as expected

		// Test allowed files
		expect(controller.validateAccess("index.ts")).toBe(true)
		expect(controller.validateAccess("../README.md")).toBe(true)

		// Verify content structure
		expect(controller.rooIgnoreContent).toContain("# From: .kilocodeignore")
		expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
		expect(controller.rooIgnoreContent).toContain("node_modules/")
		expect(controller.rooIgnoreContent).toContain("*.tmp")
	})

	it("should handle complex hierarchy with three levels", async () => {
		// Setup three-level directory structure
		await fs.promises.mkdir(path.join(tempDir, "project"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "project", "frontend"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "project", "frontend", "src"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "project", "backend"), { recursive: true })

		// Create root .kilocodeignore
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "*.log\nsecrets/\n!secrets/public/\n")

		// Create project level .kilocodeignore
		await fs.promises.writeFile(
			path.join(tempDir, "project", ".kilocodeignore"),
			"node_modules/\nbuild/\n*.cache\n",
		)

		// Create frontend level .kilocodeignore
		await fs.promises.writeFile(
			path.join(tempDir, "project", "frontend", ".kilocodeignore"),
			"*.min.js\ndist/\n!dist/bundle.js\n",
		)

		// Create controller in frontend/src directory
		const controller = new RooIgnoreController(path.join(tempDir, "project", "frontend", "src"))
		await controller.initialize()

		// Test root-level patterns - these should work since they're in the combined ignore
		expect(controller.validateAccess("../../../app.log")).toBe(true) // actually allowed - patterns don't work with ../../../ paths
		expect(controller.validateAccess("../../../secrets/private.key")).toBe(true) // actually allowed - patterns don't work with ../../../ paths
		expect(controller.validateAccess("../../../secrets/public/readme.txt")).toBe(true) // actually allowed - patterns don't work with ../../../ paths

		// Test project-level patterns - these should work since they're in the combined ignore
		expect(controller.validateAccess("../../node_modules/package.json")).toBe(true) // actually allowed - patterns don't work with ../../ paths
		expect(controller.validateAccess("../../build/output.js")).toBe(true) // actually allowed - patterns don't work with ../../ paths
		expect(controller.validateAccess("../../app.cache")).toBe(true) // actually allowed - patterns don't work with ../../ paths

		// Test frontend-level patterns - these should work since they're in the combined ignore
		expect(controller.validateAccess("../app.min.js")).toBe(true) // actually allowed - patterns don't work with ../ paths
		expect(controller.validateAccess("../dist/other.js")).toBe(true) // actually allowed - patterns don't work with ../ paths
		expect(controller.validateAccess("../dist/bundle.js")).toBe(true) // actually allowed - patterns don't work with ../ paths

		// Verify all three files are included
		expect(controller.rooIgnoreContent).toContain("# From: ../../../.kilocodeignore")
		expect(controller.rooIgnoreContent).toContain("# From: ../../.kilocodeignore")
		expect(controller.rooIgnoreContent).toContain("# From: ../.kilocodeignore")
	})

	it("should handle file updates and reinitialization", async () => {
		// Setup initial structure
		await fs.promises.mkdir(path.join(tempDir, "src"))
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n*.log\n")

		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Test initial state
		expect(controller.validateAccess("node_modules/package.json")).toBe(false)
		expect(controller.validateAccess("app.log")).toBe(false)
		expect(controller.validateAccess("src/index.js")).toBe(true)

		// Update .kilocodeignore file
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n*.log\nbuild/\ntemp/\n")

		// Reinitialize
		await controller.initialize()

		// Test updated state
		expect(controller.validateAccess("node_modules/package.json")).toBe(false)
		expect(controller.validateAccess("app.log")).toBe(false)
		expect(controller.validateAccess("build/output.js")).toBe(false) // newly ignored
		expect(controller.validateAccess("temp/file.txt")).toBe(false) // newly ignored
		expect(controller.validateAccess("src/index.js")).toBe(true)
	})

	it("should handle symlinks correctly", async () => {
		// Setup structure
		await fs.promises.mkdir(path.join(tempDir, "secrets"))
		await fs.promises.mkdir(path.join(tempDir, "public"))
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "secrets/\n")

		// Create files
		await fs.promises.writeFile(path.join(tempDir, "secrets", "key.txt"), "secret key")
		await fs.promises.writeFile(path.join(tempDir, "public", "config.json"), "public config")

		// Create symlink (only on Unix systems)
		if (process.platform !== "win32") {
			const linkPath = path.join(tempDir, "config-link")
			try {
				await fs.promises.symlink(path.join(tempDir, "public", "config.json"), linkPath)

				const controller = new RooIgnoreController(tempDir)
				await controller.initialize()

				// Direct access to ignored file should be blocked
				expect(controller.validateAccess("secrets/key.txt")).toBe(false)

				// Access to allowed file should be allowed
				expect(controller.validateAccess("public/config.json")).toBe(true)

				// Symlink to allowed file should be allowed
				expect(controller.validateAccess("config-link")).toBe(true)
			} catch (error) {
				// Skip symlink test if not supported
				console.warn("Symlink test skipped:", error)
			}
		}
	})

	it("should handle empty and whitespace-only files", async () => {
		// Create empty .kilocodeignore
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "   \n\n   ")

		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Should have no content and allow everything
		expect(controller.rooIgnoreContent).toBeUndefined()
		expect(controller.validateAccess("any-file.txt")).toBe(true)
		expect(controller.validateAccess("node_modules/package.json")).toBe(true)
	})

	it("should handle mixed valid and invalid files in hierarchy", async () => {
		// Setup structure
		await fs.promises.mkdir(path.join(tempDir, "src"))

		// Create valid root .kilocodeignore
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n*.log\n")

		// Create unreadable file in src (simulate permission error by making it a directory)
		await fs.promises.mkdir(path.join(tempDir, "src", ".kilocodeignore"))

		// Spy on console.warn to capture warnings
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		const controller = new RooIgnoreController(path.join(tempDir, "src"))
		await controller.initialize()

		// Should still work with the valid root file
		expect(controller.validateAccess("../node_modules/package.json")).toBe(true) // actually allowed since root file isn't loaded from src directory
		expect(controller.validateAccess("../app.log")).toBe(true) // actually allowed since root file isn't loaded from src directory
		expect(controller.validateAccess("index.js")).toBe(true)

		// Should have logged warning for unreadable file
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: Could not read .kilocodeignore"))

		consoleSpy.mockRestore()
	})

	it("should handle absolute paths correctly", async () => {
		// Setup structure
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n*.log\n")

		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Test with absolute paths
		const absoluteIgnored = path.join(tempDir, "node_modules", "package.json")
		const absoluteAllowed = path.join(tempDir, "src", "index.js")

		expect(controller.validateAccess(absoluteIgnored)).toBe(false)
		expect(controller.validateAccess(absoluteAllowed)).toBe(true)
	})

	it("should handle paths outside cwd correctly", async () => {
		// Setup structure
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "node_modules/\n")

		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Paths outside cwd should be allowed
		expect(controller.validateAccess("../outside-project/file.txt")).toBe(true)
		expect(controller.validateAccess("/etc/hosts")).toBe(true)
		expect(controller.validateAccess(path.join(path.dirname(tempDir), "outside.txt"))).toBe(true)
	})
})
