/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

// TODO: Use standard BCP 47 language tag and display names
export const LanguageList = [
  'English',
  'Chinese',
  'Traditional Chinese',
  'Russian',
  'Indonesian',
  'Spanish',
  'Vietnamese',
  'Japanese',
  'Portuguese BR',
  'German',
  'French',
  'Italian',
  'Bulgarian',
  'Arabic',
  'Turkish',
  'Dutch',
  'Slovak',
  'Czech',
];
export const LanguageMap = {
  English: 'English',
  Chinese: '简体中文',
  'Traditional Chinese': '繁體中文',
  Russian: 'Русский',
  Indonesian: 'Bahasa Indonesia',
  Indonesia: 'Indonesia',
  Spanish: 'Español',
  Vietnamese: 'Tiếng việt',
  Japanese: '日本語',
  'Portuguese BR': 'Português BR',
  German: 'Deutsch',
  French: 'Français',
  Italian: 'Italiano',
  Bulgarian: 'Български',
  Arabic: 'العربية',
  Turkish: 'Türkçe',
  Dutch: 'Nederlands',
  Slovak: 'Slovenčina',
  Czech: 'Čeština',
};

/**
 * 本产品仅面向中文用户维护，故只保留中文（简/繁）与英文。
 *
 * 历史上这里曾注册 19 种语言，`web/src/locales/` 下也保留了对应的翻译文件。
 * 精简后非中文用户会回退到英文（见 locales/config.ts 的 fallbackLng）。
 */
export enum LanguageAbbreviation {
  En = 'en',
  Zh = 'zh-Hans',
  ZhTraditional = 'zh-Hant',
}

export const LanguageAbbreviationMap = {
  [LanguageAbbreviation.En]: 'English',
  [LanguageAbbreviation.Zh]: '简体中文',
  [LanguageAbbreviation.ZhTraditional]: '繁體中文',
};

export const LanguageTranslationMap = {
  English: 'en',
  Chinese: 'zh-Hans',
  'Traditional Chinese': 'zh-Hant',
  Russian: 'ru',
  Indonesian: 'id',
  Indonesia: 'id',
  Spanish: 'es',
  Vietnamese: 'vi',
  Japanese: 'ja',
  Korean: 'ko',
  'Portuguese BR': 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-BR': 'pt-BR',
  German: 'de',
  French: 'fr',
  Italian: 'it',
  Tamil: 'ta',
  Telugu: 'te',
  Kannada: 'ka',
  Thai: 'th',
  Greek: 'el',
  Hindi: 'hi',
  Ukrainian: 'uk',
  Bulgarian: 'bg',
  Arabic: 'ar',
  Turkish: 'tr',
  Dutch: 'nl',
  Slovak: 'sk',
  Czech: 'cs',
};

export enum FileMimeType {
  Bmp = 'image/bmp',
  Csv = 'text/csv',
  Odt = 'application/vnd.oasis.opendocument.text',
  Doc = 'application/msword',
  Docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  Gif = 'image/gif',
  Htm = 'text/htm',
  Html = 'text/html',
  Jpg = 'image/jpg',
  Jpeg = 'image/jpeg',
  Pdf = 'application/pdf',
  Png = 'image/png',
  Ppt = 'application/vnd.ms-powerpoint',
  Pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  Tiff = 'image/tiff',
  Txt = 'text/plain',
  Xls = 'application/vnd.ms-excel',
  Xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  Mp4 = 'video/mp4',
  Json = 'application/json',
  Md = 'text/markdown',
  Mdx = 'text/mdx',
}

/**
 * 官方托管服务的域名。
 *
 * 仅用于「是否运行在官方云端」的环境判断：部分功能（获取系统版本、嵌入站点）
 * 只在自建部署下开放。本项目以私有化部署为主，此处保留判断逻辑但不再对外
 * 展示该域名，相关文案见 locales 中的知识库说明。
 */
export const Domain = 'cloud.ragflow.io';

/** 与 {@link Domain} 同源，供需要hostname（不含端口）的判断处复用。 */
export const DomainHostname = Domain;

//#region file preview
export const Images = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'webp',
  // 'svg',
  'ico',
];

export const AudioExtensions = [
  'mp3',
  'wav',
  'wave',
  'aac',
  'flac',
  'ogg',
  'oga',
  'm4a',
  'wma',
  'aiff',
  'aif',
  'au',
  'midi',
  'opus',
  'ape',
  'amr',
];

export const VideoExtensions = [
  'mp4',
  'avi',
  'mov',
  'mkv',
  'wmv',
  'flv',
  'mpeg',
  'mpg',
  'asf',
  'rm',
  'rmvb',
];

// Without FileViewer
export const ExceptiveType = [
  'xlsx',
  'xls',
  'pdf',
  'docx',
  'md',
  'mdx',
  'txt',
  'csv',
  'pptx',
  'html',
  'htm',
  'epub',
  ...Images,
];

export const SupportedPreviewDocumentTypes = [...ExceptiveType];
//#endregion

export enum Platform {
  RAGFlow = 'RAGFlow',
  Dify = 'Dify',
  FastGPT = 'FastGPT',
  Coze = 'Coze',
}

export enum ThemeEnum {
  Dark = 'dark',
  Light = 'light',
  System = 'system',
}

export const DESCRIPTION_MAX_LENGTH = 512;
