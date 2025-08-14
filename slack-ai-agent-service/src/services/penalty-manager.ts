import { logger } from '../utils/logger';
import { RateLimitStorage, RedisRateLimitStorage, MemoryRateLimitStorage } from './rate-limiter';

/**
 * Penalty types with escalating severity
 */
export enum PenaltyType {
  WARNING = 'warning',
  TEMPORARY_BLOCK = 'temporary_block',
  EXTENDED_BLOCK = 'extended_block',
  PERMANENT_BAN = 'permanent_ban'
}

/**
 * Penalty severity levels
 */
export enum PenaltySeverity {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4
}

/**
 * User status in the system
 */
export enum UserStatus {
  NORMAL = 'normal',
  WHITELISTED = 'whitelisted',
  WARNED = 'warned',
  TEMPORARILY_BLOCKED = 'temporarily_blocked',
  PERMANENTLY_BANNED = 'permanently_banned'
}

/**
 * Penalty record for tracking violations
 */
export interface PenaltyRecord {
  id: string;
  userId: string;
  type: PenaltyType;
  severity: PenaltySeverity;
  reason: string;
  issuedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  appealable: boolean;
  appealed: boolean;
  appealedAt?: Date;
  appealReason?: string;
  revokedAt?: Date;
  revokedBy?: string;
  revokedReason?: string;
  metadata?: Record<string, any>;
}

/**
 * User penalty status and history
 */
export interface UserPenaltyStatus {
  userId: string;
  status: UserStatus;
  isBlocked: boolean;
  isWhitelisted: boolean;
  currentPenalty?: PenaltyRecord;
  penaltyHistory: PenaltyRecord[];
  warningCount: number;
  blockCount: number;
  totalViolations: number;
  lastViolation?: Date;
  appealCount: number;
  nextPenaltyLevel: PenaltyType;
  blockedUntil?: Date;
}

/**
 * Escalation configuration for penalties
 */
export interface PenaltyEscalationConfig {
  /** Base timeout duration in seconds for first violation */
  baseTimeoutSeconds: number;
  /** Multiplier for each subsequent violation */
  escalationMultiplier: number;
  /** Maximum timeout duration in seconds */
  maxTimeoutSeconds: number;
  /** Number of violations before permanent ban */
  permanentBanThreshold: number;
  /** Time window in seconds for violation counting */
  violationWindowSeconds: number;
  /** Grace period in seconds before violations expire */
  violationGracePeriodSeconds: number;
  /** Whether appeals are allowed */
  allowAppeals: boolean;
  /** Maximum number of appeals per user */
  maxAppealsPerUser: number;
}

/**
 * Appeal request
 */
export interface AppealRequest {
  penaltyId: string;
  userId: string;
  reason: string;
  submittedAt: Date;
  status: 'pending' | 'approved' | 'denied';
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
}

/**
 * Progressive penalty management system
 */
export class PenaltyManager {
  private storage: RateLimitStorage;
  private fallbackStorage: MemoryRateLimitStorage;
  private config: PenaltyEscalationConfig;
  
  // In-memory caches
  private whitelist = new Set<string>();
  private blacklist = new Set<string>();
  private userStatusCache = new Map<string, UserPenaltyStatus>();
  private pendingAppeals = new Map<string, AppealRequest>();

  constructor(storage?: RateLimitStorage, config?: Partial<PenaltyEscalationConfig>) {
    this.fallbackStorage = new MemoryRateLimitStorage();
    this.storage = storage || new RedisRateLimitStorage();
    
    // Default escalation configuration
    this.config = {
      baseTimeoutSeconds: 300, // 5 minutes
      escalationMultiplier: 2,
      maxTimeoutSeconds: 86400, // 24 hours
      permanentBanThreshold: 5,
      violationWindowSeconds: 604800, // 7 days
      violationGracePeriodSeconds: 2592000, // 30 days
      allowAppeals: true,
      maxAppealsPerUser: 3,
      ...config
    };

    this.initializeDefaultLists();
  }

  /**
   * Initialize default whitelist and blacklist
   */
  private initializeDefaultLists(): void {
    // These could be loaded from configuration or database
    // For now, empty sets that can be populated via API
    logger().info('Penalty manager initialized with default empty whitelist/blacklist');
  }

