(globalThis as any).CSS = {
  ...(globalThis as any).CSS,
  supports: () => false,
};

const loadAvailableDataSourceKeys = () => {
  const { getAvailableDataSourceKeys } = require('./backend-adapter');
  return getAvailableDataSourceKeys();
};

describe('data source backend adapter', () => {
  it('保留国内来源：飞书、钉钉、Seafile', () => {
    expect(loadAvailableDataSourceKeys()).toEqual(
      expect.arrayContaining(['feishu_wiki', 'dingtalk_ai_table', 'seafile']),
    );
  });

  it('保留通用协议与自建数据库 —— 它们连的是客户自己的服务器', () => {
    expect(loadAvailableDataSourceKeys()).toEqual(
      expect.arrayContaining([
        'webdav',
        'imap',
        'mysql',
        'postgresql',
        'rest_api',
        'rss',
        'sitemap',
      ]),
    );
  });

  it('不再出现境外 SaaS 与境外软件', () => {
    const keys = loadAvailableDataSourceKeys();
    for (const key of [
      'confluence',
      'notion',
      'google_drive',
      'gmail',
      'google_cloud_storage',
      'oci_storage',
      's3',
      'r2',
      'jira',
      'box',
      'dropbox',
      'bitbucket',
      'azure_devops',
      'gitlab',
      'github',
      'moodle',
      'discord',
      'xquik',
      'zendesk',
      'zotero',
      'airtable',
      'asana',
      'onedrive',
      'outlook',
      'salesforce',
      'azure_blob',
      'teams',
      'slack',
      'sharepoint',
      'bigquery',
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  it('白名单里的 key 必须真实存在，且没有重复', () => {
    const { DataSourceKey, DOMESTIC_DATA_SOURCE_KEYS } = require('./constant');
    const all = new Set(Object.values(DataSourceKey));
    for (const key of DOMESTIC_DATA_SOURCE_KEYS) {
      expect(all.has(key)).toBe(true);
    }
    expect(new Set(DOMESTIC_DATA_SOURCE_KEYS).size).toBe(
      DOMESTIC_DATA_SOURCE_KEYS.length,
    );
  });
});
