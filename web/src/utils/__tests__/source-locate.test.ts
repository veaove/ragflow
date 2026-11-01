import { supportsSourceLocate } from '../source-locate';

describe('supportsSourceLocate', () => {
  it('accepts pdf and excel extensions case-insensitively', () => {
    expect(supportsSourceLocate('pdf')).toBe(true);
    expect(supportsSourceLocate('XLSX')).toBe(true);
    expect(supportsSourceLocate('xls')).toBe(true);
  });

  it('rejects unsupported or missing extensions', () => {
    // html 文档自带 url，调用方走 window.open(documentUrl)，不进货架定位。
    expect(supportsSourceLocate('html')).toBe(false);
    // docx 与 xlsx 同属 ExceptiveType（即 SupportedPreviewDocumentTypes），
    // 实现按类型集合统一判定；没有任何依据支持把 docx 单独排除。
    expect(supportsSourceLocate('docx')).toBe(true);
    expect(supportsSourceLocate(undefined)).toBe(false);
  });
});