  /**
   * Check if a user is allowed to proceed (not blocked or banned)
   */
  async isUserAllowed(userId: string): Promise<{
    allowed: boolean;
    status: UserStatus;
    reason?: string;
    blockedUntil?: Date;
  }> {
    try {
      // Check whitelist first - whitelisted users bypass all restrictions
      if (this.whitelist.has(userId)) {
        return {
          allowed: true,
          status: UserStatus.WHITELISTED
        };
      }

      // Check blacklist - permanently banned
      if (this.blacklist.has(userId)) {
        return {
          allowed: false,
          status: UserStatus.PERMANENTLY_BANNED,
          reason: 'User is permanently banned'
        };
      }

      // Get user penalty status
      const userStatus = await this.getUserPenaltyStatus(userId);
      
      if (!userStatus.isBlocked) {
        return {
          allowed: true,
          status: userStatus.status
        };
      }

      // User is blocked - check if block has expired
      if (userStatus.blockedUntil && userStatus.blockedUntil <= new Date()) {
        // Block has expired, clear it
        await this.clearExpiredPenalties(userId);
        return {
          allowed: true,
          status: UserStatus.NORMAL
        };
      }

      return {
        allowed: false,
        status: userStatus.status,
        reason: userStatus.currentPenalty?.reason || 'User is temporarily blocked',
        blockedUntil: userStatus.blockedUntil
      };

    } catch (error) {
      logger().error('Error checking user allowed status:', error);
      // Fail safe - allow user but log error
      return {
        allowed: true,
        status: UserStatus.NORMAL
      };
    }
  }

  /**
   * Apply penalty to a user based on violation severity
   */
  async applyPenalty(userId: string, reason: string, severity: PenaltySeverity, metadata?: Record<string, any>): Promise<PenaltyRecord> {
    try {
      // Don't penalize whitelisted users
      if (this.whitelist.has(userId)) {
        logger().info(`Skipping penalty for whitelisted user: ${userId}`);
        throw new Error('Cannot penalize whitelisted user');
      }

      // Get user's current status and history
      const userStatus = await this.getUserPenaltyStatus(userId);
      
      // Determine penalty type based on history and severity
      const penaltyType = this.determinePenaltyType(userStatus, severity);
      
      // Calculate penalty duration
      const duration = this.calculatePenaltyDuration(userStatus, penaltyType);
      
      // Create penalty record
      const penalty: PenaltyRecord = {
        id: this.generatePenaltyId(),
        userId,
        type: penaltyType,
        severity,
        reason,
        issuedAt: new Date(),
        expiresAt: duration > 0 ? new Date(Date.now() + duration * 1000) : undefined,
        isActive: true,
        appealable: this.config.allowAppeals && penaltyType !== PenaltyType.WARNING,
        appealed: false,
        metadata
      };

      // Store penalty
      await this.storePenalty(penalty);
      
      // Update user status
      await this.updateUserStatus(userId, penalty);
      
      // Handle permanent ban
      if (penaltyType === PenaltyType.PERMANENT_BAN) {
        this.blacklist.add(userId);
        await this.storeBlacklistStatus(userId, true);
      }

      logger().info(`Applied penalty to user ${userId}:`, {
        type: penaltyType,
        severity,
        reason,
        duration: duration > 0 ? `${duration}s` : 'permanent'
      });

      return penalty;

    } catch (error) {
      logger().error('Error applying penalty:', error);
      throw error;
    }
  }

  /**
   * Determine penalty type based on user history and current severity
   */
  private determinePenaltyType(userStatus: UserPenaltyStatus, severity: PenaltySeverity): PenaltyType {
    // Check if user should be permanently banned
    if (userStatus.totalViolations >= this.config.permanentBanThreshold) {
      return PenaltyType.PERMANENT_BAN;
    }

    // Escalate based on violation count and severity
    switch (severity) {
      case PenaltySeverity.CRITICAL:
        if (userStatus.blockCount >= 2) {
          return PenaltyType.PERMANENT_BAN;
        }
        return PenaltyType.EXTENDED_BLOCK;

      case PenaltySeverity.HIGH:
        if (userStatus.blockCount >= 1) {
          return PenaltyType.EXTENDED_BLOCK;
        }
        return PenaltyType.TEMPORARY_BLOCK;

      case PenaltySeverity.MEDIUM:
        if (userStatus.warningCount >= 2) {
          return PenaltyType.TEMPORARY_BLOCK;
        }
        return PenaltyType.WARNING;

      case PenaltySeverity.LOW:
      default:
        return PenaltyType.WARNING;
    }
  }

