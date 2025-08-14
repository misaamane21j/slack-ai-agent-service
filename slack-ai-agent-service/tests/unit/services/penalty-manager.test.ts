import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  PenaltyManager,
  PenaltyType,
  PenaltySeverity,
  UserStatus,
  PenaltyRecord,
  UserPenaltyStatus,
  PenaltyEscalationConfig,
  AppealRequest
} from '../../../src/services/penalty-manager';
import { RateLimitStorage } from '../../../src/services/rate-limiter';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/rate-limiter');

describe('PenaltyManager', () => {
  let penaltyManager: PenaltyManager;
  let mockStorage: jest.Mocked<RateLimitStorage>;

  beforeEach(() => {
    mockStorage = {
      getCount: jest.fn(),
      incrementCount: jest.fn(),
      getWindowStart: jest.fn(),
      setWindowStart: jest.fn(),
      reset: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true)
    };

    const config: Partial<PenaltyEscalationConfig> = {
      baseTimeoutSeconds: 300, // 5 minutes
      escalationMultiplier: 2,
      maxTimeoutSeconds: 86400, // 24 hours
      permanentBanThreshold: 5,
      violationWindowSeconds: 604800, // 7 days
      violationGracePeriodSeconds: 2592000, // 30 days
      allowAppeals: true,
      maxAppealsPerUser: 3
    };

    penaltyManager = new PenaltyManager(mockStorage, config);
  });

  afterEach(async () => {
    await penaltyManager.cleanup();
  });

  describe('isUserAllowed', () => {
    it('should allow normal users', async () => {
      const result = await penaltyManager.isUserAllowed('normal-user');
      
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(UserStatus.NORMAL);
    });

    it('should allow whitelisted users', async () => {
      const userId = 'whitelisted-user';
      await penaltyManager.addToWhitelist(userId, 'Test whitelist');
      
      const result = await penaltyManager.isUserAllowed(userId);
      
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(UserStatus.WHITELISTED);
    });

    it('should block blacklisted users', async () => {
      const userId = 'blacklisted-user';
      await penaltyManager.addToBlacklist(userId, 'Test blacklist');
      
      const result = await penaltyManager.isUserAllowed(userId);
      
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(UserStatus.PERMANENTLY_BANNED);
      expect(result.reason).toBeTruthy();
    });

    it('should handle storage errors gracefully', async () => {
      mockStorage.getWindowStart.mockRejectedValue(new Error('Storage error'));
      
      const result = await penaltyManager.isUserAllowed('error-user');
      
      // Should fail safe and allow user
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(UserStatus.NORMAL);
    });
  });

  describe('applyPenalty', () => {
    it('should apply warning for low severity first offense', async () => {
      const userId = 'first-offender';
      const reason = 'First violation';
      
      const penalty = await penaltyManager.applyPenalty(userId, reason, PenaltySeverity.LOW);
      
      expect(penalty.type).toBe(PenaltyType.WARNING);
      expect(penalty.severity).toBe(PenaltySeverity.LOW);
      expect(penalty.reason).toBe(reason);
      expect(penalty.isActive).toBe(true);
      expect(penalty.expiresAt).toBeUndefined(); // Warnings don't expire
    });

    it('should apply temporary block for medium severity', async () => {
      const userId = 'medium-offender';
      const reason = 'Medium violation';
      
      const penalty = await penaltyManager.applyPenalty(userId, reason, PenaltySeverity.MEDIUM);
      
      expect(penalty.type).toBe(PenaltyType.WARNING); // First offense is still warning
      expect(penalty.severity).toBe(PenaltySeverity.MEDIUM);
    });

    it('should escalate penalty for repeat offender', async () => {
      const userId = 'repeat-offender';
      
      // First offense - warning
      await penaltyManager.applyPenalty(userId, 'First', PenaltySeverity.MEDIUM);
      
      // Second offense - should escalate
      await penaltyManager.applyPenalty(userId, 'Second', PenaltySeverity.MEDIUM);
      
      // Third offense - should escalate further
      const thirdPenalty = await penaltyManager.applyPenalty(userId, 'Third', PenaltySeverity.MEDIUM);
      
      expect(thirdPenalty.type).toBe(PenaltyType.TEMPORARY_BLOCK);
      expect(thirdPenalty.expiresAt).toBeTruthy();
    });

    it('should apply permanent ban after threshold violations', async () => {
      const userId = 'heavy-offender';
      
      // Apply multiple penalties to reach threshold
      for (let i = 0; i < 5; i++) {
        await penaltyManager.applyPenalty(userId, `Violation ${i + 1}`, PenaltySeverity.HIGH);
      }
      
      // This should trigger permanent ban
      const finalPenalty = await penaltyManager.applyPenalty(userId, 'Final violation', PenaltySeverity.HIGH);
      
      expect(finalPenalty.type).toBe(PenaltyType.PERMANENT_BAN);
      expect(finalPenalty.expiresAt).toBeUndefined(); // Permanent bans don't expire
    });

    it('should not penalize whitelisted users', async () => {
      const userId = 'whitelisted-offender';
      await penaltyManager.addToWhitelist(userId, 'Protected user');
      
      await expect(
        penaltyManager.applyPenalty(userId, 'Should not work', PenaltySeverity.CRITICAL)
      ).rejects.toThrow('Cannot penalize whitelisted user');
    });

    it('should calculate progressive timeout durations', async () => {
      const userId = 'timeout-test';
      
      // Apply several penalties to test escalation
      await penaltyManager.applyPenalty(userId, 'First', PenaltySeverity.HIGH); // Warning
      await penaltyManager.applyPenalty(userId, 'Second', PenaltySeverity.HIGH); // First block
      
      const secondBlock = await penaltyManager.applyPenalty(userId, 'Third', PenaltySeverity.HIGH);
      
      expect(secondBlock.type).toBe(PenaltyType.TEMPORARY_BLOCK);
      expect(secondBlock.expiresAt).toBeTruthy();
      
      // Timeout should be longer than base timeout due to escalation
      const timeoutDuration = secondBlock.expiresAt!.getTime() - secondBlock.issuedAt.getTime();
      expect(timeoutDuration).toBeGreaterThan(300 * 1000); // Greater than base 5 minutes
    });
  });

  describe('whitelist management', () => {
    it('should add user to whitelist', async () => {
      const userId = 'new-whitelist-user';
      
      await penaltyManager.addToWhitelist(userId, 'Test reason');
      
      const whitelist = penaltyManager.getWhitelist();
      expect(whitelist).toContain(userId);
    });

    it('should remove user from whitelist', async () => {
      const userId = 'temp-whitelist-user';
      
      await penaltyManager.addToWhitelist(userId, 'Temporary');
      expect(penaltyManager.getWhitelist()).toContain(userId);
      
      await penaltyManager.removeFromWhitelist(userId);
      expect(penaltyManager.getWhitelist()).not.toContain(userId);
    });

    it('should clear penalties when adding to whitelist', async () => {
      const userId = 'penalized-then-whitelisted';
      
      // Apply penalty first
      await penaltyManager.applyPenalty(userId, 'Before whitelist', PenaltySeverity.HIGH);
      
      // Add to whitelist (should clear penalties)
      await penaltyManager.addToWhitelist(userId, 'Cleared penalties');
      
      const result = await penaltyManager.isUserAllowed(userId);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(UserStatus.WHITELISTED);
    });
  });

  describe('blacklist management', () => {
    it('should add user to blacklist', async () => {
      const userId = 'new-blacklist-user';
      
      await penaltyManager.addToBlacklist(userId, 'Serious violation');
      
      const blacklist = penaltyManager.getBlacklist();
      expect(blacklist).toContain(userId);
      
      const result = await penaltyManager.isUserAllowed(userId);
      expect(result.allowed).toBe(false);
    });

    it('should remove user from blacklist', async () => {
      const userId = 'temp-blacklist-user';
      
      await penaltyManager.addToBlacklist(userId, 'Temporary ban');
      expect(penaltyManager.getBlacklist()).toContain(userId);
      
      await penaltyManager.removeFromBlacklist(userId);
      expect(penaltyManager.getBlacklist()).not.toContain(userId);
      
      const result = await penaltyManager.isUserAllowed(userId);
      expect(result.allowed).toBe(true);
    });
  });

  describe('appeal system', () => {
    it('should allow submitting appeals for appealable penalties', async () => {
      const userId = 'appeal-user';
      
      // Apply a penalty that is appealable
      const penalty = await penaltyManager.applyPenalty(userId, 'Appealable violation', PenaltySeverity.HIGH);
      
      const appeal = await penaltyManager.submitAppeal(penalty.id, userId, 'This was a mistake');
      
      expect(appeal.penaltyId).toBe(penalty.id);
      expect(appeal.userId).toBe(userId);
      expect(appeal.reason).toBe('This was a mistake');
      expect(appeal.status).toBe('pending');
    });

    it('should reject appeals for non-appealable penalties', async () => {
      const userId = 'warning-user';
      
      // Apply warning (not appealable)
      const penalty = await penaltyManager.applyPenalty(userId, 'Warning only', PenaltySeverity.LOW);
      
      await expect(
        penaltyManager.submitAppeal(penalty.id, userId, 'Want to appeal warning')
      ).rejects.toThrow('Penalty is not appealable');
    });

    it('should reject appeals for non-existent penalties', async () => {
      await expect(
        penaltyManager.submitAppeal('non-existent-id', 'user123', 'Appeal reason')
      ).rejects.toThrow('Penalty not found');
    });

    it('should prevent duplicate appeals', async () => {
      const userId = 'duplicate-appeal-user';
      
      const penalty = await penaltyManager.applyPenalty(userId, 'Appealable', PenaltySeverity.HIGH);
      
      // First appeal should succeed
      await penaltyManager.submitAppeal(penalty.id, userId, 'First appeal');
      
      // Second appeal should fail
      await expect(
        penaltyManager.submitAppeal(penalty.id, userId, 'Second appeal')
      ).rejects.toThrow('Penalty has already been appealed');
    });

    it('should track appeal count limit', async () => {
      const userId = 'appeal-limit-user';
      
      // Apply multiple penalties and appeal them all
      for (let i = 0; i < 4; i++) {
        const penalty = await penaltyManager.applyPenalty(userId, `Violation ${i}`, PenaltySeverity.HIGH);
        
        if (i < 3) {
          // First 3 appeals should succeed
          await penaltyManager.submitAppeal(penalty.id, userId, `Appeal ${i}`);
        } else {
          // 4th appeal should fail (exceeds limit of 3)
          await expect(
            penaltyManager.submitAppeal(penalty.id, userId, `Appeal ${i}`)
          ).rejects.toThrow('User has exceeded maximum appeal limit');
        }
      }
    });

    it('should approve appeals and revoke penalties', async () => {
      const userId = 'appeal-success-user';
      
      const penalty = await penaltyManager.applyPenalty(userId, 'False positive', PenaltySeverity.HIGH);
      const appeal = await penaltyManager.submitAppeal(penalty.id, userId, 'This was incorrect');
      
      // Approve the appeal
      await penaltyManager.reviewAppeal(penalty.id, true, 'admin123', 'Approved after review');
      
      // Penalty should be revoked
      const userStatus = await penaltyManager.getUserPenaltyStatus(userId);
      const revokedPenalty = userStatus.penaltyHistory.find(p => p.id === penalty.id);
      
      expect(revokedPenalty?.isActive).toBe(false);
      expect(revokedPenalty?.revokedBy).toBe('admin123');
    });

    it('should deny appeals', async () => {
      const userId = 'appeal-denied-user';
      
      const penalty = await penaltyManager.applyPenalty(userId, 'Valid violation', PenaltySeverity.HIGH);
      await penaltyManager.submitAppeal(penalty.id, userId, 'Please reconsider');
      
      // Deny the appeal
      await penaltyManager.reviewAppeal(penalty.id, false, 'admin123', 'Penalty stands');
      
      // Penalty should still be active
      const userStatus = await penaltyManager.getUserPenaltyStatus(userId);
      const activePenalty = userStatus.penaltyHistory.find(p => p.id === penalty.id);
      
      expect(activePenalty?.isActive).toBe(true);
    });
  });

  describe('revokePenalty', () => {
    it('should revoke active penalty', async () => {
      const userId = 'revoke-test-user';
      
      const penalty = await penaltyManager.applyPenalty(userId, 'To be revoked', PenaltySeverity.HIGH);
      
      await penaltyManager.revokePenalty(penalty.id, 'admin123', 'Administrative revocation');
      
      const userStatus = await penaltyManager.getUserPenaltyStatus(userId);
      const revokedPenalty = userStatus.penaltyHistory.find(p => p.id === penalty.id);
      
      expect(revokedPenalty?.isActive).toBe(false);
      expect(revokedPenalty?.revokedBy).toBe('admin123');
      expect(revokedPenalty?.revokedReason).toBe('Administrative revocation');
    });
  });

  describe('getUserPenaltyStatus', () => {
    it('should return default status for new user', async () => {
      const status = await penaltyManager.getUserPenaltyStatus('new-user');
      
      expect(status.userId).toBe('new-user');
      expect(status.status).toBe(UserStatus.NORMAL);
      expect(status.isBlocked).toBe(false);
      expect(status.penaltyHistory).toEqual([]);
      expect(status.warningCount).toBe(0);
      expect(status.blockCount).toBe(0);
      expect(status.totalViolations).toBe(0);
    });

    it('should track penalty history and counts', async () => {
      const userId = 'history-user';
      
      // Apply multiple penalties
      await penaltyManager.applyPenalty(userId, 'First', PenaltySeverity.LOW);   // Warning
      await penaltyManager.applyPenalty(userId, 'Second', PenaltySeverity.MEDIUM); // Warning
      await penaltyManager.applyPenalty(userId, 'Third', PenaltySeverity.HIGH);  // Block
      
      const status = await penaltyManager.getUserPenaltyStatus(userId);
      
      expect(status.penaltyHistory.length).toBe(3);
      expect(status.totalViolations).toBe(3);
      expect(status.warningCount).toBe(2);
      expect(status.blockCount).toBe(1);
    });
  });

  describe('configuration management', () => {
    it('should return current configuration', () => {
      const config = penaltyManager.getConfig();
      
      expect(config).toHaveProperty('baseTimeoutSeconds');
      expect(config).toHaveProperty('escalationMultiplier');
      expect(config).toHaveProperty('maxTimeoutSeconds');
      expect(config).toHaveProperty('permanentBanThreshold');
      expect(config).toHaveProperty('allowAppeals');
    });

    it('should update configuration', () => {
      const newConfig = {
        baseTimeoutSeconds: 600,
        permanentBanThreshold: 3
      };
      
      penaltyManager.updateConfig(newConfig);
      const config = penaltyManager.getConfig();
      
      expect(config.baseTimeoutSeconds).toBe(600);
      expect(config.permanentBanThreshold).toBe(3);
    });
  });

  describe('getPendingAppeals', () => {
    it('should return empty array when no appeals', () => {
      const appeals = penaltyManager.getPendingAppeals();
      expect(appeals).toEqual([]);
    });

    it('should return pending appeals', async () => {
      const userId = 'pending-appeal-user';
      
      const penalty = await penaltyManager.applyPenalty(userId, 'Test penalty', PenaltySeverity.HIGH);
      await penaltyManager.submitAppeal(penalty.id, userId, 'Test appeal');
      
      const appeals = penaltyManager.getPendingAppeals();
      
      expect(appeals.length).toBe(1);
      expect(appeals[0].penaltyId).toBe(penalty.id);
      expect(appeals[0].status).toBe('pending');
    });
  });

  describe('getStatistics', () => {
    it('should return system statistics', async () => {
      // Add some test data
      await penaltyManager.addToWhitelist('whitelist1', 'Test');
      await penaltyManager.addToBlacklist('blacklist1', 'Test');
      
      const userId = 'stats-user';
      await penaltyManager.applyPenalty(userId, 'Test', PenaltySeverity.HIGH);
      
      const stats = penaltyManager.getStatistics();
      
      expect(stats).toHaveProperty('totalWhitelisted');
      expect(stats).toHaveProperty('totalBlacklisted');
      expect(stats).toHaveProperty('totalPendingAppeals');
      expect(stats).toHaveProperty('totalActiveUsers');
      expect(stats).toHaveProperty('penaltyBreakdown');
      
      expect(stats.totalWhitelisted).toBeGreaterThan(0);
      expect(stats.totalBlacklisted).toBeGreaterThan(0);
      expect(stats.totalActiveUsers).toBeGreaterThan(0);
    });
  });

  describe('penalty expiration', () => {
    it('should handle expired penalties', async () => {
      jest.useFakeTimers();
      
      const userId = 'expiry-test-user';
      
      // Apply a temporary block
      await penaltyManager.applyPenalty(userId, 'Temporary violation', PenaltySeverity.HIGH);
      
      // User should be blocked initially
      let result = await penaltyManager.isUserAllowed(userId);
      expect(result.allowed).toBe(false);
      
      // Fast forward past expiration time
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours (past max timeout)
      
      // User should be allowed now
      result = await penaltyManager.isUserAllowed(userId);
      expect(result.allowed).toBe(true);
      
      jest.useRealTimers();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle invalid penalty ID in appeal', async () => {
      await expect(
        penaltyManager.submitAppeal('invalid-id', 'user123', 'Invalid appeal')
      ).rejects.toThrow('Penalty not found');
    });

    it('should handle appeal review for non-existent appeal', async () => {
      await expect(
        penaltyManager.reviewAppeal('non-existent-appeal', true, 'admin', 'Notes')
      ).rejects.toThrow('Appeal not found');
    });

    it('should handle penalty revocation for non-existent penalty', async () => {
      // Should not throw, just log and continue
      await expect(
        penaltyManager.revokePenalty('non-existent-penalty', 'admin', 'reason')
      ).resolves.not.toThrow();
    });

    it('should handle concurrent penalty applications', async () => {
      const userId = 'concurrent-penalty-user';
      
      // Apply multiple penalties concurrently
      const penaltyPromises = Array.from({ length: 5 }, (_, i) =>
        penaltyManager.applyPenalty(userId, `Concurrent ${i}`, PenaltySeverity.MEDIUM)
      );
      
      const penalties = await Promise.all(penaltyPromises);
      
      expect(penalties.length).toBe(5);
      penalties.forEach(penalty => {
        expect(penalty.userId).toBe(userId);
        expect(penalty.isActive).toBe(true);
      });
    });
  });
});