import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const MANAGED_VERSION_FILES = [
  "package.json",
  "client/package.json",
  "package-lock.json",
  "server/Cargo.toml",
  "server/Cargo.lock",
  "server/src/types.rs",
]

const MANAGED_VERSION_FILE_SET = new Set(MANAGED_VERSION_FILES)
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function main() {
  const repoRoot = process.cwd()
  const { bumpArg, dryRun } = parseCliArgs(process.argv.slice(2))

  ensureRepoRoot(repoRoot)
  ensureCurrentBranch(repoRoot, "main")
  ensureOriginRemote(repoRoot)
  ensureCleanTree(repoRoot)

  const currentVersion = readRootPackageVersion(repoRoot)
  const currentParsed = parseVersion(currentVersion, "Current version")

  assertVersionsAreSynchronized(repoRoot, currentVersion)

  const targetVersion = resolveTargetVersion(bumpArg, currentParsed, currentVersion)
  const tagName = `v${targetVersion}`

  ensureTagDoesNotExist(repoRoot, tagName)

  if (dryRun) {
    printDryRunPlan(currentVersion, targetVersion, tagName)
    return
  }

  let didMutateTrackedFiles = false
  let didCreateReleaseCommit = false

  try {
    updateManagedVersionFiles(repoRoot, targetVersion)
    didMutateTrackedFiles = true

    runCommand(repoRoot, "npm", ["run", "build"], "inherit")

    const changedTrackedFiles = getChangedTrackedFiles(repoRoot)
    const unexpectedFiles = changedTrackedFiles.filter(
      (filePath) => !MANAGED_VERSION_FILE_SET.has(filePath),
    )

    if (unexpectedFiles.length > 0) {
      throw new Error(
        [
          "Build changed tracked files outside the managed version set:",
          ...unexpectedFiles.map((filePath) => `- ${filePath}`),
        ].join("\n"),
      )
    }

    runCommand(repoRoot, "git", ["add", "--", ...MANAGED_VERSION_FILES], "inherit")

    const commitMessage = `chore(release): ${tagName}`
    runCommand(repoRoot, "git", ["commit", "-m", commitMessage], "inherit")
    didCreateReleaseCommit = true

    runCommand(repoRoot, "git", ["tag", tagName], "inherit")
    runCommand(repoRoot, "git", ["push", "origin", "main"], "inherit")
    runCommand(repoRoot, "git", ["push", "origin", tagName], "inherit")

    console.log(`Released ${tagName}. The tag push should now trigger GitHub Actions.`)
  } catch (error) {
    if (didMutateTrackedFiles && !didCreateReleaseCommit) {
      restoreTrackedChanges(repoRoot)
    }

    throw error
  }
}

function parseCliArgs(args) {
  if (args.length === 0) {
    throw new Error("Usage: npm run release -- <major|minor|patch|x.y.z> [--dry-run]")
  }

  let bumpArg
  let dryRun = false

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true
      continue
    }

    if (bumpArg !== undefined) {
      throw new Error("Expected exactly one bump argument.")
    }

    bumpArg = arg
  }

  if (bumpArg === undefined) {
    throw new Error("A bump argument is required.")
  }

  if (!["major", "minor", "patch"].includes(bumpArg) && VERSION_RE.test(bumpArg) === false) {
    throw new Error(`Unsupported bump argument "${bumpArg}". Use major, minor, patch, or x.y.z.`)
  }

  return {
    bumpArg,
    dryRun,
  }
}

function ensureRepoRoot(repoRoot) {
  const packageJson = readJsonFile(repoRoot, "package.json")
  if (packageJson.name !== "sofamote") {
    throw new Error("Run this command from the repository root.")
  }
}

function ensureCurrentBranch(repoRoot, expectedBranch) {
  const branchName = readCommand(repoRoot, "git", ["branch", "--show-current"]).trim()

  if (branchName !== expectedBranch) {
    throw new Error(`Releases must be cut from ${expectedBranch}. Current branch: ${branchName || "<detached>"}.`)
  }
}

function ensureOriginRemote(repoRoot) {
  const remoteUrl = readCommand(repoRoot, "git", ["remote", "get-url", "origin"]).trim()
  if (remoteUrl.length === 0) {
    throw new Error('Git remote "origin" is not configured.')
  }
}

function ensureCleanTree(repoRoot) {
  const status = readCommand(repoRoot, "git", ["status", "--porcelain=v1"]).trim()

  if (status.length > 0) {
    throw new Error("Release command requires a clean working tree and index.")
  }
}