  /**
   * Calculate penalty duration in seconds
   */
  private calculatePenaltyDuration(userStatus: UserPenaltyStatus, penaltyType: PenaltyType): number {
    switch (penaltyType) {
      case PenaltyType.WARNING:
        return 0; // Warnings don't have duration
        
      case PenaltyType.TEMPORARY_BLOCK:
        return Math.min(
          this.config.baseTimeoutSeconds * Math.pow(this.config.escalationMultiplier, userStatus.blockCount),
          this.config.maxTimeoutSeconds
        );
        
      case PenaltyType.EXTENDED_BLOCK:
        return Math.min(
          this.config.baseTimeoutSeconds * Math.pow(this.config.escalationMultiplier, userStatus.blockCount + 2),
          this.config.maxTimeoutSeconds
        );
        
      case PenaltyType.PERMANENT_BAN:
      default:
        return 0; // Permanent bans don't expire
    }
  }

  /**
   * Add user to whitelist
   */
  async addToWhitelist(userId: string, reason?: string): Promise<void> {
    this.whitelist.add(userId);
    await this.storeWhitelistStatus(userId, true);
    
    // Clear any existing penalties
    await this.clearAllPenalties(userId);
    
    logger().info(`User ${userId} added to whitelist`, { reason });
  }

  /**
   * Remove user from whitelist
   */
  async removeFromWhitelist(userId: string): Promise<void> {
    this.whitelist.delete(userId);
    await this.storeWhitelistStatus(userId, false);
    logger().info(`User ${userId} removed from whitelist`);
  }

  /**
   * Add user to blacklist (permanent ban)
   */
  async addToBlacklist(userId: string, reason: string): Promise<void> {
    this.blacklist.add(userId);
    await this.storeBlacklistStatus(userId, true);
    
    // Apply permanent ban penalty
    await this.applyPenalty(userId, reason, PenaltySeverity.CRITICAL);
    
    logger().info(`User ${userId} added to blacklist`, { reason });
  }

  /**
   * Remove user from blacklist
   */
  async removeFromBlacklist(userId: string): Promise<void> {
    this.blacklist.delete(userId);
    await this.storeBlacklistStatus(userId, false);
    
    // Clear permanent ban penalty
    await this.clearAllPenalties(userId);
    
    logger().info(`User ${userId} removed from blacklist`);
  }

  /**
   * Submit an appeal for a penalty
   */
  async submitAppeal(penaltyId: string, userId: string, reason: string): Promise<AppealRequest> {
    const userStatus = await this.getUserPenaltyStatus(userId);
    
    // Check if user has exceeded appeal limit
    if (userStatus.appealCount >= this.config.maxAppealsPerUser) {
      throw new Error('User has exceeded maximum appeal limit');
    }

    // Check if penalty exists and is appealable
    const penalty = userStatus.penaltyHistory.find(p => p.id === penaltyId);
    if (!penalty) {
      throw new Error('Penalty not found');
    }

    if (!penalty.appealable) {
      throw new Error('Penalty is not appealable');
    }

    if (penalty.appealed) {
      throw new Error('Penalty has already been appealed');
    }

    const appeal: AppealRequest = {
      penaltyId,
      userId,
      reason,
      submittedAt: new Date(),
      status: 'pending'
    };

    this.pendingAppeals.set(penaltyId, appeal);
    
    // Mark penalty as appealed
    penalty.appealed = true;
    penalty.appealedAt = new Date();
    penalty.appealReason = reason;
    
    await this.storePenalty(penalty);

    logger().info(`Appeal submitted for penalty ${penaltyId} by user ${userId}`);
    return appeal;
  }

  /**
   * Review an appeal
   */
  async reviewAppeal(penaltyId: string, approved: boolean, reviewedBy: string, reviewNotes?: string): Promise<void> {
    const appeal = this.pendingAppeals.get(penaltyId);
    if (!appeal) {
      throw new Error('Appeal not found');
    }

    appeal.status = approved ? 'approved' : 'denied';
    appeal.reviewedBy = reviewedBy;
    appeal.reviewedAt = new Date();
    appeal.reviewNotes = reviewNotes;

    if (approved) {
      // Revoke the penalty
      await this.revokePenalty(penaltyId, reviewedBy, 'Appeal approved');
    }

    this.pendingAppeals.delete(penaltyId);
    logger().info(`Appeal ${approved ? 'approved' : 'denied'} for penalty ${penaltyId} by ${reviewedBy}`);
  }

