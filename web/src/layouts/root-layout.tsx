import { Outlet } from 'react-router';

import { AppSidebar } from './components/app-sidebar';
import { Header } from './components/header';

/**
 * 应用外壳：左侧固定导航 + 顶栏 + 内容区。
 *
 * 侧栏用 flex 而非 grid：内容区需要「占满剩余宽度」，而侧栏在窄屏下要能
 * 完全收起。flex + `min-w-0` 才能让长内容正确收缩而不撑破布局。
 *
 * 侧栏只在 lg 以上展示；窄屏下由 Header 里的抽屉菜单接管导航。
 */
export function RootLayoutContainer({ children }: React.PropsWithChildren) {
  return (
    <div className="flex h-full min-w-0">
      <div className="hidden lg:flex">
        <AppSidebar />
      </div>

      <div className="flex size-full min-w-0 flex-1 flex-col">
        <Header className="shrink-0 px-5 py-4" />

        <main className="size-full min-w-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export default function RootLayout() {
  return (
    <RootLayoutContainer>
      <Outlet />
    </RootLayoutContainer>
  );
}
