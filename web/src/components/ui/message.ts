import { ExternalToast } from 'sonner';

import { toast } from '@/utils/toast';

const configuration: ExternalToast = { duration: 2500, position: 'top-center' };

type MessageOptions = {
  message: string;
  description?: string;
  duration?: number;
};

/**
 * message 是轻提示的兼容层。
 *
 * 具体落到哪种形态由 `@/utils/toast` 决定：成功 / 进行中仍是角落提示，失败与
 * 警告统一弹框。这里只负责把两种调用写法（字符串、{message, description}）
 * 归一成「标题 + 说明」，别在调用点和转换层各拼一次说明文字。
 */
function normalize(
  msg: string | MessageOptions,
  data?: ExternalToast,
): { title: string; data: ExternalToast } {
  if (typeof msg === 'object') {
    return {
      title: msg.message,
      data: {
        ...configuration,
        description: msg.description,
        ...(msg.duration !== undefined ? { duration: msg.duration * 1000 } : {}),
      },
    };
  }
  return { title: msg, data: { ...configuration, ...data } };
}

const message = {
  success: (msg: string) => {
    toast.success(msg, configuration);
  },
  error: (msg: string | MessageOptions, data?: ExternalToast) => {
    const normalized = normalize(msg, data);
    toast.error(normalized.title, normalized.data);
  },
  warning: (msg: string | MessageOptions, data?: ExternalToast) => {
    const normalized = normalize(msg, data);
    toast.warning(normalized.title, normalized.data);
  },
  info: (msg: string) => {
    toast.info(msg, configuration);
  },
};
export default message;