  /**
   * Revoke a penalty
   */
  async revokePenalty(penaltyId: string, revokedBy: string, reason: string): Promise<void> {
    // This would typically update the penalty in storage
    // For now, we'll update our cache
    for (const [userId, userStatus] of this.userStatusCache) {
      const penalty = userStatus.penaltyHistory.find(p => p.id === penaltyId);
      if (penalty) {
        penalty.isActive = false;
        penalty.revokedAt = new Date();
        penalty.revokedBy = revokedBy;
        penalty.revokedReason = reason;
        
        // Update user status if this was the current penalty
        if (userStatus.currentPenalty?.id === penaltyId) {
          userStatus.currentPenalty = undefined;
          userStatus.isBlocked = false;
          userStatus.status = UserStatus.NORMAL;
        }
        
        await this.storePenalty(penalty);
        break;
      }
    }
    
    logger().info(`Penalty ${penaltyId} revoked by ${revokedBy}`, { reason });
  }

  /**
   * Get user penalty status
   */
  async getUserPenaltyStatus(userId: string): Promise<UserPenaltyStatus> {
    // Check cache first
    let userStatus = this.userStatusCache.get(userId);
    
    if (!userStatus) {
      // Load from storage or create new
      userStatus = await this.loadUserPenaltyStatus(userId);
      this.userStatusCache.set(userId, userStatus);
    }

    return userStatus;
  }

  /**
   * Load user penalty status from storage
   */
  private async loadUserPenaltyStatus(userId: string): Promise<UserPenaltyStatus> {
    // In a full implementation, this would load from Redis/database
    // For now, return default status
    return {
      userId,
      status: UserStatus.NORMAL,
      isBlocked: false,
      isWhitelisted: this.whitelist.has(userId),
      penaltyHistory: [],
      warningCount: 0,
      blockCount: 0,
      totalViolations: 0,
      appealCount: 0,
      nextPenaltyLevel: PenaltyType.WARNING
    };
  }

  /**
   * Update user status after applying penalty
   */
  private async updateUserStatus(userId: string, penalty: PenaltyRecord): Promise<void> {
    const userStatus = await this.getUserPenaltyStatus(userId);
    
    // Add penalty to history
    userStatus.penaltyHistory.push(penalty);
    userStatus.totalViolations++;
    userStatus.lastViolation = penalty.issuedAt;
    
    // Update counters
    if (penalty.type === PenaltyType.WARNING) {
      userStatus.warningCount++;
    } else if (penalty.type === PenaltyType.TEMPORARY_BLOCK || penalty.type === PenaltyType.EXTENDED_BLOCK) {
      userStatus.blockCount++;
    }

    // Update current status
    if (penalty.type !== PenaltyType.WARNING) {
      userStatus.currentPenalty = penalty;
      userStatus.isBlocked = true;
      userStatus.blockedUntil = penalty.expiresAt;
      
      switch (penalty.type) {
        case PenaltyType.TEMPORARY_BLOCK:
        case PenaltyType.EXTENDED_BLOCK:
          userStatus.status = UserStatus.TEMPORARILY_BLOCKED;
          break;
        case PenaltyType.PERMANENT_BAN:
          userStatus.status = UserStatus.PERMANENTLY_BANNED;
          break;
      }
    } else {
      userStatus.status = UserStatus.WARNED;
    }

    // Determine next penalty level
    userStatus.nextPenaltyLevel = this.determinePenaltyType(userStatus, PenaltySeverity.MEDIUM);
    
    this.userStatusCache.set(userId, userStatus);
  }

  /**
   * Clear expired penalties for a user
   */
  private async clearExpiredPenalties(userId: string): Promise<void> {
    const userStatus = await this.getUserPenaltyStatus(userId);
    
    if (userStatus.currentPenalty && userStatus.currentPenalty.expiresAt && userStatus.currentPenalty.expiresAt <= new Date()) {
      userStatus.currentPenalty.isActive = false;
      userStatus.currentPenalty = undefined;
      userStatus.isBlocked = false;
      userStatus.status = UserStatus.NORMAL;
      userStatus.blockedUntil = undefined;
      
      this.userStatusCache.set(userId, userStatus);
      logger().info(`Cleared expired penalty for user ${userId}`);
    }
  }