function readRootPackageVersion(repoRoot) {
  const packageJson = readJsonFile(repoRoot, "package.json")

  if (typeof packageJson.version !== "string") {
    throw new Error("Root package.json is missing a string version field.")
  }

  return packageJson.version
}

function assertVersionsAreSynchronized(repoRoot, expectedVersion) {
  const checks = [
    () => assertPackageVersion(repoRoot, "package.json", expectedVersion),
    () => assertPackageVersion(repoRoot, "client/package.json", expectedVersion),
    () => assertPackageLockVersion(repoRoot, expectedVersion),
    () => assertCargoTomlVersion(repoRoot, expectedVersion),
    () => assertCargoLockVersion(repoRoot, expectedVersion),
    () => assertTypesVersion(repoRoot, expectedVersion),
  ]

  for (const check of checks) {
    check()
  }
}

function resolveTargetVersion(bumpArg, currentParsed, currentVersion) {
  if (VERSION_RE.test(bumpArg)) {
    const exactVersion = parseVersion(bumpArg, "Exact version")
    if (compareVersions(exactVersion, currentParsed) <= 0) {
      throw new Error(`Exact version must be greater than ${currentVersion}.`)
    }

    return bumpArg
  }

  if (bumpArg === "major") {
    return `${currentParsed.major + 1}.0.0`
  }

  if (bumpArg === "minor") {
    return `${currentParsed.major}.${currentParsed.minor + 1}.0`
  }

  return `${currentParsed.major}.${currentParsed.minor}.${currentParsed.patch + 1}`
}

function ensureTagDoesNotExist(repoRoot, tagName) {
  const localTag = readCommandAllowFailure(repoRoot, "git", ["rev-parse", "--verify", `refs/tags/${tagName}`]).trim()
  if (localTag.length > 0) {
    throw new Error(`Tag ${tagName} already exists locally.`)
  }

  const remoteTag = readCommand(repoRoot, "git", ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]).trim()
  if (remoteTag.length > 0) {
    throw new Error(`Tag ${tagName} already exists on origin.`)
  }
}

function updateManagedVersionFiles(repoRoot, nextVersion) {
  updateJsonVersion(repoRoot, "package.json", (data) => {
    data.version = nextVersion
  })

  updateJsonVersion(repoRoot, "client/package.json", (data) => {
    data.version = nextVersion
  })

  updateJsonVersion(repoRoot, "package-lock.json", (data) => {
    data.version = nextVersion
    data.packages[""].version = nextVersion
    data.packages.client.version = nextVersion
  })

  updateTextVersion(repoRoot, "server/Cargo.toml", (contents) => {
    const nextContents = contents.replace(
      /^(\[package\][\s\S]*?\nversion = ")([^"]+)(")/,
      `$1${nextVersion}$3`,
    )

    if (nextContents === contents) {
      throw new Error("Could not update version in server/Cargo.toml.")
    }

    return nextContents
  })

  updateTextVersion(repoRoot, "server/Cargo.lock", (contents) => {
    const nextContents = contents.replace(
      /(\[\[package\]\]\r?\nname = "sofamote"\r?\nversion = ")([^"]+)(")/,
      `$1${nextVersion}$3`,
    )

    if (nextContents === contents) {
      throw new Error('Could not update Sofamote package version in server/Cargo.lock.')
    }

    return nextContents
  })

  updateTextVersion(repoRoot, "server/src/types.rs", (contents) => {
    const nextContents = contents.replace(
      /(pub const VERSION: &str = ")([^"]+)(";)/,
      `$1${nextVersion}$3`,
    )

    if (nextContents === contents) {
      throw new Error("Could not update VERSION constant in server/src/types.rs.")
    }

    return nextContents
  })
}

function updateJsonVersion(repoRoot, relativePath, mutate) {
  const absolutePath = path.join(repoRoot, relativePath)
  const currentContents = readFileSync(absolutePath, "utf8")
  const eol = detectEol(currentContents)
  const parsed = JSON.parse(currentContents)
  mutate(parsed)
  const nextContents = `${JSON.stringify(parsed, null, 2).replace(/\n/g, eol)}${eol}`
  writeFileSync(absolutePath, nextContents)
}

function updateTextVersion(repoRoot, relativePath, transform) {
  const absolutePath = path.join(repoRoot, relativePath)
  const currentContents = readFileSync(absolutePath, "utf8")
  const nextContents = transform(currentContents)
  writeFileSync(absolutePath, nextContents)
}

function assertPackageVersion(repoRoot, relativePath, expectedVersion) {
  const packageJson = readJsonFile(repoRoot, relativePath)
  if (packageJson.version !== expectedVersion) {
    throw new Error(`${relativePath} version ${packageJson.version} is out of sync with ${expectedVersion}.`)
  }
}

