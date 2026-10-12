/**
 * Admin landing page — quick links into the admin screens that already
 * exist (Clinic Locations, Services, Payments). This used to claim no
 * admin screens existed yet, which stopped being true once those pages
 * shipped; the empty state was never updated to match.
 */
import { Icon } from '../../components/ui/Icon';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Card } from '../../components/ui';
import type { IconName } from '../../components/ui/Icon';

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/admin/clinics', label: 'العيادات', icon: 'building' },
  { to: '/admin/services', label: 'الخدمات', icon: 'receipt' },
  { to: '/admin/payments', label: 'المدفوعات', icon: 'credit-card' },
];

export default function AdminHome() {
  useDocumentTitle('مدير النظام');
  return (
    <Card title="مدير النظام">
      <div className="stack">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="row">
            <span aria-hidden="true"><Icon name={l.icon} /></span>
            <span>{l.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
