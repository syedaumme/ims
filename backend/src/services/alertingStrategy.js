/**
 * Alerting Strategy Pattern
 *
 * The Strategy Pattern lets us swap alerting logic at runtime
 * without changing the code that calls it.
 *
 * RDBMS failure → P0CriticalAlert (would page on-call immediately)
 * Cache failure  → P2StandardAlert (Slack notification)
 * API failure    → depends on severity passed in
 *
 * In a real system, these would call PagerDuty, Slack, email, etc.
 * Here we log + store the alert record.
 */

const logger = require('../utils/logger');

class BaseAlertStrategy {
  async alert(workItem) {
    throw new Error('alert() must be implemented by subclass');
  }
}

class P0CriticalAlert extends BaseAlertStrategy {
  async alert(workItem) {
    logger.warn(`[P0 CRITICAL] ${workItem.componentType} failure detected`, {
      workItemId: workItem.workItemId,
      componentId: workItem.componentId,
      action: 'PAGING_ON_CALL',
    });
    // In production: await pagerduty.trigger(workItem)
  }
}

class P1HighAlert extends BaseAlertStrategy {
  async alert(workItem) {
    logger.warn(`[P1 HIGH] ${workItem.componentType} degraded`, {
      workItemId: workItem.workItemId,
      action: 'SLACK_ALERT_SENT',
    });
    // In production: await slack.postMessage('#incidents', ...)
  }
}

class P2StandardAlert extends BaseAlertStrategy {
  async alert(workItem) {
    logger.info(`[P2 STANDARD] ${workItem.componentType} issue logged`, {
      workItemId: workItem.workItemId,
      action: 'EMAIL_SENT',
    });
    // In production: await sendgrid.send(oncall_email, ...)
  }
}

class P3LowAlert extends BaseAlertStrategy {
  async alert(workItem) {
    logger.info(`[P3 LOW] ${workItem.componentType} minor issue`, {
      workItemId: workItem.workItemId,
      action: 'LOGGED_ONLY',
    });
  }
}

class AlertingStrategy {
  /**
   * Factory method: returns the right alert strategy based on
   * component type and severity.
   *
   * RDBMS and MCP_HOST failures are always at least P1.
   * CACHE failures default to P2.
   * Everything else uses the severity from the signal.
   */
  static forComponent(componentType, severity) {
    // Component type overrides override signal severity for critical infra
    if (componentType === 'RDBMS') return new P0CriticalAlert();
    if (componentType === 'MCP_HOST') return new P1HighAlert();
    if (componentType === 'CACHE') return new P2StandardAlert();

    // For other types, use severity from the signal
    switch (severity) {
      case 'P0': return new P0CriticalAlert();
      case 'P1': return new P1HighAlert();
      case 'P2': return new P2StandardAlert();
      default:   return new P3LowAlert();
    }
  }
}

module.exports = { AlertingStrategy, P0CriticalAlert, P1HighAlert, P2StandardAlert, P3LowAlert };
