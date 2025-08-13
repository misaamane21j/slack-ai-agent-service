# Network Security Configuration Guide

This document provides comprehensive guidance for configuring and deploying the enterprise-grade network security system for the Slack AI Agent Service.

## Overview

The Network Security System provides:
- IP whitelisting with CIDR range support
- Rate limiting with customizable policies
- TLS/HTTPS enforcement
- Security event logging and monitoring
- Firewall integration capabilities
- Real-time threat detection and alerting

## Quick Start

### Basic Setup

```typescript
import express from 'express';
import { setupNetworkSecurity } from './src/middleware';

const app = express();

// Apply balanced security mode (recommended for most deployments)
const securitySystem = setupNetworkSecurity({
  app,
  mode: 'balanced', // 'strict' | 'balanced' | 'permissive'
});

app.listen(3000);
```

### Environment Variables

```bash
# Global Security Settings
SECURITY_ENABLED=true
SECURITY_MODE=balanced
SECURITY_ALLOW_LOCALHOST=true
SECURITY_ALLOW_PRIVATE=false

# IP Whitelisting
IP_WHITELIST_ENABLED=false
IP_WHITELIST_IPS="192.168.1.100,10.0.0.50"
IP_WHITELIST_RANGES="192.168.1.0/24,10.0.0.0/16"
IP_WHITELIST_ACTION=block
IP_WHITELIST_MESSAGE="Access denied: IP not authorized"

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_DELAY_MS=0

# TLS/HTTPS
TLS_ENFORCE_HTTPS=false
TLS_MIN_VERSION=1.2
TLS_ENABLE_HSTS=false

# Security Logging
SECURITY_LOGGING_ENABLED=true
SECURITY_LOGGING_LEVEL=info
```

## Security Modes

### Strict Mode
```typescript
// Maximum security for production environments
const securitySystem = setupNetworkSecurity({
  app,
  mode: 'strict',
  config: {
    ipWhitelist: {
      enabled: true,
      allowedRanges: ['192.168.1.0/24', '10.0.0.0/16'],
    },
  },
});
```

**Strict Mode Features:**
- IP whitelisting enabled by default
- Rate limiting: 50 requests/minute
- HTTPS enforcement required
- TLS 1.3 minimum
- HSTS enabled
- Firewall auto-blocking enabled
- High-sensitivity logging

### Balanced Mode
```typescript
// Recommended for most deployments
const securitySystem = setupNetworkSecurity({
  app,
  mode: 'balanced', // Default
});
```

**Balanced Mode Features:**
- IP whitelisting configurable via environment
- Rate limiting: 100 requests/minute
- HTTPS enforcement optional
- TLS 1.2 minimum
- Manual firewall configuration
- Standard logging

### Permissive Mode
```typescript
// Development and testing environments
const securitySystem = setupNetworkSecurity({
  app,
  mode: 'permissive',
});
```

**Permissive Mode Features:**
- IP whitelisting disabled (log-only)
- Rate limiting: 1000 requests/minute
- HTTPS not enforced
- TLS 1.1 minimum
- Firewall disabled
- Warning-level logging only

## Component Configuration

### IP Whitelisting

#### Basic Configuration
```typescript
const securitySystem = createNetworkSecuritySystem({
  ipWhitelist: {
    enabled: true,
    allowedIPs: ['192.168.1.100', '10.0.0.50'],
    allowedRanges: ['192.168.1.0/24', '10.0.0.0/16'],
    defaultAction: 'block', // 'block' | 'log' | 'warn'
    rejectionMessage: 'Access denied: IP not authorized',
    trustProxy: true,
    proxyHeaders: ['x-forwarded-for', 'x-real-ip'],
  },
});
```

#### Dynamic IP Management
```typescript
// Add IPs at runtime
securitySystem.ipWhitelistMiddleware?.addAllowedIP('203.0.113.50');
securitySystem.ipWhitelistMiddleware?.addAllowedRange('203.0.113.0/24');

// Remove IPs at runtime
securitySystem.ipWhitelistMiddleware?.removeAllowedIP('192.168.1.200');
```

