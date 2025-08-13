/**
 * Secure Credential Storage System for MCP Servers
 * Handles encryption, decryption, and secure storage of sensitive credentials
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

/**
 * Encrypted credential data structure
 */
export interface EncryptedCredential {
  /** Encrypted credential value */
  encryptedValue: string;
  /** Initialization vector used for encryption */
  iv: string;
  /** Algorithm used for encryption */
  algorithm: string;
  /** Timestamp when credential was encrypted */
  timestamp: Date;
  /** Expiration timestamp (optional) */
  expiresAt?: Date;
  /** Metadata for the credential */
  metadata: {
    /** Credential source (env, file, api) */
    source: string;
    /** Description of the credential */
    description?: string;
    /** Tags for categorization */
    tags: string[];
  };
}

/**
 * Credential storage options
 */
export interface CredentialStorageOptions {
  /** Encryption algorithm to use */
  algorithm: string;
  /** Key derivation iterations */
  keyDerivationIterations: number;
  /** Salt length for key derivation */
  saltLength: number;
  /** IV length for encryption */
  ivLength: number;
  /** Storage directory for encrypted credentials */
  storageDir: string;
  /** Default credential expiration in milliseconds */
  defaultExpiration?: number;
}

/**
 * Default credential storage options
 */
const DEFAULT_OPTIONS: CredentialStorageOptions = {
  algorithm: 'aes-256-gcm',
  keyDerivationIterations: 100000,
  saltLength: 32,
  ivLength: 16,
  storageDir: './.credentials',
  defaultExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Secure Credential Manager
 * Provides encrypted storage and retrieval of sensitive credentials for MCP servers
 */
export class CredentialManager {
  private options: CredentialStorageOptions;
  private masterKey: Buffer | null = null;
  private salt: Buffer | null = null;

  constructor(options: Partial<CredentialStorageOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    logger().info('Credential Manager initialized', {
      algorithm: this.options.algorithm,
      storageDir: this.options.storageDir,
    });
  }

  /**
   * Initialize the credential manager with a master key
   */
  async initialize(password: string): Promise<void> {
    try {
      // Ensure storage directory exists
      await fs.mkdir(this.options.storageDir, { recursive: true });

      // Load or generate salt
      const saltPath = path.join(this.options.storageDir, 'salt');
      try {
        const saltData = await fs.readFile(saltPath);
        this.salt = saltData;
        logger().debug('Loaded existing salt');
      } catch (error) {
        // Generate new salt
        this.salt = crypto.randomBytes(this.options.saltLength);
        await fs.writeFile(saltPath, this.salt, { mode: 0o600 });
        logger().info('Generated new salt for credential encryption');
      }

      // Derive master key from password
      this.masterKey = await this.deriveKey(password, this.salt);
      
      logger().info('Credential Manager initialized successfully');
    } catch (error) {
      logger().error('Failed to initialize Credential Manager', { error });
      throw new Error(`Credential Manager initialization failed: ${error}`);
    }
  }

  /**
   * Derive encryption key from password and salt
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        this.options.keyDerivationIterations,
        32, // 256 bits
        'sha256',
        (error, derivedKey) => {
          if (error) {
            reject(error);
          } else {
            resolve(derivedKey);
          }
        }
      );
    });
  }

  /**
   * Store an encrypted credential
   */
  async storeCredential(
    key: string,
    value: string,
    metadata: {
      source?: string;
      description?: string;
      tags?: string[];
      expiresAt?: Date;
    } = {}
  ): Promise<void> {
    if (!this.masterKey) {
      throw new Error('Credential Manager not initialized');
    }

    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.options.ivLength);

      // Create cipher
      const cipher = crypto.createCipher(this.options.algorithm, this.masterKey);
      cipher.setAutoPadding(true);

      // Encrypt the credential
      let encryptedValue = cipher.update(value, 'utf8', 'hex');
      encryptedValue += cipher.final('hex');

      // Get authentication tag (for GCM mode)
      const authTag = (cipher as any).getAuthTag?.() || '';

      // Create credential object
      const credential: EncryptedCredential = {
        encryptedValue: encryptedValue + (authTag ? ':' + authTag.toString('hex') : ''),
        iv: iv.toString('hex'),
        algorithm: this.options.algorithm,
        timestamp: new Date(),
        expiresAt: metadata.expiresAt || (this.options.defaultExpiration 
          ? new Date(Date.now() + this.options.defaultExpiration) 
          : undefined),
        metadata: {
          source: metadata.source || 'api',
          description: metadata.description,
          tags: metadata.tags || [],
        },
      };

      // Save to file
      const credentialPath = path.join(this.options.storageDir, `${this.hashKey(key)}.json`);
      await fs.writeFile(
        credentialPath, 
        JSON.stringify(credential, null, 2), 
        { mode: 0o600 }
      );

      logger().info('Credential stored successfully', { 
        key: this.hashKey(key),
        source: credential.metadata.source,
        expiresAt: credential.expiresAt,
      });

    } catch (error) {
      logger().error('Failed to store credential', { key: this.hashKey(key), error });
      throw new Error(`Failed to store credential: ${error}`);
    }
  }

  /**
   * Retrieve and decrypt a credential
   */
  async retrieveCredential(key: string): Promise<string | null> {
    if (!this.masterKey) {
      throw new Error('Credential Manager not initialized');
    }

    try {
      const credentialPath = path.join(this.options.storageDir, `${this.hashKey(key)}.json`);
      
      // Check if credential exists
      try {
        await fs.access(credentialPath);
      } catch (error) {
        logger().debug('Credential not found', { key: this.hashKey(key) });
        return null;
      }

      // Load credential
      const credentialData = await fs.readFile(credentialPath, 'utf-8');
      const credential: EncryptedCredential = JSON.parse(credentialData);

      // Check expiration
      if (credential.expiresAt && new Date() > new Date(credential.expiresAt)) {
        logger().warn('Credential expired, removing', { 
          key: this.hashKey(key),
          expiresAt: credential.expiresAt,
        });
        await this.removeCredential(key);
        return null;
      }

      // Parse encrypted value and auth tag
      const [encryptedValue, authTagHex] = credential.encryptedValue.split(':');
      const iv = Buffer.from(credential.iv, 'hex');

      // Create decipher
      const decipher = crypto.createDecipher(credential.algorithm, this.masterKey);
      
      // Set auth tag if available (for GCM mode)
      if (authTagHex) {
        const authTag = Buffer.from(authTagHex, 'hex');
        (decipher as any).setAuthTag?.(authTag);
      }

      // Decrypt the credential
      let decryptedValue = decipher.update(encryptedValue, 'hex', 'utf8');
      decryptedValue += decipher.final('utf8');

      logger().debug('Credential retrieved successfully', { 
        key: this.hashKey(key),
        source: credential.metadata.source,
      });

      return decryptedValue;

    } catch (error) {
      logger().error('Failed to retrieve credential', { key: this.hashKey(key), error });
      return null;
    }
  }

  /**
   * Check if a credential exists
   */
  async hasCredential(key: string): Promise<boolean> {
    try {
      const credentialPath = path.join(this.options.storageDir, `${this.hashKey(key)}.json`);
      await fs.access(credentialPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove a credential
   */
  async removeCredential(key: string): Promise<boolean> {
    try {
      const credentialPath = path.join(this.options.storageDir, `${this.hashKey(key)}.json`);
      await fs.unlink(credentialPath);
      
      logger().info('Credential removed', { key: this.hashKey(key) });
      return true;
    } catch (error) {
      logger().warn('Failed to remove credential', { key: this.hashKey(key), error });
      return false;
    }
  }

  /**
   * List all stored credentials (metadata only)
   */
  async listCredentials(): Promise<Array<{
    key: string;
    metadata: EncryptedCredential['metadata'];
    timestamp: Date;
    expiresAt?: Date;
    expired: boolean;
  }>> {
    try {
      const files = await fs.readdir(this.options.storageDir);
      const credentials = [];

      for (const file of files) {
        if (file.endsWith('.json') && file !== 'salt') {
          try {
            const credentialPath = path.join(this.options.storageDir, file);
            const credentialData = await fs.readFile(credentialPath, 'utf-8');
            const credential: EncryptedCredential = JSON.parse(credentialData);
            
            const expired = credential.expiresAt ? new Date() > new Date(credential.expiresAt) : false;
            
            credentials.push({
              key: file.replace('.json', ''),
              metadata: credential.metadata,
              timestamp: new Date(credential.timestamp),
              expiresAt: credential.expiresAt ? new Date(credential.expiresAt) : undefined,
              expired,
            });
          } catch (error) {
            logger().warn('Failed to read credential file', { file, error });
          }
        }
      }

      return credentials;
    } catch (error) {
      logger().error('Failed to list credentials', { error });
      return [];
    }
  }

  /**
   * Clean up expired credentials
   */
  async cleanupExpiredCredentials(): Promise<number> {
    const credentials = await this.listCredentials();
    let removedCount = 0;

    for (const credential of credentials) {
      if (credential.expired) {
        // Reverse hash to get original key (this is a limitation - we'd need to store the original key hash)
        // For now, we'll just remove by the hashed key
        await this.removeCredential(credential.key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger().info('Cleaned up expired credentials', { removedCount });
    }

    return removedCount;
  }

  /**
   * Import credentials from environment variables
   */
  async importFromEnvironment(
    mapping: Record<string, string>,
    options: {
      tags?: string[];
      description?: string;
      overwrite?: boolean;
    } = {}
  ): Promise<void> {
    const { tags = ['environment'], description, overwrite = false } = options;

    for (const [credentialKey, envVar] of Object.entries(mapping)) {
      const envValue = process.env[envVar];
      
      if (!envValue) {
        logger().warn('Environment variable not found', { envVar, credentialKey });
        continue;
      }

      // Check if credential already exists
      if (!overwrite && await this.hasCredential(credentialKey)) {
        logger().debug('Credential already exists, skipping', { credentialKey });
        continue;
      }

      await this.storeCredential(credentialKey, envValue, {
        source: 'environment',
        description: description || `Imported from ${envVar}`,
        tags: [...tags, 'imported'],
      });

      logger().info('Imported credential from environment', { 
        credentialKey, 
        envVar: envVar.substring(0, 10) + '...' 
      });
    }
  }

  /**
   * Create a hash of the credential key for secure storage
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalCredentials: number;
    expiredCredentials: number;
    storageDir: string;
    totalSize: number;
  }> {
    try {
      const credentials = await this.listCredentials();
      const expiredCredentials = credentials.filter(c => c.expired).length;
      
      // Calculate total storage size
      const files = await fs.readdir(this.options.storageDir);
      let totalSize = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(this.options.storageDir, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        } catch (error) {
          // Ignore errors for individual files
        }
      }

      return {
        totalCredentials: credentials.length,
        expiredCredentials,
        storageDir: this.options.storageDir,
        totalSize,
      };
    } catch (error) {
      logger().error('Failed to get credential stats', { error });
      return {
        totalCredentials: 0,
        expiredCredentials: 0,
        storageDir: this.options.storageDir,
        totalSize: 0,
      };
    }
  }

  /**
   * Cleanup and destroy credential manager
   */
  async destroy(): Promise<void> {
    // Clear sensitive data from memory
    if (this.masterKey) {
      this.masterKey.fill(0);
      this.masterKey = null;
    }
    
    if (this.salt) {
      this.salt.fill(0);
      this.salt = null;
    }

    logger().info('Credential Manager destroyed');
  }
}