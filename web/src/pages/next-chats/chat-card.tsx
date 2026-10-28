import { HomeCard } from '@/components/home-card';
import { MoreButton } from '@/components/more-button';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IDialog } from '@/interfaces/database/chat';
import {
  formatKnowledgeBaseCell,
  getKnowledgeBaseNames,
} from '@/utils/kb-labels';
import { ChatDropdown } from './chat-dropdown';
import { useRenameChat } from './hooks/use-rename-chat';
import { useModelNameResolver } from './use-model-name-resolver';

export type IProps = {
  data: IDialog;
} & Pick<ReturnType<typeof useRenameChat>, 'showChatRenameModal'>;

export function ChatCard({ data, showChatRenameModal }: IProps) {
  const { navigateToChat } = useNavigatePage();
  const resolveModelName = useModelNameResolver();

  // 卡片和表格必须用同一套映射：库里存的是 id，界面上只能出现名称，
  // 映射不到统一兜底 "-"。完整文本放 title，卡片宽度有限先截断。
  const modelName = resolveModelName(data.llm_id);
  const rerankName = resolveModelName(data.rerank_id);
  const knowledgeBases = formatKnowledgeBaseCell(getKnowledgeBaseNames(data));

  return (
    <HomeCard
      data={{
        name: data.name,
        description: data.description,
        avatar: data.icon,
        update_time: data.update_time,
      }}
      extra={
        <div className="flex flex-col gap-0.5 text-xs text-text-secondary">
          <span className="block truncate" title={modelName}>
            模型：{modelName}
          </span>
          <span className="block truncate" title={rerankName}>
            重排模型：{rerankName}
          </span>
          <span className="block truncate" title={knowledgeBases.title}>
            知识库：{knowledgeBases.text}
          </span>
        </div>
      }
      moreDropdown={
        <ChatDropdown chat={data} showChatRenameModal={showChatRenameModal}>
          <MoreButton></MoreButton>
        </ChatDropdown>
      }
      onClick={navigateToChat(data?.id)}
    />
  );
}