#### CIDR Range Examples
```typescript
// IPv4 ranges
'192.168.1.0/24'     // 192.168.1.1 - 192.168.1.254
'10.0.0.0/8'         // 10.0.0.1 - 10.255.255.254
'172.16.0.0/12'      // 172.16.0.1 - 172.31.255.254

// IPv6 ranges
'2001:db8::/32'      // IPv6 subnet
'::1/128'            // IPv6 localhost
```

### Rate Limiting

#### Basic Configuration
```typescript
const securitySystem = createNetworkSecuritySystem({
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    delayMs: 0, // No delay between requests
    skipWhitelisted: true,
    message: 'Too many requests, please try again later',
    headers: {
      includeRemaining: true,
      includeResetTime: true,
      includeRetryAfter: true,
    },
  },
});
```

#### Advanced Rate Limiting
```typescript
// Custom key generator (e.g., rate limit by user ID)
const rateLimitMiddleware = createRateLimitingMiddleware({
  maxRequests: 50,
  windowMs: 60000,
  keyGenerator: (req) => {
    return `user:${req.user?.id || req.ip}`;
  },
  skipPaths: ['/health', '/metrics'],
});

// Custom response handler
const rateLimitMiddleware = createRateLimitingMiddleware({
  maxRequests: 100,
  windowMs: 60000,
  responseHandler: (req, res, result) => {
    if (!result.allowed) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: result.retryAfter,
        limit: result.limit,
        remaining: result.remaining,
      });
    }
  },
});
```

### TLS/HTTPS Enforcement

#### Basic Configuration
```typescript
const securitySystem = createNetworkSecuritySystem({
  tls: {
    enforceHTTPS: true,
    minVersion: '1.2', // '1.0' | '1.1' | '1.2' | '1.3'
    certificateValidation: 'strict', // 'strict' | 'permissive' | 'disabled'
    enableHSTS: true,
    hstsMaxAge: 31536000, // 1 year in seconds
    hstsIncludeSubdomains: true,
  },
});
```

#### Custom Security Headers
```typescript
// The TLS middleware automatically sets these headers:
// - Strict-Transport-Security (if HSTS enabled)
// - X-Content-Type-Options: nosniff
// - X-Frame-Options: DENY
// - X-XSS-Protection: 1; mode=block
// - Referrer-Policy: strict-origin-when-cross-origin
// - Content-Security-Policy: default-src 'self'
```

### Security Event Monitoring

#### Basic Configuration
```typescript
const securitySystem = createNetworkSecuritySystem({
  logging: {
    enabled: true,
    level: 'info', // 'debug' | 'info' | 'warn' | 'error'
    includeRequestDetails: true,
    includeResponseDetails: false,
    logFile: './logs/security.log',
    alerting: {
      enabled: true,
      threshold: 50, // Events per minute
      cooldownMinutes: 15,
    },
  },
});
```

#### Custom Event Processing
```typescript
const securityMonitor = createSecurityMonitor({
  enabled: true,
  level: 'info',
  eventProcessors: [
    async (event) => {
      // Send to external SIEM system
      await sendToSIEM(event);
    },
    async (event) => {
      // Update threat intelligence database
      if (event.severity === 'critical') {
        await updateThreatDB(event.clientIP, event.type);
      }
    },
  ],
  alertHandlers: [
    async (alert) => {
      // Send email notification
      await sendEmailAlert(alert);
    },
    async (alert) => {
      // Send Slack notification
      await sendSlackAlert(alert);
    },
  ],
});
```

## Firewall Integration

### Supported Firewall Types

#### iptables (Linux)
```typescript
const securitySystem = createNetworkSecuritySystem({
  firewall: {
    enabled: true,
    type: 'iptables',
    autoBlock: {
      enabled: true,
      failureThreshold: 10,
      windowMs: 300000, // 5 minutes
      blockDurationMs: 3600000, // 1 hour
      maxBlockedIPs: 1000,
    },
  },
});
```

