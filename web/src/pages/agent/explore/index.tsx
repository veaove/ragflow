import { PageHeader } from '@/components/page-header';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { AgentCategory } from '@/constants/agent';
import { useSetModalState } from '@/hooks/common-hooks';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useFetchSessionManually } from '@/hooks/use-agent-request';
import { ShieldCheck } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useFetchDataOnMount } from '../hooks/use-fetch-data';
import { QcRuleDialog } from './components/qc-rule-dialog';
import { SessionChat } from './components/session-chat';
import { SessionList } from './components/session-list';
import { useExploreUrlParams } from './hooks/use-explore-url-params';

export default function AgentExplore() {
  const { sessionId, setSessionId } = useExploreUrlParams();
  const { navigateToAgent } = useNavigatePage();
  const { t } = useTranslation();
  const { id } = useParams();
  const { flowDetail: agentDetail } = useFetchDataOnMount();
  const { fetchSessionManually, data: session } = useFetchSessionManually();
  const {
    visible: qcRuleVisible,
    showModal: showQcRule,
    hideModal: hideQcRule,
  } = useSetModalState();

  // Chatflow / workflow flows belong to Studio, not Agents; label the crumb the
  // same way the editor does so both pages agree on which module you are in.
  const isStudioCanvas =
    agentDetail?.canvas_category === AgentCategory.ChatflowCanvas ||
    agentDetail?.canvas_category === AgentCategory.WorkflowCanvas;

  const handleBackToAgent = useCallback(() => {
    const navigateFn = navigateToAgent(id as string);
    navigateFn();
  }, [id, navigateToAgent]);

  const handleSessionSelect = useCallback(
    (id: string, isNew?: boolean) => {
      setSessionId(id, isNew);
      fetchSessionManually(id);
    },
    [fetchSessionManually, setSessionId],
  );

  return (
    <section className="h-full flex flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={handleBackToAgent}>
                {isStudioCanvas ? t('header.studio') : t('header.flow')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {agentDetail?.title || t('explore.title')}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {/* The conversation is where a QC hit becomes visible, so the rules
            that produced it must be reachable from here too — not only from
            the editor's 管理 → 设置 dialog. */}
        <Button variant={'outline'} onClick={showQcRule}>
          <ShieldCheck className="size-4" />
          {t('flow.settings.qcRules')}
        </Button>
      </PageHeader>

      <section className="flex flex-1 min-h-0">
        <div className="w-[296px] border-r min-w-0">
          <SessionList
            selectedSessionId={sessionId}
            onSelectSession={handleSessionSelect}
          />
        </div>

        <div className="flex-1 min-w-0">
          <SessionChat session={session} />
        </div>
      </section>

      {qcRuleVisible && (
        <QcRuleDialog appId={id as string} hideModal={hideQcRule} />
      )}
    </section>
  );
}
