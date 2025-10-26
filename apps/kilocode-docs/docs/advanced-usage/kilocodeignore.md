# .kilocodeignore

The `.kilocodeignore` file provides powerful control over which files and directories the Kilo Code AI can access in your project. With hierarchical support, you can now create multiple `.kilocodeignore` files in different subdirectories to create fine-grained access control patterns that scale with complex project structures.

## Overview

`.kilocodeignore` files use Gitignore-style patterns to specify files and directories that should be inaccessible to the AI. This provides a crucial security layer that protects sensitive data, prevents accidental modifications to critical files, and helps the AI focus on relevant code.

### Key Benefits

- **Security**: Prevents AI access to sensitive files like API keys, credentials, and private data
- **Focus**: Helps the AI concentrate on relevant source code by ignoring build artifacts and dependencies
- **Control**: Provides granular control over what the AI can read, modify, or execute commands against
- **Scalability**: Hierarchical support allows different ignore rules for different parts of your project

## Basic Usage

### Single File Usage (Backward Compatible)

For simple projects, you can use a single `.kilocodeignore` file at your project root:

```gitignore
# Dependencies
node_modules/
vendor/
bower_components/

# Build outputs
dist/
build/
out/
*.tgz

# Environment files
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Sensitive data
secrets/
private-keys/
*.pem
*.key
```

Place this file in your project root, and Kilo Code will automatically apply these rules to all AI interactions.

## Hierarchical Behavior

### NEW: Multi-File Subdirectory Support

The enhanced `.kilocodeignore` system now supports multiple files throughout your directory structure. This enables sophisticated access control patterns for complex projects like monorepos, multi-level applications, and projects with different security requirements per module.

#### How Hierarchy Works

The system searches for `.kilocodeignore` files by walking up the directory tree from the target file location:

1. **Start** at the target file's directory
2. **Walk up** through parent directories to the workspace root
3. **Combine** all found patterns with hierarchical precedence
4. **Apply** rules with more specific directories taking precedence

#### Precedence Rules

- **Root-level patterns** apply to all files in the project
- **Subdirectory patterns** can override or add to root-level patterns
- **More specific patterns** (deeper in the directory tree) take precedence
- **Files are processed** in order from root to most specific

### Monorepo Example

Consider a monorepo with different security requirements per package:

```
project-root/
├── .kilocodeignore                 # Root-level rules
├── packages/
│   ├── frontend/
│   │   ├── .kilocodeignore         # Frontend-specific rules
│   │   └── src/
│   ├── backend/
│   │   ├── .kilocodeignore         # Backend-specific rules
│   │   └── src/
│   └── shared/
│       └── src/
└── docs/
    ├── .kilocodeignore             # Documentation-specific rules
    └── content/
```

**Root `.kilocodeignore`:**

```gitignore
# Global ignores for entire monorepo
node_modules/
.git/
*.log
.DS_Store

# Common build artifacts
dist/
build/
coverage/

# Temporary files
*.tmp
*.cache
```

**Frontend `.kilocodeignore`:**

```gitignore
# Frontend-specific ignores
public/assets/
*.min.js
*.min.css

# Allow access to source maps for debugging
!*.js.map
!*.css.map

# Ignore large bundle files
*.bundle.js
```

**Backend `.kilocodeignore`:**

```gitignore
# Backend-specific ignores
database/
*.db
*.sqlite

# Sensitive backend files
secrets/
ssl-certs/
*.pem
*.key

# Log files
logs/
*.log
```

**Documentation `.kilocodeignore`:**

```gitignore
# Documentation-specific ignores
_drafts/
_private/
*.draft.md

# Build outputs
_build/
.site/
```

### Frontend/Backend Separation Example

For projects with distinct frontend and backend directories:

```
my-app/
├── .kilocodeignore                 # Shared rules
├── frontend/
│   ├── .kilocodeignore             # Frontend rules
│   ├── public/
│   └── src/
├── backend/
│   ├── .kilocodeignore             # Backend rules
│   ├── migrations/
│   └── src/
└── shared/
    └── src/
```

**Shared `.kilocodeignore`:**

```gitignore
# Common ignores for all parts
node_modules/
.git/
*.log
.DS_Store
```

**Frontend `.kilocodeignore`:**

```gitignore
# Frontend build artifacts
dist/
build/
*.bundle.js
*.chunk.js

# Allow source maps for debugging
!*.map

# Ignore large assets
public/videos/
public/images/large/
```

**Backend `.kilocodeignore`:**

