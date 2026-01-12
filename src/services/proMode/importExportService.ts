/**
 * Import/Export Service
 * Handles strategy import/export and sharing functionality
 */

import {
  CustomStrategy,
  StrategyExportPackage,
  ImportResult,
  ImportError,
  ImportWarning,
  ExportOptions,
  DEFAULT_EXPORT_OPTIONS,
  generateChecksum,
  verifyChecksum,
  encodeToShareCode,
  decodeFromShareCode,
  createExportPackage,
} from '../../types/proMode';
import { proModeDb } from './proModeDbService';
import { pyodideService } from './pyodideService';

// ============================================
// SECURITY VALIDATION
// ============================================

const FORBIDDEN_CODE_PATTERNS = [
  // File system access
  /\bopen\s*\(/i,
  /\bos\s*\./i,
  /\bsys\s*\./i,
  /\bsubprocess/i,
  /\bshutil/i,
  /\bpathlib/i,

  // Network access
  /\brequests\s*\./i,
  /\burllib/i,
  /\bsocket/i,
  /\bhttp\.client/i,
  /\bftplib/i,
  /\bsmtplib/i,

  // Code execution
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /\bcompile\s*\(/i,
  /\b__import__\s*\(/i,
  /\bimportlib/i,

  // System access
  /\bctypes/i,
  /\bmultiprocessing/i,
  /\bthreading\s*\./i,
  /\bpickle/i,
  /\bshelve/i,

  // Dangerous builtins
  /\bglobals\s*\(\)/i,
  /\blocals\s*\(\)/i,
  /\bvars\s*\(\)/i,
  /\bdir\s*\(\)/i,
  /\bgetattr\s*\(/i,
  /\bsetattr\s*\(/i,
  /\bdelattr\s*\(/i,
];

// ============================================
// IMPORT/EXPORT SERVICE
// ============================================

class ImportExportService {
  /**
   * Export a strategy to a package
   */
  async exportStrategy(
    strategyId: string,
    options: Partial<ExportOptions> = {}
  ): Promise<StrategyExportPackage | null> {
    const strategy = await proModeDb.customStrategies.get(strategyId);
    if (!strategy) {
      console.error('Strategy not found:', strategyId);
      return null;
    }

    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    // Prepare strategy data for export
    const strategyData = {
      name: strategy.name,
      description: strategy.description,
      pythonCode: exportOptions.minifyCode
        ? this.minifyCode(strategy.pythonCode)
        : strategy.pythonCode,
      configSchema: strategy.configSchema,
      configValues: exportOptions.includeConfigValues
        ? strategy.configValues
        : {},
      tags: strategy.tags,
      templateCategory: strategy.templateCategory,
    };

    // Get custom indicators if requested
    let customIndicators: Array<{
      name: string;
      pythonCode: string;
      parameters: any[];
    }> | undefined;

    if (exportOptions.includeCustomIndicators) {
      const indicators = await proModeDb.customIndicators.toArray();
      if (indicators.length > 0) {
        customIndicators = indicators.map(ind => ({
          name: ind.name,
          pythonCode: ind.pythonCode,
          parameters: ind.parameters,
        }));
      }
    }

    return createExportPackage(strategyData, customIndicators);
  }

  /**
   * Export strategy to JSON file
   */
  async exportToFile(strategyId: string, options?: Partial<ExportOptions>): Promise<void> {
    const pkg = await this.exportStrategy(strategyId, options);
    if (!pkg) {
      throw new Error('Failed to export strategy');
    }

    const json = JSON.stringify(pkg, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${pkg.strategy.name.toLowerCase().replace(/\s+/g, '-')}-strategy.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Export strategy to share code (base64)
   */
  async exportToShareCode(strategyId: string, options?: Partial<ExportOptions>): Promise<string | null> {
    const pkg = await this.exportStrategy(strategyId, options);
    if (!pkg) {
      return null;
    }

    return encodeToShareCode(pkg);
  }

  /**
   * Import a strategy from JSON file
   */
  async importFromFile(file: File): Promise<ImportResult> {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          const json = event.target?.result as string;
          const pkg = JSON.parse(json) as StrategyExportPackage;
          resolve(await this.importPackage(pkg));
        } catch (error: any) {
          resolve({
            success: false,
            errors: [{
              type: 'format',
              message: `Invalid JSON file: ${error.message}`,
            }],
            warnings: [],
          });
        }
      };

      reader.onerror = () => {
        resolve({
          success: false,
          errors: [{
            type: 'format',
            message: 'Failed to read file',
          }],
          warnings: [],
        });
      };

      reader.readAsText(file);
    });
  }

  /**
   * Import a strategy from share code
   */
  async importFromShareCode(code: string): Promise<ImportResult> {
    const pkg = decodeFromShareCode(code);
    if (!pkg) {
      return {
        success: false,
        errors: [{
          type: 'format',
          message: 'Invalid share code - could not decode',
        }],
        warnings: [],
      };
    }

    return this.importPackage(pkg);
  }

  /**
   * Import a strategy package
   */
  async importPackage(pkg: StrategyExportPackage): Promise<ImportResult> {
    const errors: ImportError[] = [];
    const warnings: ImportWarning[] = [];

    // Validate package version
    if (pkg.version !== '2.0') {
      if (pkg.version) {
        warnings.push({
          type: 'compatibility',
          message: `Package version ${pkg.version} may have compatibility issues`,
        });
      } else {
        errors.push({
          type: 'version',
          message: 'Invalid package format - missing version',
        });
        return { success: false, errors, warnings };
      }
    }

    // Verify checksum
    if (!verifyChecksum(pkg)) {
      warnings.push({
        type: 'compatibility',
        message: 'Package checksum mismatch - data may have been modified',
      });
    }

    // Validate strategy data
    if (!pkg.strategy) {
      errors.push({
        type: 'format',
        message: 'Missing strategy data',
      });
      return { success: false, errors, warnings };
    }

    if (!pkg.strategy.name) {
      errors.push({
        type: 'format',
        message: 'Strategy name is required',
        field: 'strategy.name',
      });
    }

    if (!pkg.strategy.pythonCode) {
      errors.push({
        type: 'format',
        message: 'Strategy Python code is required',
        field: 'strategy.pythonCode',
      });
    }

    if (errors.length > 0) {
      return { success: false, errors, warnings };
    }

    // Security validation
    const securityErrors = this.validateCodeSecurity(pkg.strategy.pythonCode);
    if (securityErrors.length > 0) {
      errors.push(...securityErrors);
      return { success: false, errors, warnings };
    }

    // Validate Python syntax
    try {
      await pyodideService.initialize();
      const validation = await pyodideService.validateCode(pkg.strategy.pythonCode);
      if (!validation.isValid) {
        errors.push(...validation.errors.map(e => ({
          type: e.type as ImportError['type'],
          message: e.message,
        })));
        return { success: false, errors, warnings };
      }
    } catch (error: any) {
      warnings.push({
        type: 'compatibility',
        message: `Could not validate Python code: ${error.message}`,
      });
    }

    // Check for name conflicts
    const existingStrategy = await proModeDb.customStrategies
      .where('name')
      .equals(pkg.strategy.name)
      .first();

    let finalName = pkg.strategy.name;
    if (existingStrategy) {
      // Add timestamp to make unique
      finalName = `${pkg.strategy.name} (imported ${new Date().toLocaleDateString()})`;
      warnings.push({
        type: 'compatibility',
        message: `Strategy "${pkg.strategy.name}" already exists - renamed to "${finalName}"`,
      });
    }

    // Create the strategy
    const strategyId = crypto.randomUUID();
    const now = Date.now();

    const strategy: CustomStrategy = {
      id: strategyId,
      name: finalName,
      description: pkg.strategy.description,
      pythonCode: pkg.strategy.pythonCode,
      configSchema: pkg.strategy.configSchema,
      configValues: pkg.strategy.configValues || {},
      version: '1.0.0',
      versionHistory: [],
      tags: pkg.strategy.tags || [],
      status: 'draft',
      isTemplate: false,
      templateCategory: pkg.strategy.templateCategory,
      sandboxConfig: {
        allowedImports: ['numpy', 'pandas', 'math', 'statistics', 'decimal', 'datetime', 'json', 're', 'collections', 'itertools'],
        maxExecutionTimeMs: 30000,
        maxMemoryMB: 256,
        maxIterations: 1000000,
        maxOutputSize: 1024 * 1024,
      },
      createdAt: now,
      updatedAt: now,
    };

    await proModeDb.customStrategies.put(strategy);

    // Import custom indicators if present
    if (pkg.customIndicators && pkg.customIndicators.length > 0) {
      for (const indicator of pkg.customIndicators) {
        const secErrors = this.validateCodeSecurity(indicator.pythonCode);
        if (secErrors.length > 0) {
          warnings.push({
            type: 'compatibility',
            message: `Skipped indicator "${indicator.name}" due to security concerns`,
          });
          continue;
        }

        await proModeDb.customIndicators.put({
          id: crypto.randomUUID(),
          name: indicator.name,
          shortName: indicator.name.toUpperCase().slice(0, 6),
          category: 'custom',
          description: `Imported with strategy ${finalName}`,
          parameters: indicator.parameters,
          outputs: [{ name: 'value', type: 'line' }],
          pythonFunction: indicator.name,
          pythonCode: indicator.pythonCode,
          isBuiltIn: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      success: true,
      strategyId,
      errors: [],
      warnings,
    };
  }

  /**
   * Copy strategy to clipboard as share code
   */
  async copyToClipboard(strategyId: string): Promise<boolean> {
    const shareCode = await this.exportToShareCode(strategyId);
    if (!shareCode) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(shareCode);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }

  /**
   * Import strategy from clipboard
   */
  async importFromClipboard(): Promise<ImportResult> {
    try {
      const text = await navigator.clipboard.readText();
      return this.importFromShareCode(text.trim());
    } catch (error: any) {
      return {
        success: false,
        errors: [{
          type: 'format',
          message: `Failed to read clipboard: ${error.message}`,
        }],
        warnings: [],
      };
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private validateCodeSecurity(code: string): ImportError[] {
    const errors: ImportError[] = [];

    for (const pattern of FORBIDDEN_CODE_PATTERNS) {
      if (pattern.test(code)) {
        const match = code.match(pattern);
        errors.push({
          type: 'security',
          message: `Forbidden code pattern detected: ${match?.[0] || 'unknown'}`,
        });
      }
    }

    return errors;
  }

  private minifyCode(code: string): string {
    // Remove comments
    let minified = code.replace(/#[^\n]*/g, '');

    // Remove docstrings (simple approach)
    minified = minified.replace(/'''[\s\S]*?'''/g, '');
    minified = minified.replace(/"""[\s\S]*?"""/g, '');

    // Remove excess whitespace but preserve indentation
    const lines = minified.split('\n');
    const trimmedLines = lines
      .map(line => {
        // Preserve leading whitespace, trim trailing
        const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
        const content = line.trimEnd();
        return content ? leadingWhitespace + content.trimStart() : '';
      })
      .filter(line => line.trim() !== '');

    return trimmedLines.join('\n');
  }
}

// Export singleton instance
export const importExportService = new ImportExportService();

// Export class for testing
export { ImportExportService };
