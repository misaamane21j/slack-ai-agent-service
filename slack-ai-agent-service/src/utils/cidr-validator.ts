/**
 * CIDR Range Validation Utilities
 * Provides utilities for validating IP addresses against CIDR ranges for security whitelisting
 */

import { logger } from './logger';

/**
 * CIDR block representation
 */
export interface CIDRBlock {
  /** Network address (e.g., '192.168.1.0') */
  network: string;
  /** Subnet mask bits (e.g., 24 for /24) */
  maskBits: number;
  /** Original CIDR string (e.g., '192.168.1.0/24') */
  original: string;
}

/**
 * IP address validation result
 */
export interface IPValidationResult {
  /** Whether the IP is valid */
  valid: boolean;
  /** Whether it's IPv4 or IPv6 */
  version: 4 | 6 | null;
  /** Error message if invalid */
  error?: string;
  /** Normalized IP address */
  normalizedIP?: string;
}

/**
 * CIDR validation result
 */
export interface CIDRValidationResult {
  /** Whether the CIDR is valid */
  valid: boolean;
  /** Parsed CIDR block if valid */
  cidrBlock?: CIDRBlock;
  /** Error message if invalid */
  error?: string;
}

/**
 * IP matching result
 */
export interface IPMatchResult {
  /** Whether the IP matches any allowed range */
  allowed: boolean;
  /** Which CIDR block matched (if any) */
  matchedRange?: string;
  /** Reason for rejection (if not allowed) */
  reason?: string;
}

/**
 * CIDR Validator Class
 * Handles IP address validation and CIDR range matching for security whitelisting
 */
export class CIDRValidator {
  private allowedRanges: CIDRBlock[] = [];
  private allowedIPs: Set<string> = new Set();

  constructor() {
    logger().info('CIDR Validator initialized');
  }

  /**
   * Validate an IPv4 address format
   */
  validateIPv4(ip: string): IPValidationResult {
    if (!ip || typeof ip !== 'string') {
      return { valid: false, version: null, error: 'IP address must be a non-empty string' };
    }

    // Remove any whitespace
    const trimmedIP = ip.trim();

    // Check for basic IPv4 pattern
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = trimmedIP.match(ipv4Regex);

    if (!match) {
      return { valid: false, version: null, error: 'Invalid IPv4 format' };
    }

    // Validate each octet
    const octets = match.slice(1, 5).map(Number);
    for (let i = 0; i < octets.length; i++) {
      const octet = octets[i];
      if (octet < 0 || octet > 255) {
        return { 
          valid: false, 
          version: null, 
          error: `Invalid octet value ${octet} at position ${i + 1}. Must be 0-255` 
        };
      }
    }

    return {
      valid: true,
      version: 4,
      normalizedIP: trimmedIP,
    };
  }

  /**
   * Validate an IPv6 address format
   */
  validateIPv6(ip: string): IPValidationResult {
    if (!ip || typeof ip !== 'string') {
      return { valid: false, version: null, error: 'IP address must be a non-empty string' };
    }

    const trimmedIP = ip.trim();

    // Basic IPv6 pattern validation
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    const shorthandRegex = /^::([0-9a-fA-F]{0,4}:)*[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:)+::([0-9a-fA-F]{0,4}:)*[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:)+[0-9a-fA-F]{0,4}$/;

    if (!ipv6Regex.test(trimmedIP) && !shorthandRegex.test(trimmedIP)) {
      return { valid: false, version: null, error: 'Invalid IPv6 format' };
    }

    // Check for valid shorthand notation
    const doubleColonCount = (trimmedIP.match(/::/g) || []).length;
    if (doubleColonCount > 1) {
      return { valid: false, version: null, error: 'Invalid IPv6: multiple :: not allowed' };
    }

    // Count groups
    const groups = trimmedIP.split('::');
    if (groups.length === 2) {
      // Shorthand notation
      const leftGroups = groups[0] ? groups[0].split(':').filter(g => g.length > 0) : [];
      const rightGroups = groups[1] ? groups[1].split(':').filter(g => g.length > 0) : [];
      const totalGroups = leftGroups.length + rightGroups.length;
      
      if (totalGroups >= 8) {
        return { valid: false, version: null, error: 'Invalid IPv6: too many groups' };
      }
    } else {
      // Full notation
      const allGroups = trimmedIP.split(':');
      if (allGroups.length !== 8) {
        return { valid: false, version: null, error: 'Invalid IPv6: must have 8 groups or use :: shorthand' };
      }
    }

    return {
      valid: true,
      version: 6,
      normalizedIP: trimmedIP,
    };
  }