```gitignore
# Backend data files
database/
*.db
*.sqlite

# Sensitive configuration
config/production.json
.env.production

# SSL certificates
ssl/
*.pem
*.crt
*.key
```

## Pattern Syntax

`.kilocodeignore` files use the same pattern syntax as `.gitignore` files:

### Basic Patterns

```gitignore
# Ignore specific files
config.json
secrets.txt

# Ignore file extensions
*.log
*.tmp
*.key

# Ignore directories
node_modules/
build/
logs/

# Ignore all files in a directory
secrets/*
```

### Wildcard Patterns

```gitignore
# Wildcard matching
*.log              # All .log files
test_*             # Files starting with "test_"
**/temp            # Any directory named "temp"
```

### Negation Patterns

```gitignore
# Ignore all logs, but allow debug.log
*.log
!debug.log

# Ignore node_modules, but allow specific package
node_modules/
!node_modules/important-package/
```

### Directory-Specific Patterns

```gitignore
# Only ignore in root directory
/config

# Ignore anywhere in project
**/config

# Ignore at specific depth
*/config/
*/*/config/
```

### Advanced Patterns

```gitignore
# Complex patterns
src/**/*.test.js          # All test files in src
docs/**/_*                # Files starting with underscore in docs
!docs/**/_index.md        # Except index files
```

## Security Model

### How .kilocodeignore Protects Your Files

The `.kilocodeignore` system provides multiple layers of security:

#### 1. File Access Control

- **Read Operations**: AI cannot read files matching ignore patterns
- **Write Operations**: AI cannot modify ignored files
- **Command Validation**: Terminal commands accessing ignored files are blocked

#### 2. Symlink Protection

The system automatically resolves symlinks and blocks access if the target file is ignored:

```gitignore
# If config.json is ignored, symlinks to it are also blocked
secrets/config.json
```

#### 3. Command-Level Protection

The system validates terminal commands to prevent indirect access:

```bash
# These commands will be blocked if target files are ignored
cat secrets/api-keys.txt
grep -r "password" config/
less private-data.json
```

#### 4. Fail-Safe Behavior

- **Missing Files**: If no `.kilocodeignore` exists, all files are accessible
- **Parse Errors**: Invalid patterns are logged but don't break the system
- **File Read Errors**: System continues loading other ignore files if one fails

### Security Best Practices

1. **Layer Security**: Use multiple `.kilocodeignore` files for defense in depth
2. **Specific Patterns**: Be specific about what to ignore rather than using broad patterns
3. **Regular Audits**: Review ignore patterns when adding new sensitive files
4. **Team Coordination**: Ensure team members understand the ignore rules

## Performance Considerations

### Optimization Tips for Large Projects

#### 1. Efficient Pattern Design

```gitignore
# Good: Specific patterns
node_modules/
dist/
build/
*.log

# Avoid: Overly broad patterns
*               # Too broad, impacts performance
**/*            # Redundant, impacts performance
```

#### 2. Hierarchical Organization

- **Root Level**: Keep common patterns at root to avoid duplication
- **Subdirectories**: Use specific patterns only where needed
- **Depth Limit**: Avoid very deep directory structures with many ignore files

#### 3. Pattern Ordering

```gitignore
# Put frequently matched patterns first
node_modules/
dist/
build/

# Less common patterns later
*.tmp
*.cache
.DS_Store
```

#### 4. File Size Management

- **Keep Files Small**: Split large ignore lists into multiple files
- **Avoid Comments**: Minimize comments in very large projects
- **Use Wildcards**: Use patterns instead of listing many individual files

### Performance Monitoring

The system includes built-in optimizations:

- **Debounced Reloading**: Prevents excessive reloads during file changes
- **Pattern Caching**: Caches compiled patterns for faster matching
- **Early Termination**: Stops pattern matching on first match

## Migration Guide

### From Single-File to Multi-File Setup

#### Step 1: Analyze Current Setup

Review your existing `.kilocodeignore` file:

```gitignore
# Current single file
node_modules/
dist/
build/
*.log
secrets/
config/production.json
```

#### Step 2: Identify Logical Groups

Group patterns by directory or purpose:

```gitignore
# Build artifacts (global)
node_modules/
dist/
build/

# Logs (global)
*.log

# Sensitive data (backend only)
secrets/
config/production.json
```

#### Step 3: Create Hierarchical Structure

```
project/
├── .kilocodeignore              # Global patterns
├── backend/
│   ├── .kilocodeignore          # Backend-specific
│   └── src/
├── frontend/
│   └── src/
└── shared/
    └── src/
```

