/**
 * Pro Mode Sharing Types
 * Types for strategy import/export and sharing functionality
 */

import { StrategyConfigSchema, TemplateCategory, SandboxConfig } from './customStrategy';
import { IndicatorParameter } from './indicators';

// ============================================
// EXPORT PACKAGE
// ============================================

export interface StrategyExportPackage {
  version: '2.0';                     // Package format version
  exportedAt: string;                 // ISO timestamp

  // Strategy definition
  strategy: {
    name: string;
    description?: string;
    pythonCode: string;
    configSchema?: StrategyConfigSchema;
    configValues: Record<string, unknown>;
    tags: string[];
    templateCategory?: TemplateCategory;
  };

  // Optional: Include custom indicators used by strategy
  customIndicators?: Array<{
    name: string;
    pythonCode: string;
    parameters: IndicatorParameter[];
  }>;

  // Checksum for integrity verification
  checksum: string;
}

// ============================================
// SHARE LINK
// ============================================

export interface ShareLink {
  id: string;
  strategyId: string;
  strategyVersionId: string;

  // Link settings
  expiresAt?: number;                 // Optional expiration timestamp
  maxDownloads?: number;              // Optional download limit
  downloadsCount: number;

  // Access control
  requiresPassword: boolean;
  passwordHash?: string;              // bcrypt hash if password required

  // Metadata
  createdAt: number;
  createdBy: string;
}

// ============================================
// SHARE CODE
// ============================================

export interface ShareCode {
  code: string;                       // Base64 encoded package
  version: string;
  createdAt: number;
}

// ============================================
// IMPORT RESULT
// ============================================

export interface ImportResult {
  success: boolean;
  strategyId?: string;
  errors: ImportError[];
  warnings: ImportWarning[];
}

export interface ImportError {
  type: 'validation' | 'security' | 'format' | 'version';
  message: string;
  field?: string;
}

export interface ImportWarning {
  type: 'compatibility' | 'deprecated' | 'missing';
  message: string;
  field?: string;
}

// ============================================
// EXPORT OPTIONS
// ============================================

export interface ExportOptions {
  includeConfigValues: boolean;       // Include current parameter values
  includeCustomIndicators: boolean;   // Include custom indicators
  includeVersionHistory: boolean;     // Include version history
  minifyCode: boolean;                // Remove comments and whitespace
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeConfigValues: true,
  includeCustomIndicators: true,
  includeVersionHistory: false,
  minifyCode: false,
};

// ============================================
// SHARE LINK OPTIONS
// ============================================

export interface ShareLinkOptions {
  expiresInDays?: number;             // Auto-expire after N days
  maxDownloads?: number;              // Limit total downloads
  requirePassword?: boolean;          // Require password to access
  password?: string;                  // Password if required
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a checksum for package integrity
 */
export function generateChecksum(data: string): string {
  // Simple hash function for demo - in production use crypto.subtle
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Verify package checksum
 */
export function verifyChecksum(pkg: StrategyExportPackage): boolean {
  const { checksum, ...dataWithoutChecksum } = pkg;
  const expectedChecksum = generateChecksum(JSON.stringify(dataWithoutChecksum));
  return checksum === expectedChecksum;
}

/**
 * Encode package to share code
 */
export function encodeToShareCode(pkg: StrategyExportPackage): string {
  const json = JSON.stringify(pkg);
  // Use base64 encoding
  if (typeof btoa !== 'undefined') {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json).toString('base64');
}

/**
 * Decode share code to package
 */
export function decodeFromShareCode(code: string): StrategyExportPackage | null {
  try {
    let json: string;
    if (typeof atob !== 'undefined') {
      json = decodeURIComponent(escape(atob(code)));
    } else {
      json = Buffer.from(code, 'base64').toString('utf8');
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Create export package from strategy data
 */
export function createExportPackage(
  strategy: {
    name: string;
    description?: string;
    pythonCode: string;
    configSchema?: StrategyConfigSchema;
    configValues: Record<string, unknown>;
    tags: string[];
    templateCategory?: TemplateCategory;
  },
  customIndicators?: Array<{
    name: string;
    pythonCode: string;
    parameters: IndicatorParameter[];
  }>
): StrategyExportPackage {
  const packageData = {
    version: '2.0' as const,
    exportedAt: new Date().toISOString(),
    strategy,
    customIndicators,
    checksum: '', // Will be set after
  };

  // Generate checksum from data
  const { checksum: _, ...dataForChecksum } = packageData;
  packageData.checksum = generateChecksum(JSON.stringify(dataForChecksum));

  return packageData;
}