  /**
   * Validate an IP address (IPv4 or IPv6)
   */
  validateIP(ip: string): IPValidationResult {
    if (!ip || typeof ip !== 'string') {
      return { valid: false, version: null, error: 'IP address must be a non-empty string' };
    }

    // Try IPv4 first
    if (ip.includes('.')) {
      return this.validateIPv4(ip);
    }

    // Try IPv6
    if (ip.includes(':')) {
      return this.validateIPv6(ip);
    }

    return { valid: false, version: null, error: 'IP address must contain . (IPv4) or : (IPv6)' };
  }

  /**
   * Validate a CIDR block notation
   */
  validateCIDR(cidr: string): CIDRValidationResult {
    if (!cidr || typeof cidr !== 'string') {
      return { valid: false, error: 'CIDR must be a non-empty string' };
    }

    const trimmed = cidr.trim();
    const parts = trimmed.split('/');

    if (parts.length !== 2) {
      return { valid: false, error: 'CIDR must be in format IP/mask (e.g., 192.168.1.0/24)' };
    }

    const [networkIP, maskStr] = parts;

    // Validate the network IP
    const ipValidation = this.validateIP(networkIP);
    if (!ipValidation.valid) {
      return { valid: false, error: `Invalid network IP: ${ipValidation.error}` };
    }

    // Validate the mask
    const maskBits = parseInt(maskStr, 10);
    if (isNaN(maskBits)) {
      return { valid: false, error: 'Subnet mask must be a number' };
    }

    const maxMaskBits = ipValidation.version === 4 ? 32 : 128;
    if (maskBits < 0 || maskBits > maxMaskBits) {
      return { 
        valid: false, 
        error: `Subnet mask must be between 0 and ${maxMaskBits} for IPv${ipValidation.version}` 
      };
    }

    const cidrBlock: CIDRBlock = {
      network: ipValidation.normalizedIP!,
      maskBits,
      original: trimmed,
    };

    return { valid: true, cidrBlock };
  }

  /**
   * Check if an IPv4 address falls within a CIDR range
   */
  private isIPv4InRange(ip: string, cidrBlock: CIDRBlock): boolean {
    const ipParts = ip.split('.').map(Number);
    const networkParts = cidrBlock.network.split('.').map(Number);
    
    // Convert to 32-bit integers
    const ipInt = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
    const networkInt = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];
    
    // Create subnet mask
    const mask = (-1 << (32 - cidrBlock.maskBits)) >>> 0;
    