  /**
   * Clear all penalties for a user
   */
  private async clearAllPenalties(userId: string): Promise<void> {
    const userStatus = await this.getUserPenaltyStatus(userId);
    
    // Deactivate all penalties
    for (const penalty of userStatus.penaltyHistory) {
      penalty.isActive = false;
      penalty.revokedAt = new Date();
      penalty.revokedBy = 'system';
      penalty.revokedReason = 'Cleared by admin action';
    }
    
    userStatus.currentPenalty = undefined;
    userStatus.isBlocked = false;
    userStatus.status = UserStatus.NORMAL;
    userStatus.blockedUntil = undefined;
    
    this.userStatusCache.set(userId, userStatus);
  }

  /**
   * Store penalty record
   */
  private async storePenalty(penalty: PenaltyRecord): Promise<void> {
    // In a full implementation, this would store in Redis/database
    // For now, just log
    logger().debug(`Storing penalty record: ${penalty.id}`);
  }

  /**
   * Store whitelist status
   */
  private async storeWhitelistStatus(userId: string, isWhitelisted: boolean): Promise<void> {
    const activeStorage = this.getActiveStorage();
    const key = `whitelist:${userId}`;
    
    if (isWhitelisted) {
      await activeStorage.setWindowStart(key, Date.now(), 86400 * 365); // 1 year expiry
    } else {
      await activeStorage.reset(key);
    }
  }

  /**
   * Store blacklist status
   */
  private async storeBlacklistStatus(userId: string, isBlacklisted: boolean): Promise<void> {
    const activeStorage = this.getActiveStorage();
    const key = `blacklist:${userId}`;
    
    if (isBlacklisted) {
      await activeStorage.setWindowStart(key, Date.now(), 86400 * 365); // 1 year expiry
    } else {
      await activeStorage.reset(key);
    }
  }

  /**
   * Generate unique penalty ID
   */
  private generatePenaltyId(): string {
    return `penalty_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get active storage backend
   */
  private getActiveStorage(): RateLimitStorage {
    if (this.storage.isAvailable()) {
      return this.storage;
    }
    return this.fallbackStorage;
  }

  /**
   * Get configuration
   */
  getConfig(): PenaltyEscalationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PenaltyEscalationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger().info('Penalty manager configuration updated', this.config);
  }

  /**
   * Get whitelist
   */
  getWhitelist(): string[] {
    return Array.from(this.whitelist);
  }

  /**
   * Get blacklist
   */
  getBlacklist(): string[] {
    return Array.from(this.blacklist);
  }

  /**
   * Get pending appeals
   */
  getPendingAppeals(): AppealRequest[] {
    return Array.from(this.pendingAppeals.values());
  }

  /**
   * Get system statistics
   */
  getStatistics(): {
    totalWhitelisted: number;
    totalBlacklisted: number;
    totalPendingAppeals: number;
    totalActiveUsers: number;
    penaltyBreakdown: Record<PenaltyType, number>;
  } {
    const penaltyBreakdown: Record<PenaltyType, number> = {
      [PenaltyType.WARNING]: 0,
      [PenaltyType.TEMPORARY_BLOCK]: 0,
      [PenaltyType.EXTENDED_BLOCK]: 0,
      [PenaltyType.PERMANENT_BAN]: 0
    };

    for (const userStatus of this.userStatusCache.values()) {
      if (userStatus.currentPenalty?.isActive) {
        penaltyBreakdown[userStatus.currentPenalty.type]++;
      }
    }

    return {
      totalWhitelisted: this.whitelist.size,
      totalBlacklisted: this.blacklist.size,
      totalPendingAppeals: this.pendingAppeals.size,
      totalActiveUsers: this.userStatusCache.size,
      penaltyBreakdown
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.whitelist.clear();
    this.blacklist.clear();
    this.userStatusCache.clear();
    this.pendingAppeals.clear();
    
    this.fallbackStorage.cleanup();
    
    if (this.storage instanceof RedisRateLimitStorage) {
      await this.storage.disconnect();
    }
  }
}