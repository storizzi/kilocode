// Debug test to understand DirectoryScanner behavior with RooIgnoreController

import { DirectoryScanner } from "../processors/scanner"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { CacheManager } from "../cache-manager"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// Mock TelemetryService
vi.mock("../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn().mockResolvedValue("mock file content"),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	access: vi.fn(),
	rename: vi.fn(),
	constants: {},
	stat: vi.fn().mockResolvedValue({
		size: 1024,
		isFile: () => true,
		isDirectory: () => false,
	}),
}))

// Mock vscode
vi.mock("vscode", () => ({
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
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			onDidChange: vi.fn(),
			dispose: vi.fn(),
		}),
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
}))

// Mock listFiles
vi.mock("../../glob/list-files", () => ({
	listFiles: vi.fn(),
}))

describe("Debug DirectoryScanner with RooIgnoreController", () => {
	let testWorkspace: string
	let mockCacheManager: CacheManager
	let mockEmbedder: any
	let mockVectorStore: any
	let mockCodeParser: any
	let mockIgnoreInstance: any

	beforeEach(async () => {
		testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "debug-test-"))

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
			embedderInfo: { name: "mock-embedder", dimensions: 384 },
		}
		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
			initialize: vi.fn().mockResolvedValue(true),
			search: vi.fn().mockResolvedValue([]),
			clearCollection: vi.fn().mockResolvedValue(undefined),
			deleteCollection: vi.fn().mockResolvedValue(undefined),
			collectionExists: vi.fn().mockResolvedValue(true),
		}
		mockCodeParser = {
			parseFile: vi.fn().mockResolvedValue([]),
		}

		const mockContext = {
			globalStorageUri: {
				fsPath: testWorkspace,
			},
		} as any
		mockCacheManager = new CacheManager(mockContext, testWorkspace) as any
		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false), // Don't filter anything
		}

		await mockCacheManager.initialize()
	})

	afterEach(async () => {
		if (fs.existsSync(testWorkspace)) {
			fs.rmSync(testWorkspace, { recursive: true, force: true })
		}
	})

	it("should debug RooIgnoreController behavior", async () => {
		const testDir = path.join(testWorkspace, "debug-test")
		fs.mkdirSync(testDir, { recursive: true })

		// Create .kilocodeignore that should ignore .js files
		fs.writeFileSync(path.join(testDir, ".kilocodeignore"), "*.js\n!allowed.js")

		// Test RooIgnoreController directly
		const ignoreController = new RooIgnoreController(testDir)
		await ignoreController.initialize()

		console.log("=== RooIgnoreController Test ===")
		console.log("Should ignore test.js:", !ignoreController.validateAccess(path.join(testDir, "test.js")))
		console.log("Should allow allowed.js:", ignoreController.validateAccess(path.join(testDir, "allowed.js")))
		console.log("Should allow config.json:", ignoreController.validateAccess(path.join(testDir, "config.json")))

		// Test filterPaths
		const testPaths = [
			path.join(testDir, "test.js"),
			path.join(testDir, "allowed.js"),
			path.join(testDir, "config.json"),
		]
		const filteredPaths = ignoreController.filterPaths(testPaths)
		console.log(
			"Filtered paths:",
			filteredPaths.map((p) => path.basename(p)),
		)

		// Test with DirectoryScanner
		const listFilesModule = await import("../../glob/list-files")
		vi.mocked(listFilesModule.listFiles).mockResolvedValue([
			["debug-test/test.js", "debug-test/allowed.js", "debug-test/config.json"],
			false,
		])

		const processedFiles: string[] = []
		;(mockCodeParser.parseFile as any).mockImplementation((filePath: string) => {
			processedFiles.push(filePath)
			return []
		})

		const scanner = new DirectoryScanner(
			mockEmbedder,
			mockVectorStore,
			mockCodeParser,
			mockCacheManager,
			mockIgnoreInstance,
		)

		const result = await scanner.scanDirectory(testDir)

		// Debug output
		console.log("=== DirectoryScanner Test ===")
		console.log("Processed files count:", processedFiles.length)
		if (processedFiles.length > 0) {
			console.log(
				"Processed files:",
				processedFiles.map((p) => path.basename(p)),
			)
		}
		console.log("Stats:", result.stats)

		// Let's also check what files are being returned by listFiles
		const mockCalls = vi.mocked(listFilesModule.listFiles).mock.calls
		console.log("Mock calls to listFiles:", mockCalls.length)
		if (mockCalls.length > 0) {
			console.log("First call args:", mockCalls[0])
		}

		// The DirectoryScanner should respect RooIgnoreController filtering
		expect(processedFiles.length).toBeGreaterThan(0)
		// The DirectoryScanner in this test doesn't actually use RooIgnoreController
		// It uses the mockIgnoreInstance that allows everything
		expect(processedFiles.length).toBeGreaterThan(0)
		// We can't test specific filtering here since the mock ignores everything
	})
})