    // Check if IP is in the same network
    return (ipInt & mask) === (networkInt & mask);
  }

  /**
   * Check if an IPv6 address falls within a CIDR range (simplified implementation)
   */
  private isIPv6InRange(ip: string, cidrBlock: CIDRBlock): boolean {
    // For IPv6, we'll do a simplified prefix matching
    // This is a basic implementation - for production, consider using a proper IPv6 library
    
    if (cidrBlock.maskBits === 0) {
      return true; // ::/0 matches everything
    }

    // Expand both IPs to full form for comparison
    const expandedIP = this.expandIPv6(ip);
    const expandedNetwork = this.expandIPv6(cidrBlock.network);

    if (!expandedIP || !expandedNetwork) {
      return false;
    }

    // Compare the prefix bits
    const prefixLength = Math.floor(cidrBlock.maskBits / 16);
    const remainingBits = cidrBlock.maskBits % 16;

    // Compare full groups
    for (let i = 0; i < prefixLength; i++) {
      if (expandedIP.groups[i] !== expandedNetwork.groups[i]) {
        return false;
      }
    }

    // Compare partial group if needed
    if (remainingBits > 0) {
      const mask = 0xFFFF << (16 - remainingBits);
      const ipGroup = expandedIP.groups[prefixLength] & mask;
      const networkGroup = expandedNetwork.groups[prefixLength] & mask;
      
      if (ipGroup !== networkGroup) {
        return false;
      }
    }

    return true;
  }

  /**
   * Expand IPv6 address to full form (simplified)
   */
  private expandIPv6(ip: string): { groups: number[] } | null {
    try {
      // This is a simplified expansion - for production use a proper IPv6 library
      let expanded = ip;
      
      // Handle :: shorthand
      if (expanded.includes('::')) {
        const parts = expanded.split('::');
        const leftGroups = parts[0] ? parts[0].split(':') : [];
        const rightGroups = parts[1] ? parts[1].split(':') : [];
        const missingGroups = 8 - leftGroups.length - rightGroups.length;
        
        const middle = Array(missingGroups).fill('0000');
        expanded = [...leftGroups, ...middle, ...rightGroups].join(':');
      }

      // Pad each group to 4 digits
      const groups = expanded.split(':').map(group => {
        const padded = group.padStart(4, '0');
        return parseInt(padded, 16);
      });

      if (groups.length !== 8) {
        return null;
      }

      return { groups };
    } catch (error) {
      return null;
    }
  }

  /**
   * Add an allowed IP address
   */
  addAllowedIP(ip: string): boolean {
    const validation = this.validateIP(ip);
    if (!validation.valid) {
      logger().warn('Failed to add allowed IP', { ip, error: validation.error });
      return false;
    }

    this.allowedIPs.add(validation.normalizedIP!);
    logger().info('Added allowed IP', { ip: validation.normalizedIP });
    return true;
  }

  /**
   * Add an allowed CIDR range
   */
  addAllowedRange(cidr: string): boolean {
    const validation = this.validateCIDR(cidr);
    if (!validation.valid) {
      logger().warn('Failed to add allowed CIDR range', { cidr, error: validation.error });
      return false;
    }

    this.allowedRanges.push(validation.cidrBlock!);
    logger().info('Added allowed CIDR range', { cidr: validation.cidrBlock!.original });
    return true;
  }

  /**
   * Check if an IP address is allowed
   */
  isIPAllowed(ip: string): IPMatchResult {
    const validation = this.validateIP(ip);
    if (!validation.valid) {
      return {
        allowed: false,
        reason: `Invalid IP address: ${validation.error}`,
      };
    }

    const normalizedIP = validation.normalizedIP!;

    // Check exact IP matches first
    if (this.allowedIPs.has(normalizedIP)) {
      return {
        allowed: true,
        matchedRange: normalizedIP,
      };
    }

    // Check CIDR ranges
    for (const cidrBlock of this.allowedRanges) {
      let inRange = false;

      if (validation.version === 4 && cidrBlock.network.includes('.')) {
        inRange = this.isIPv4InRange(normalizedIP, cidrBlock);
      } else if (validation.version === 6 && cidrBlock.network.includes(':')) {
        inRange = this.isIPv6InRange(normalizedIP, cidrBlock);
      }

      if (inRange) {
        return {
          allowed: true,
          matchedRange: cidrBlock.original,
        };
      }
    }

    return {
      allowed: false,
      reason: 'IP address not in any allowed range',
    };
  }

  /**
   * Remove an allowed IP address
   */
  removeAllowedIP(ip: string): boolean {
    const validation = this.validateIP(ip);
    if (validation.valid) {
      const removed = this.allowedIPs.delete(validation.normalizedIP!);
      if (removed) {
        logger().info('Removed allowed IP', { ip: validation.normalizedIP });
      }
      return removed;
    }
    return false;
  }

  /**
   * Remove an allowed CIDR range
   */
  removeAllowedRange(cidr: string): boolean {
    const validation = this.validateCIDR(cidr);
    if (validation.valid) {
      const originalLength = this.allowedRanges.length;
      this.allowedRanges = this.allowedRanges.filter(
        block => block.original !== validation.cidrBlock!.original
      );
      const removed = this.allowedRanges.length < originalLength;
      if (removed) {
        logger().info('Removed allowed CIDR range', { cidr: validation.cidrBlock!.original });
      }
      return removed;
    }
    return false;
  }

  /**
   * Get all configured allowed IPs and ranges
   */
  getAllowedConfiguration(): {
    ips: string[];
    ranges: string[];
    totalRules: number;
  } {
    return {
      ips: Array.from(this.allowedIPs),
      ranges: this.allowedRanges.map(block => block.original),
      totalRules: this.allowedIPs.size + this.allowedRanges.length,
    };
  }

  /**
   * Clear all allowed IPs and ranges
   */
  clearAll(): void {
    const previousTotal = this.allowedIPs.size + this.allowedRanges.length;
    this.allowedIPs.clear();
    this.allowedRanges = [];
    logger().info('Cleared all allowed IP rules', { previousTotal });
  }

  /**
   * Load allowed IPs and ranges from configuration arrays
   */
  loadFromConfiguration(config: {
    ips?: string[];
    ranges?: string[];
  }): { 
    successful: number; 
    failed: { item: string; error: string }[] 
  } {
    const result = { successful: 0, failed: [] as { item: string; error: string }[] };

    // Load individual IPs
    if (config.ips) {
      for (const ip of config.ips) {
        if (this.addAllowedIP(ip)) {
          result.successful++;
        } else {
          result.failed.push({ item: ip, error: 'Invalid IP address format' });
        }
      }
    }

    // Load CIDR ranges
    if (config.ranges) {
      for (const range of config.ranges) {
        if (this.addAllowedRange(range)) {
          result.successful++;
        } else {
          result.failed.push({ item: range, error: 'Invalid CIDR range format' });
        }
      }
    }

    logger().info('Loaded IP whitelist configuration', {
      successful: result.successful,
      failed: result.failed.length,
    });

    return result;
  }
}

/**
 * Default CIDR validator instance
 */
export const cidrValidator = new CIDRValidator();