**Root `.kilocodeignore`:**

```gitignore
# Global patterns
node_modules/
dist/
build/
*.log
.DS_Store
```

**Backend `.kilocodeignore`:**

```gitignore
# Backend-specific patterns
secrets/
config/production.json
database/
*.db
```

#### Step 4: Test Migration

1. **Verify Access**: Test that AI can still access needed files
2. **Check Blocking**: Confirm sensitive files are properly blocked
3. **Validate Commands**: Ensure terminal commands are properly validated

### Backward Compatibility

The hierarchical system is fully backward compatible:

- **Single Files**: Existing single `.kilocodeignore` files continue to work
- **No Changes Required**: Existing projects work without modification
- **Gradual Migration**: You can add hierarchical files incrementally

## Troubleshooting

### Common Issues and Solutions

#### 1. Files Not Being Ignored

**Problem**: Files matching patterns are still accessible.

**Solution**: Check the following:

- Verify file paths are relative to the `.kilocodeignore` file location
- Ensure patterns use forward slashes (even on Windows)
- Check for conflicting negation patterns (`!pattern`)

```gitignore
# Correct
node_modules/
secrets/config.json

# Incorrect (backslashes)
node_modules\
secrets\config.json
```

#### 2. Too Many Files Ignored

**Problem**: Important files are being blocked.

**Solution**: Review pattern specificity:

- Use more specific patterns instead of broad wildcards
- Add negation patterns for exceptions
- Check for unintended wildcard matches

```gitignore
# Too broad
config/

# Better
config/production.json
config/secrets/
!config/development.json
```

#### 3. Performance Issues

**Problem**: Slow response times with many ignore files.

**Solution**: Optimize your setup:

- Consolidate similar patterns
- Remove redundant patterns
- Use efficient wildcards

```gitignore
# Inefficient
file1.js
file2.js
file3.js
# ... many more files

# Efficient
*.js
!important-file.js
```

#### 4. Conflicting Patterns

**Problem**: Patterns from different levels conflict.

**Solution**: Understand precedence:

- More specific directories override parent patterns
- Later patterns in the same file override earlier ones
- Use negation patterns carefully

```gitignore
# Root .kilocodeignore
*.log

# Subdirectory .kilocodeignore
!debug.log    # This overrides the root pattern
```

### Debugging Tools

#### 1. Check Pattern Loading

The system logs which files are loaded:

```
# From: .kilocodeignore
node_modules/
*.log

# From: backend/.kilocodeignore
secrets/
config/production.json
```

#### 2. Validate Access

Test specific files to see if they're accessible:

- Use the `list_files` tool with `showKiloCodeIgnored` enabled
- Look for the lock symbol (🔒) next to ignored files
- Check error messages when accessing blocked files

#### 3. Command Validation

Test terminal commands to ensure proper blocking:

```bash
# These should be blocked if files are ignored
cat secrets/api-keys.txt
grep -r "password" config/
```

## Practical Examples

### Example 1: E-commerce Platform

```
ecommerce-platform/
├── .kilocodeignore                 # Global rules
├── frontend/
│   ├── .kilocodeignore             # Frontend rules
│   └── src/
├── backend/
│   ├── .kilocodeignore             # Backend rules
│   └── src/
├── admin/
│   ├── .kilocodeignore             # Admin panel rules
│   └── src/
└── infrastructure/
    ├── .kilocodeignore             # Infrastructure rules
    └── terraform/
```

**Root `.kilocodeignore`:**

```gitignore
# Global ignores
node_modules/
.git/
*.log
.DS_Store
coverage/

# Common build artifacts
dist/
build/
out/
```

**Frontend `.kilocodeignore`:**

```gitignore
# Frontend-specific
public/assets/
*.bundle.js
*.chunk.js

# Allow source maps for debugging
!*.map

# Ignore large media files
public/videos/
public/images/large/
```

**Backend `.kilocodeignore`:**

```gitignore
# Backend-specific
database/
*.db
*.sqlite

# Payment processing
payment-gateway/
stripe-keys/
paypal-config/

# User data
user-data/
personal-information/
```

**Admin `.kilocodeignore`:**

```gitignore
# Admin panel specific
admin-logs/
audit-trails/
user-reports/

# Sensitive admin features
user-management/
billing-admin/
system-config/
```

**Infrastructure `.kilocodeignore`:**

