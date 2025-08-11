import path from 'path';
import fs from 'fs';

/**
 * Security validation for MCP server paths and process spawning
 */

export interface PathValidationOptions {
  allowedPaths: string[];
  requireExecutable?: boolean;
  allowRelativePaths?: boolean;
}

/**
 * Validates that a Jenkins server path is secure and authorized
 * @param jenkinsPath Path to the Jenkins MCP server executable
 * @param options Validation options including allowed paths
 * @returns true if path is secure, false otherwise
 */
export function validateJenkinsPath(
  jenkinsPath: string,
  options: PathValidationOptions
): boolean {
  try {
    // 1. Basic input validation
    if (!jenkinsPath || typeof jenkinsPath !== 'string') {
      console.warn('Jenkins path validation failed: invalid input');
      return false;
    }

    // 2. Check for dangerous characters and patterns
    const dangerousPatterns = [
      /[;&|`$()]/,      // Shell injection characters
      /\0/,             // Null bytes
      /^\s*$/,          // Empty or whitespace only
    ];

    // Only check for directory traversal if relative paths are not allowed
    if (!options.allowRelativePaths) {
      dangerousPatterns.push(/\.\./);
    }

    for (const pattern of dangerousPatterns) {
      if (pattern.test(jenkinsPath)) {
        console.warn(`Jenkins path validation failed: dangerous pattern detected in ${jenkinsPath}`);
        return false;
      }
    }

    // 3. Resolve to absolute path
    let absolutePath: string;
    try {
      absolutePath = path.resolve(jenkinsPath);
    } catch (error) {
      console.warn(`Jenkins path validation failed: cannot resolve path ${jenkinsPath}`, error);
      return false;
    }

    // 4. Check if within allowed directories
    const isInAllowedDir = options.allowedPaths.some(allowedDir => {
      const resolvedAllowedDir = path.resolve(allowedDir);
      return absolutePath.startsWith(resolvedAllowedDir);
    });

    if (!isInAllowedDir && !options.allowRelativePaths) {
      console.warn(`Jenkins path validation failed: ${absolutePath} not in allowed directories`);
      return false;
    }

    // 5. Check file exists
    try {
      fs.accessSync(absolutePath, fs.constants.F_OK);
    } catch {
      console.warn(`Jenkins path validation failed: file does not exist ${absolutePath}`);
      return false;
    }

    // 6. Check if executable (if required)
    if (options.requireExecutable) {
      try {
        fs.accessSync(absolutePath, fs.constants.X_OK);
      } catch {
        console.warn(`Jenkins path validation failed: file not executable ${absolutePath}`);
        return false;
      }
    }

    // 7. Verify it's a regular file (not a directory or special file)
    try {
      const stats = fs.statSync(absolutePath);
      if (!stats.isFile()) {
        console.warn(`Jenkins path validation failed: not a regular file ${absolutePath}`);
        return false;
      }
    } catch (error) {
      console.warn(`Jenkins path validation failed: cannot stat file ${absolutePath}`, error);
      return false;
    }

    console.debug(`Jenkins path validation passed: ${absolutePath}`);
    return true;
  } catch (error) {
    console.error('Unexpected error during Jenkins path validation:', error);
    return false;
  }
}

/**
 * Gets default allowed paths based on the environment
 * @returns Array of default allowed directory paths
 */
export function getDefaultAllowedPaths(): string[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  
  return [
    '/opt/jenkins-servers',
    '/usr/local/jenkins',
    `${homeDir}/.local/jenkins-servers`,
    process.cwd(), // Allow current working directory for development
  ].filter(dir => {
    try {
      // Only include directories that exist
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
}

/**
 * Validates process spawn arguments for security
 * @param command Command to execute
 * @param args Command arguments
 * @returns true if arguments are secure, false otherwise
 */
export function validateSpawnArguments(command: string, args: string[] = []): boolean {
  // 1. Validate command
  if (!command || typeof command !== 'string') {
    console.warn('Spawn validation failed: invalid command');
    return false;
  }

  // 2. Check for shell injection in command
  const dangerousCommandPatterns = [
    /[;&|`$()]/,
    /\.\./,
    /\0/,
  ];

  for (const pattern of dangerousCommandPatterns) {
    if (pattern.test(command)) {
      console.warn(`Spawn validation failed: dangerous pattern in command ${command}`);
      return false;
    }
  }

  // 3. Validate arguments
  for (const arg of args) {
    if (typeof arg !== 'string') {
      console.warn('Spawn validation failed: non-string argument');
      return false;
    }

    for (const pattern of dangerousCommandPatterns) {
      if (pattern.test(arg)) {
        console.warn(`Spawn validation failed: dangerous pattern in argument ${arg}`);
        return false;
      }
    }
  }

  console.debug(`Spawn validation passed: ${command} with ${args.length} arguments`);
  return true;
}