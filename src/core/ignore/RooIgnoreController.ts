import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"
import "../../utils/path" // Import to enable String.prototype.toPosix()

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .kilocodeignore files.
 * Supports multiple .kilocodeignore files in subdirectories with hierarchical precedence.
 */
export class RooIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	rooIgnoreContent: string | undefined
	private reloadTimeout: NodeJS.Timeout | undefined
	private readonly reloadDebounceMs = 300

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.rooIgnoreContent = undefined
		// Set up file watcher for .kilocodeignore files
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadRooIgnore()
	}

	/**
	 * Set up the file watcher for .kilocodeignore changes in any subdirectory
	 */
	private setupFileWatcher(): void {
		// Use recursive pattern to watch for .kilocodeignore files in any subdirectory
		const rooignorePattern = new vscode.RelativePattern(this.cwd, "**/.kilocodeignore")
		const fileWatcher = vscode.workspace.createFileSystemWatcher(rooignorePattern)

		// Watch for changes and updates with debounced reloads to prevent race conditions
		this.disposables.push(
			fileWatcher.onDidChange(() => {
				this.debouncedReload()
			}),
			fileWatcher.onDidCreate(() => {
				this.debouncedReload()
			}),
			fileWatcher.onDidDelete(() => {
				this.debouncedReload()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Debounced reload to prevent race conditions when multiple files change rapidly
	 */
	private debouncedReload(): void {
		if (this.reloadTimeout) {
			clearTimeout(this.reloadTimeout)
		}
		this.reloadTimeout = setTimeout(() => {
			this.loadRooIgnore()
		}, this.reloadDebounceMs)
	}

	/**
	 * Find all .kilocodeignore files from the target directory up to the workspace root
	 * @param targetPath - Starting directory path
	 * @returns Array of .kilocodeignore file paths in order from root to most specific
	 */
	private async findKilocodeIgnoreFiles(targetPath: string): Promise<string[]> {
		const kilocodeIgnoreFiles: string[] = []
		let currentPath = path.resolve(targetPath)

		// Walk up the directory tree looking for .kilocodeignore files
		while (currentPath && currentPath !== path.dirname(currentPath)) {
			const kilocodeIgnorePath = path.join(currentPath, ".kilocodeignore")

			try {
				await fs.access(kilocodeIgnorePath)
				kilocodeIgnoreFiles.push(kilocodeIgnorePath)
			} catch {
				// .kilocodeignore doesn't exist at this level, continue
			}

			// Move up one directory
			currentPath = path.dirname(currentPath)
		}

		// Return in reverse order (root .kilocodeignore first, then more specific ones)
		return kilocodeIgnoreFiles.reverse()
	}

	/**
	 * Load custom patterns from all .kilocodeignore files in the directory tree
	 * Enhanced error handling continues loading other files if one fails
	 */
	private async loadRooIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			const combinedContent: string[] = []

			// Find all .kilocodeignore files from workspace root
			const kilocodeIgnoreFiles = await this.findKilocodeIgnoreFiles(this.cwd)

			if (kilocodeIgnoreFiles.length === 0) {
				this.rooIgnoreContent = undefined
				return
			}

			// Load content from all files, continuing even if some fail
			for (const filePath of kilocodeIgnoreFiles) {
				try {
					const content = await fs.readFile(filePath, "utf8")
					if (content.trim()) {
						// Add file path as comment for debugging
						const relativePath = path.relative(this.cwd, filePath)
						combinedContent.push(`# From: ${relativePath}`)
						combinedContent.push(content)
					}
				} catch (error) {
					// Enhanced error handling: continue loading other files if one fails
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.warn(`Warning: Could not read .kilocodeignore at ${filePath}: ${errorMessage}`)
					// Continue with next file instead of failing completely
				}
			}

			// Set combined content and add to ignore instance
			if (combinedContent.length > 0) {
				this.rooIgnoreContent = combinedContent.join("\n")
				this.ignoreInstance.add(this.rooIgnoreContent)
				// Always ignore all .kilocodeignore files themselves
				this.ignoreInstance.add("**/.kilocodeignore")
			} else {
				this.rooIgnoreContent = undefined
			}
		} catch (error) {
			// Should never happen: but if it does, fail closed for security
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`Unexpected error loading .kilocodeignore files: ${errorMessage}`)
			this.rooIgnoreContent = undefined
			this.ignoreInstance = ignore()
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * Automatically resolves symlinks
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if .kilocodeignore does not exist
		if (!this.rooIgnoreContent) {
			return true
		}
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Follow symlinks to get the real path
			let realPath: string
			try {
				realPath = fsSync.realpathSync(absolutePath)
			} catch {
				// If realpath fails (file doesn't exist, broken symlink, etc.),
				// use the original path
				realPath = absolutePath
			}

			// Convert real path to relative for .rooignore checking
			let relativePath = path.relative(this.cwd, realPath).toPosix()

			// Handle case where realpath creates paths that escape the directory
			// This can happen on macOS where /var is symlinked to /private/var
			if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
				// Fall back to the original file path which should be relative
				relativePath = filePath.toPosix()
			}

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// Allow access to files outside cwd or on errors (backward compatibility)
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no .kilocodeignore exists
		if (!this.rooIgnoreContent) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Get formatted instructions about the .kilocodeignore files for the LLM
	 * @returns Formatted instructions or undefined if no .kilocodeignore files exist
	 */
	getInstructions(): string | undefined {
		if (!this.rooIgnoreContent) {
			return undefined
		}

		return `# .kilocodeignore\n\n(The following is provided by one or more .kilocodeignore files where the user has specified files and directories that should not be accessed. Multiple files are merged with hierarchical precedence - more specific directories override parent patterns. When using list_files, you'll notice a ${LOCK_TEXT_SYMBOL} next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n${this.rooIgnoreContent}\n**/.kilocodeignore`
	}
}