```gitignore
# Infrastructure as code
terraform/.terraform/
terraform/*.tfstate
terraform/*.tfstate.backup

# Cloud credentials
aws-credentials/
azure-config/
gcp-keys/
```

### Example 2: Multi-Level Project

```
multi-level-app/
├── .kilocodeignore                 # Root level
├── level1/
│   ├── .kilocodeignore             # Level 1 rules
│   ├── level2/
│   │   ├── .kilocodeignore         # Level 2 rules
│   │   └── level3/
│   │       ├── .kilocodeignore     # Level 3 rules
│   │       └── sensitive-data/
│   └── public/
└── shared/
    └── utils/
```

**Root `.kilocodeignore`:**

```gitignore
# Root level - global patterns
node_modules/
.git/
*.log
.DS_Store
```

**Level 1 `.kilocodeignore`:**

```gitignore
# Level 1 - project-wide patterns
build/
dist/
coverage/
*.tmp
```

**Level 2 `.kilocodeignore`:**

```gitignore
# Level 2 - module-specific patterns
local-config/
module-cache/
*.module.log
```

**Level 3 `.kilocodeignore`:**

```gitignore
# Level 3 - highly sensitive data
sensitive-data/
*.secret
*.key
*.pem
```

### Example 3: Performance Optimization

For large codebases, optimize for performance:

```
large-project/
├── .kilocodeignore                 # Minimal root patterns
├── packages/
│   ├── package-a/
│   │   └── .kilocodeignore         # Package-specific
│   ├── package-b/
│   │   └── .kilocodeignore         # Package-specific
│   └── shared/
│       └── .kilocodeignore         # Shared patterns
└── tools/
    └── .kilocodeignore             # Tool-specific
```

**Root `.kilocodeignore` (minimal):**

```gitignore
# Only essential global patterns
node_modules/
.git/
.DS_Store
```

**Package-specific `.kilocodeignore`:**

```gitignore
# Package-specific build artifacts
dist/
build/
coverage/

# Package-specific logs
*.log
```

**Shared `.kilocodeignore`:**

```gitignore
# Shared component patterns
*.bundle.js
*.chunk.js
```

## Integration with Other Features

### Checkpoints

`.kilocodeignore` works alongside the checkpoint system:

- **Separate Concerns**: `.kilocodeignore` controls AI access, checkpoints track changes
- **Independent Operation**: Files ignored by `.kilocodeignore` are still checkpointed
- **Recovery Support**: You can restore changes to ignored files through checkpoints

### Custom Rules

`.kilocodeignore` complements custom rules:

- **Access Control**: `.kilocodeignore` controls file access
- **Behavior Control**: Custom rules control AI behavior
- **Combined Security**: Use both for comprehensive protection

### Codebase Indexing

The indexing system respects `.kilocodeignore` patterns:

- **Search Scope**: Ignored files are excluded from search results
- **Index Size**: Reduces index size by excluding irrelevant files
- **Performance**: Improves search performance

## Best Practices

### 1. Security First

- **Default Deny**: Start with restrictive patterns, then add exceptions
- **Sensitive Data**: Always ignore files containing secrets, keys, or personal data
- **Regular Reviews**: Periodically review and update ignore patterns

### 2. Performance Optimization

- **Specific Patterns**: Use specific patterns rather than broad wildcards
- **Hierarchical Organization**: Place patterns at the appropriate level
- **Avoid Redundancy**: Don't repeat patterns in multiple files

### 3. Team Collaboration

- **Version Control**: Commit `.kilocodeignore` files to version control
- **Documentation**: Document complex patterns for team understanding
- **Consistency**: Maintain consistent patterns across similar projects

### 4. Maintenance

- **Regular Updates**: Update patterns when adding new file types
- **Cleanup**: Remove obsolete patterns when project structure changes
- **Testing**: Test patterns after major changes

## Related Features

- [Custom Rules](/docs/advanced-usage/custom-rules) - Define AI behavior constraints
- [Checkpoints](/docs/features/checkpoints) - Version control for AI tasks
- [Codebase Indexing](/docs/features/codebase-indexing) - Search and navigation
- [Security Best Practices](/docs/advanced-usage/security) - Overall security guidelines

## Tools Reference

- [list_files](/docs/features/tools/list-files) - Directory listing with ignore support
- [read_file](/docs/features/tools/read-file) - File reading with access control
- [write_to_file](/docs/features/tools/write-to-file) - File writing with validation
- [apply_diff](/docs/features/tools/apply-diff) - File modification with access control
