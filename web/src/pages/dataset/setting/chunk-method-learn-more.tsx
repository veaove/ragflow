import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideMaximize2, LucideMinimize2, LucideX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CategoryPanel from './category-panel';

const ChunkMethodLearnMore = ({ parserId }: { parserId: string }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  // 说明占的是配置页右侧那条窄列，长段落挤在里面很难读，所以给一个铺满
  // 整页的开关；它仍然读同一份内容，只是换定位。
  const [maximized, setMaximized] = useState(false);

  const toggleVisible = useCallback(() => {
    setVisible((v) => !v);
  }, []);

  const hidePanel = useCallback(() => {
    setVisible(false);
    setMaximized(false);
  }, []);

  const toggleMaximized = useCallback(() => {
    setMaximized((v) => !v);
  }, []);

  const maximizeLabel = maximized
    ? t('common.restore')
    : t('common.maximize');

  return (
    <div className="flex flex-1 flex-col">
      <div>
        <Button variant="outline" onClick={toggleVisible}>
          {t('knowledgeDetails.learnMore')}
        </Button>
      </div>

      {visible && (
        <>
          {maximized && (
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setMaximized(false)}
            />
          )}

          <Card
            as="article"
            className={cn(
              'relative flex-1 overflow-auto mt-4',
              maximized && 'fixed inset-4 z-50 mt-0',
            )}
          >
            <div className="absolute right-2 top-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-pressed={maximized}
                aria-label={maximizeLabel}
                title={maximizeLabel}
                onClick={toggleMaximized}
              >
                {maximized ? <LucideMinimize2 /> : <LucideMaximize2 />}
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={hidePanel}>
                <LucideX />
              </Button>
            </div>

            <CardContent className="p-5">
              <CategoryPanel chunkMethod={parserId}></CategoryPanel>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ChunkMethodLearnMore;
