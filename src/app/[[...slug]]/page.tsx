import { OwnerSetup } from '@/components/owner-setup';
import { Workspace } from '@/components/workspace';
import { AuthPage } from '@/components/auth-page';
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug[0] === 'owner-setup') return <OwnerSetup />;
  if (slug[0] === 'login' || slug[0] === 'viewer-login')
    return <AuthPage viewer={slug[0] === 'viewer-login'} />;
  return <Workspace section={slug[0] || 'overview'} recordId={slug[1]} />;
}