**Automatic iptables commands:**
```bash
# Block IP
iptables -I INPUT -s 203.0.113.50 -j DROP

# Unblock IP
iptables -D INPUT -s 203.0.113.50 -j DROP

# List blocked IPs
iptables -L INPUT -n | grep DROP
```

#### UFW (Ubuntu Firewall)
```typescript
const securitySystem = createNetworkSecuritySystem({
  firewall: {
    enabled: true,
    type: 'ufw',
    autoBlock: {
      enabled: true,
      failureThreshold: 5,
      windowMs: 300000,
      blockDurationMs: 1800000, // 30 minutes
    },
  },
});
```

**Automatic UFW commands:**
```bash
# Block IP
ufw insert 1 deny from 203.0.113.50

# Unblock IP
ufw delete deny from 203.0.113.50

# List rules
ufw status numbered
```

#### Windows Firewall
```typescript
const securitySystem = createNetworkSecuritySystem({
  firewall: {
    enabled: true,
    type: 'windows',
    autoBlock: {
      enabled: true,
      failureThreshold: 10,
      windowMs: 300000,
      blockDurationMs: 3600000,
    },
  },
});
```

**Automatic Windows commands:**
```cmd
REM Block IP
netsh advfirewall firewall add rule name="Block 203.0.113.50" dir=in action=block remoteip=203.0.113.50

REM Unblock IP
netsh advfirewall firewall delete rule name="Block 203.0.113.50"
```

#### Custom Firewall Commands
```typescript
const securitySystem = createNetworkSecuritySystem({
  firewall: {
    enabled: true,
    type: 'custom',
    customCommands: {
      block: 'firewall-cmd --add-rich-rule="rule source address="{IP}" reject"',
      unblock: 'firewall-cmd --remove-rich-rule="rule source address="{IP}" reject"',
      list: 'firewall-cmd --list-rich-rules | grep reject',
    },
    autoBlock: {
      enabled: true,
      failureThreshold: 15,
      windowMs: 600000, // 10 minutes
      blockDurationMs: 7200000, // 2 hours
    },
  },
});
```

### Manual Firewall Management

```typescript
// Get firewall status (conceptual - not implemented in middleware)
// This would require additional implementation
/*
const firewallManager = new FirewallManager(config.firewall);

// Block IP manually
await firewallManager.blockIP('203.0.113.50', '1 hour');

// Unblock IP
await firewallManager.unblockIP('203.0.113.50');

// List blocked IPs
const blockedIPs = await firewallManager.listBlockedIPs();

// Get firewall statistics
const stats = await firewallManager.getStatistics();
*/
```

## Monitoring and Alerting

### Health Check Endpoint
```typescript
import express from 'express';

const app = express();
const securitySystem = setupNetworkSecurity({ app });

// Health check endpoint
app.get('/security/health', async (req, res) => {
  const health = await securitySystem.getHealthStatus();
  
  res.status(health.healthy ? 200 : 503).json({
    status: health.healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    components: health.components,
    configuration: health.configuration,
    activity: health.activity,
  });
});

// Statistics endpoint
app.get('/security/stats', (req, res) => {
  const stats = securitySystem.getStatistics();
  res.json(stats);
});
```

### Security Event Types

| Event Type | Severity | Description |
|------------|----------|-------------|
| `ip_whitelist_violation` | High | IP not in whitelist attempted access |
| `rate_limit_exceeded` | Medium | Rate limit threshold exceeded |
| `insecure_connection_attempt` | Low | HTTP request when HTTPS required |
| `tls_version_violation` | Medium | Outdated TLS version used |
| `firewall_block` | High | IP blocked by firewall |
| `suspicious_activity` | High | Pattern of suspicious behavior |
| `authentication_failure` | Medium | Authentication attempt failed |
| `authorization_failure` | Medium | Authorization check failed |
| `malformed_request` | Medium | Malformed or suspicious request |
| `potential_attack` | Critical | Potential security attack detected |
| `security_scan_detected` | High | Security scanning activity detected |