function assertPackageLockVersion(repoRoot, expectedVersion) {
  const packageLock = readJsonFile(repoRoot, "package-lock.json")
  const topLevelVersion = packageLock.version
  const rootPackageVersion = packageLock.packages?.[""]?.version
  const clientVersion = packageLock.packages?.client?.version

  if (topLevelVersion !== expectedVersion) {
    throw new Error(`package-lock.json top-level version ${topLevelVersion} is out of sync with ${expectedVersion}.`)
  }

  if (rootPackageVersion !== expectedVersion) {
    throw new Error(`package-lock.json root package version ${rootPackageVersion} is out of sync with ${expectedVersion}.`)
  }

  if (clientVersion !== expectedVersion) {
    throw new Error(`package-lock.json client workspace version ${clientVersion} is out of sync with ${expectedVersion}.`)
  }
}

function assertCargoTomlVersion(repoRoot, expectedVersion) {
  const contents = readTextFile(repoRoot, "server/Cargo.toml")
  const match = contents.match(/^(\[package\][\s\S]*?\nversion = ")([^"]+)(")/)

  if (match === null) {
    throw new Error("Could not read package version from server/Cargo.toml.")
  }

  if (match[2] !== expectedVersion) {
    throw new Error(`server/Cargo.toml version ${match[2]} is out of sync with ${expectedVersion}.`)
  }
}

function assertCargoLockVersion(repoRoot, expectedVersion) {
  const contents = readTextFile(repoRoot, "server/Cargo.lock")
  const match = contents.match(/(\[\[package\]\]\r?\nname = "sofamote"\r?\nversion = ")([^"]+)(")/)

  if (match === null) {
    throw new Error('Could not read the Sofamote package version from server/Cargo.lock.')
  }

  if (match[2] !== expectedVersion) {
    throw new Error(`server/Cargo.lock version ${match[2]} is out of sync with ${expectedVersion}.`)
  }
}

function assertTypesVersion(repoRoot, expectedVersion) {
  const contents = readTextFile(repoRoot, "server/src/types.rs")
  const match = contents.match(/pub const VERSION: &str = "([^"]+)";/)

  if (match === null) {
    throw new Error("Could not read VERSION constant from server/src/types.rs.")
  }

  if (match[1] !== expectedVersion) {
    throw new Error(`server/src/types.rs VERSION ${match[1]} is out of sync with ${expectedVersion}.`)
  }
}

function restoreTrackedChanges(repoRoot) {
  const changedFiles = getChangedTrackedFiles(repoRoot)

  if (changedFiles.length === 0) {
    return
  }

  runCommand(repoRoot, "git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...changedFiles], "inherit")
}

function getChangedTrackedFiles(repoRoot) {
  const output = readCommand(repoRoot, "git", ["diff", "--name-only", "HEAD", "--"]).trim()

  if (output.length === 0) {
    return []
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function printDryRunPlan(currentVersion, targetVersion, tagName) {
  console.log(`Current version: ${currentVersion}`)
  console.log(`Target version: ${targetVersion}`)
  console.log("Managed version files:")

  for (const filePath of MANAGED_VERSION_FILES) {
    console.log(`- ${filePath}`)
  }

  console.log("Planned git actions:")
  console.log(`- git add -- ${MANAGED_VERSION_FILES.join(" ")}`)
  console.log(`- git commit -m "chore(release): ${tagName}"`)
  console.log(`- git tag ${tagName}`)
  console.log("- git push origin main")
  console.log(`- git push origin ${tagName}`)
}

function parseVersion(rawVersion, label) {
  const match = rawVersion.match(VERSION_RE)

  if (match === null) {
    throw new Error(`${label} must be a three-part semver version.`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }

  return left.patch - right.patch
}

function readJsonFile(repoRoot, relativePath) {
  return JSON.parse(readTextFile(repoRoot, relativePath))
}

function readTextFile(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function detectEol(contents) {
  return contents.includes("\r\n") ? "\r\n" : "\n"
}

function readCommand(repoRoot, command, args) {
  const invocation = resolveCommandInvocation(command, args)

  return execFileSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function readCommandAllowFailure(repoRoot, command, args) {
  try {
    return readCommand(repoRoot, command, args)
  } catch {
    return ""
  }
}

function runCommand(repoRoot, command, args, stdio) {
  const invocation = resolveCommandInvocation(command, args)

  execFileSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    stdio,
  })
}

function resolveCommandInvocation(command, args) {
  if (process.platform === "win32" && command === "npm") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
    }
  }

  return {
    command,
    args,
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
