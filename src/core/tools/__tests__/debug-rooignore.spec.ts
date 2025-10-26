import * as path from "path"
import * as fs from "fs"
import * as fsSync from "fs"
import * as os from "os"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"

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

describe("Debug RooIgnoreController", () => {
	let tempDir: string
	let originalCwd: string

	beforeEach(async () => {
		vi.clearAllMocks()

		// Create a temporary directory for testing
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-debug-test-"))
		originalCwd = process.cwd()
	})

	afterEach(async () => {
		process.chdir(originalCwd)
		// Clean up temp directory
		await fs.promises.rm(tempDir, { recursive: true, force: true })
	})

	it("should debug RooIgnoreController behavior", async () => {
		// Create directory structure
		await fs.promises.mkdir(path.join(tempDir, "build"), { recursive: true })
		await fs.promises.mkdir(path.join(tempDir, "src"), { recursive: true })

		// Create files
		await fs.promises.mkdir(path.join(tempDir, "node_modules"), { recursive: true })
		await fs.promises.writeFile(path.join(tempDir, "build/app.js"), "console.log('app')")
		await fs.promises.writeFile(path.join(tempDir, "src/index.ts"), "export function main() {}")
		await fs.promises.writeFile(path.join(tempDir, "node_modules/package.json"), '{"name": "test"}')

		// Create .kilocodeignore file
		await fs.promises.writeFile(path.join(tempDir, ".kilocodeignore"), "build/\nnode_modules/")

		// Create and initialize controller
		const controller = new RooIgnoreController(tempDir)
		await controller.initialize()

		// Debug the ignore library directly
		const ignore = require("ignore")
		const ignoreInstance = ignore()
		ignoreInstance.add("build/")
		ignoreInstance.add("node_modules/")

		console.log("Direct ignore library test:")
		console.log("ignoreInstance.ignores('build/app.js'):", ignoreInstance.ignores("build/app.js"))
		console.log(
			"ignoreInstance.ignores('node_modules/package.json'):",
			ignoreInstance.ignores("node_modules/package.json"),
		)
		console.log("ignoreInstance.ignores('src/index.ts'):", ignoreInstance.ignores("src/index.ts"))

		// Debug information
		const ignoreFilePath = path.join(tempDir, ".kilocodeignore")
		const debugInfo = {
			tempDir,
			rooIgnoreContent: controller.rooIgnoreContent,
			rooIgnoreContentExists: !!controller.rooIgnoreContent,
			validateAccessBuild: controller.validateAccess("build/app.js"),
			validateAccessNodeModules: controller.validateAccess("node_modules/package.json"),
			validateAccessSrc: controller.validateAccess("src/index.ts"),
			ignoreFileExists: fsSync.existsSync(ignoreFilePath),
			ignoreFileContent: fsSync.existsSync(ignoreFilePath)
				? fsSync.readFileSync(ignoreFilePath, "utf8")
				: "FILE_NOT_FOUND",
		}

		// Test RooIgnoreController validateAccess method
		const buildAccess = controller.validateAccess("build/app.js")
		const nodeModulesAccess = controller.validateAccess("node_modules/package.json")
		const srcAccess = controller.validateAccess("src/index.ts")

		// Debug the validateAccess method step by step

		console.log("=== validateAccess DEBUG ===")

		// Test build/app.js step by step
		const buildAbsolutePath = path.resolve(tempDir, "build/app.js")
		console.log("buildAbsolutePath:", buildAbsolutePath)

		let buildRealPath: string
		try {
			buildRealPath = fsSync.realpathSync(buildAbsolutePath)
			console.log("buildRealPath:", buildRealPath)
		} catch (e) {
			buildRealPath = buildAbsolutePath
			console.log("buildRealPath (fallback):", buildRealPath)
		}

		const buildRelativePath = path.relative(tempDir, buildRealPath).toPosix()
		console.log("buildRelativePath:", buildRelativePath)

		// Test what the correct relative path should be
		const correctRelativePath = "build/app.js"
		console.log("correctRelativePath:", correctRelativePath)
		console.log(
			"ignoreInstance.ignores(correctRelativePath):",
			controller["ignoreInstance"].ignores(correctRelativePath),
		)
		console.log(
			"!ignoreInstance.ignores(correctRelativePath):",
			!controller["ignoreInstance"].ignores(correctRelativePath),
		)

		// Test the actual validateAccess method which should now work correctly
		console.log("controller.validateAccess('build/app.js'):", controller.validateAccess("build/app.js"))
		console.log(
			"controller.validateAccess('node_modules/package.json'):",
			controller.validateAccess("node_modules/package.json"),
		)
		console.log("controller.validateAccess('src/index.ts'):", controller.validateAccess("src/index.ts"))

		console.log("=== END DEBUG ===")

		console.log("DEBUG INFO:", JSON.stringify(debugInfo, null, 2))

		expect(buildAccess).toBe(false)
		expect(nodeModulesAccess).toBe(false)
		expect(srcAccess).toBe(true)
	})
})