### Alert Types

| Alert Type | Description |
|------------|-------------|
| `burst` | Multiple events from same IP in short time |
| `persistent` | Continuous security violations |
| `escalation` | Increasing severity of events |
| `anomaly` | Unusual pattern or high-risk event |

## Production Deployment

### Docker Configuration

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Create security logs directory
RUN mkdir -p /app/logs && chown -R node:node /app/logs

COPY . .
USER node

# Security environment variables
ENV SECURITY_ENABLED=true
ENV SECURITY_MODE=strict
ENV IP_WHITELIST_ENABLED=true
ENV TLS_ENFORCE_HTTPS=true
ENV SECURITY_LOGGING_ENABLED=true

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: slack-ai-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: slack-ai-agent
  template:
    metadata:
      labels:
        app: slack-ai-agent
    spec:
      containers:
      - name: slack-ai-agent
        image: slack-ai-agent:latest
        ports:
        - containerPort: 3000
        env:
        - name: SECURITY_ENABLED
          value: "true"
        - name: SECURITY_MODE
          value: "strict"
        - name: IP_WHITELIST_ENABLED
          value: "true"
        - name: IP_WHITELIST_RANGES
          valueFrom:
            configMapKeyRef:
              name: security-config
              key: allowed-ranges
        - name: TLS_ENFORCE_HTTPS
          value: "true"
        - name: SECURITY_LOGGING_ENABLED
          value: "true"
        volumeMounts:
        - name: security-logs
          mountPath: /app/logs
      volumes:
      - name: security-logs
        persistentVolumeClaim:
          claimName: security-logs-pvc
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: security-config
data:
  allowed-ranges: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
