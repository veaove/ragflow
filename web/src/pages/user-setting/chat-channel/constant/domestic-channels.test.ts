import { ChatChannelKey, DOMESTIC_CHAT_CHANNEL_KEYS } from './index';

describe('聊天渠道的国内白名单', () => {
  it('只保留钉钉、飞书、企业微信、QQ 机器人', () => {
    expect([...DOMESTIC_CHAT_CHANNEL_KEYS]).toEqual([
      ChatChannelKey.DINGTALK,
      ChatChannelKey.FEISHU,
      ChatChannelKey.QQBOT,
      ChatChannelKey.WECOM,
    ]);
  });

  it('不再包含境外渠道', () => {
    for (const key of [
      ChatChannelKey.DISCORD,
      ChatChannelKey.TELEGRAM,
      ChatChannelKey.WHATSAPP,
      ChatChannelKey.SLACK,
      ChatChannelKey.MSTEAMS,
      ChatChannelKey.GOOGLECHAT,
      ChatChannelKey.LINE,
      ChatChannelKey.TWITCH,
      ChatChannelKey.ZALO,
    ]) {
      expect(DOMESTIC_CHAT_CHANNEL_KEYS).not.toContain(key);
    }
  });

  it('没有重复项', () => {
    expect(new Set(DOMESTIC_CHAT_CHANNEL_KEYS).size).toBe(
      DOMESTIC_CHAT_CHANNEL_KEYS.length,
    );
  });
});
