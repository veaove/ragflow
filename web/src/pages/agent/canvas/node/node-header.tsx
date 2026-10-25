import { cn } from '@/lib/utils';
import { memo } from 'react';
import { Operator } from '../../constant';
import OperatorIcon from '@/components/operator-icon';
interface IProps {
  id: string;
  label: string;
  name: string;
  gap?: number;
  className?: string;
  wrapperClassName?: string;
  icon?: React.ReactNode;
}

const InnerNodeHeader = ({
  label,
  name,
  className,
  wrapperClassName,
  icon,
}: IProps) => {
  return (
    // data-node-header 供 canvas-skin.css 的科技风使用（卡片内标题下加分隔线）。
    <section data-node-header="" className={cn(wrapperClassName, 'pb-2')}>
      <div className={cn(className, 'flex gap-2.5')}>
        {icon || <OperatorIcon name={label as Operator}></OperatorIcon>}
        <span className="truncate text-center font-semibold text-sm">
          {name}
        </span>
      </div>
    </section>
  );
};

const NodeHeader = memo(InnerNodeHeader);

export default NodeHeader;