```

### Load Balancer Configuration

#### NGINX
```nginx
upstream slack_ai_agent {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL configuration
    ssl_certificate /path/to/certificate.pem;
    ssl_certificate_key /path/to/private-key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;
    
    # Security headers (additional to application headers)
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    
    # Rate limiting (additional to application rate limiting)
    limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Pass real IP to application
    location / {
        proxy_pass http://slack_ai_agent;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### HAProxy
```haproxy
global
    daemon
    maxconn 4096
    
defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    
frontend web_frontend
    bind *:80
    bind *:443 ssl crt /path/to/certificate.pem
    
    # Redirect HTTP to HTTPS
    redirect scheme https if !{ ssl_fc }
    
    # Rate limiting
    stick-table type ip size 100k expire 30s store http_req_rate(10s)
    http-request track-sc0 src
    http-request reject if { sc_http_req_rate(0) gt 20 }
    
    # Pass to backend
    default_backend web_servers
    
backend web_servers
    balance roundrobin
    option httpchk GET /health
    
    # Pass real IP
    http-request set-header X-Forwarded-Proto https if { ssl_fc }
    http-request set-header X-Real-IP %[src]
    
    server web1 127.0.0.1:3000 check
    server web2 127.0.0.1:3001 check
    server web3 127.0.0.1:3002 check
```

## Security Best Practices

### 1. Principle of Least Privilege
```typescript
// Only allow necessary IP ranges
const securitySystem = createNetworkSecuritySystem({
  ipWhitelist: {
    enabled: true,
    allowedRanges: [
      '192.168.1.0/24', // Office network
      '10.0.0.0/16',    // VPN users
    ],
    defaultAction: 'block',
  },
  global: {
    allowLocalhost: false, // Disable in production
    allowPrivateNetworks: false,
  },
});
```

### 2. Defense in Depth
```typescript
// Multiple layers of security
const securitySystem = createNetworkSecuritySystem({
  // Layer 1: IP whitelisting
  ipWhitelist: { enabled: true },
  
  // Layer 2: Rate limiting
  rateLimit: { 
    enabled: true,
    maxRequests: 50,
    windowMs: 60000,
  },
  
  // Layer 3: TLS enforcement
  tls: {
    enforceHTTPS: true,
    minVersion: '1.2',
    enableHSTS: true,
  },
  
  // Layer 4: Monitoring and alerting
  logging: {
    enabled: true,
    level: 'info',
    alerting: { enabled: true },
  },
});
```

### 3. Regular Security Audits
```typescript
// Schedule regular security checks
setInterval(async () => {
  const health = await securitySystem.getHealthStatus();
  const stats = securitySystem.getStatistics();
  
  // Log security metrics
  logger().info('Security audit', {
    healthy: health.healthy,
    blockedRequests: stats.blockedRequests,
    violations: Array.from(stats.violations.entries()),
    activeAlerts: health.activity.securityViolations,
  });
  
  // Alert if security issues detected
  if (!health.healthy || health.activity.averageRiskScore > 70) {
    await sendSecurityAlert({
      type: 'security_audit_warning',
      health,
      stats,
    });
  }
}, 60 * 60 * 1000); // Every hour
```

### 4. Log Analysis and SIEM Integration
```typescript
// Custom log processor for SIEM integration
const securityMonitor = createSecurityMonitor({
  enabled: true,
  eventProcessors: [
    async (event) => {
      // Send to Splunk
      await splunk.sendEvent({
        sourcetype: 'slack_ai_agent_security',
        event: {
          timestamp: event.timestamp,
          severity: event.severity,
          type: event.type,
          client_ip: event.clientIP,
          user_agent: event.userAgent,
          risk_score: event.riskScore,
          blocked: event.blocked,
          details: event.details,
        },
      });
    },
    async (event) => {
      // Send to ELK Stack
      await elasticsearch.index({
        index: 'security-events',
        body: event,
      });
    },
  ],
});
```

## Troubleshooting

### Common Issues

#### 1. IP Whitelisting Blocks Legitimate Traffic
```bash
# Check current whitelist configuration
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/security/stats

# Temporarily disable IP whitelisting
export IP_WHITELIST_ACTION=log
```

#### 2. Rate Limiting Too Restrictive
```typescript
// Increase rate limits temporarily
securitySystem.rateLimitMiddleware?.updateConfiguration({
  maxRequests: 200,
  windowMs: 60000,
});

// Or skip rate limiting for specific paths
const rateLimitMiddleware = createRateLimitingMiddleware({
  skipPaths: ['/health', '/webhook'],
});
```

#### 3. TLS Issues in Development
```bash
# Disable HTTPS enforcement for development
export TLS_ENFORCE_HTTPS=false
export SECURITY_ALLOW_LOCALHOST=true
```

#### 4. High Memory Usage
```typescript
// Reduce memory usage
const securitySystem = createNetworkSecuritySystem({
  logging: {
    maxEventsInMemory: 1000, // Reduce from default 10000
    maxActiveAlerts: 10,     // Reduce from default 100
  },
});
```

### Debug Logging
```bash
# Enable debug logging
export SECURITY_LOGGING_LEVEL=debug
export NODE_DEBUG=security

# View real-time security logs
tail -f logs/security.log | jq .
```

### Performance Monitoring
```typescript
// Monitor security middleware performance
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const securityReq = req as NetworkSecurityRequest;
    
    if (duration > 100) { // Log slow requests
      logger().warn('Slow security processing', {
        duration,
        path: req.path,
        violations: securityReq.securityContext?.violations.length || 0,
        riskScore: securityReq.securityContext?.riskScore || 0,
      });
    }
  });
  
  next();
});
```

## API Reference

For detailed API documentation, see the TypeScript interfaces in:
- `src/middleware/network-security.ts`
- `src/config/network-security.ts`
- `src/utils/cidr-validator.ts`

## Support

For issues, questions, or feature requests, please refer to the project's issue tracker.