import { getConfig } from './environment';

export function getSlackConfig() {
  const config = getConfig();
  return {
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    appToken: config.slack.appToken,
    socketMode: true,
    developerMode: config.app.nodeEnv === 'development',
  };
}