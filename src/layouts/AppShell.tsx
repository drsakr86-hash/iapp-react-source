/**
 * AppShell — top bar + role navigation + outlet.
 *
 * LAYOUT MODEL — reset to the simplest possible thing after repeated
 * real-browser reports that desktop primary-nav content still started
 * underneath the nav, despite each prior revision reasoning through why
 * it shouldn't (and, in one round, an actual WebKit engine measuring zero
 * overlap under the same CSS). Rather than keep refining sticky-based
 * offset logic that real Chrome kept disagreeing with, this removes
 * position tricks from the desktop chrome entirely:
 *
 * .topbar, .bottomnav (desktop), and .subnav are all plain, ordinary
 * `position: static` block-level siblings — no sticky, no fixed, no
 * wrapper element, no calculated offset, no ResizeObserver. <main> simply
 * comes after them in the DOM. Normal-flow siblings physically cannot
 * overlap one another; there is no CSS positioning mode involved that
 * could get that wrong. The tradeoff, explicitly accepted: the header no
 * longer stays pinned while scrolling a long page on desktop — it
 * scrolls away with the rest of the content, exactly like any other
 * block element before it. That's a UX downgrade from a sticky header,
 * not a bug, and is deliberately the price paid to make the base layout
 * unambiguously correct before any "stays visible while scrolling"
 * enhancement is reconsidered.
 *
 * Mobile keeps its existing fixed bottom tab bar (.bottomnav is
 * `position: fixed; bottom: 0` only below the 900px breakpoint) — a
 * fixed element does not reserve flow space, so .app-shell still needs a
 * bottom padding to clear it; that padding is now a static constant
 * (--bottomnav-h in theme.css), not a runtime measurement, per instruction.
 */
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDoctor } from '../hooks/useDoctor';
import { ROLE_AR } from '../types/domain';
import { Button, Icon, type IconName } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';

export type Section = 'doctor' | 'secretary' | 'patient' | 'admin' | 'accounting';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  /** Extra path prefixes that should light this tab up (e.g. screens reached from «المزيد»). */
  also?: string[];
}

/**
 * Tabs mirror the legacy applications' navigation. Only the routes that
 * exist in Step 2 are listed; the rest arrive with their screens in
 * Steps 5-7 rather than as dead links.
 */
const NAV: Record<Section, NavItem[]> = {
  doctor: [
    { to: '/doctor', label: 'اليوم', icon: 'calendar', end: true },
    { to: '/doctor/appointments', label: 'المواعيد', icon: 'calendar-days' },
    { to: '/doctor/patients', label: 'المرضى', icon: 'users' },
    { to: '/doctor/payments', label: 'المدفوعات', icon: 'credit-card' },
    {
      to: '/doctor/more',
      label: 'المزيد',
      icon: 'menu',
      also: [
        '/doctor/clinics',
        '/doctor/services',
        '/doctor/lists',
        '/doctor/profile',
        '/accounting',
      ],
    },
  ],
  accounting: [
    { to: '/accounting', label: 'الرئيسية', icon: 'bar-chart', end: true },
    { to: '/accounting/revenue', label: 'تحصيل', icon: 'wallet' },
    { to: '/accounting/expenses', label: 'مصروفات', icon: 'receipt' },
    { to: '/accounting/transfers', label: 'تحويلات', icon: 'repeat' },
    { to: '/accounting/refunds', label: 'مرتجعات', icon: 'undo' },
    { to: '/accounting/closing', label: 'الإغلاق اليومي', icon: 'lock' },
    { to: '/accounting/accounts', label: 'الحسابات', icon: 'landmark' },
    { to: '/accounting/reports', label: 'التقارير', icon: 'trending' },
    { to: '/accounting/settings', label: 'الإعدادات', icon: 'sliders' },
  ],
  secretary: [{ to: '/secretary', label: 'مواعيد اليوم', icon: 'calendar', end: true }],
  patient: [
    { to: '/patient', label: 'اليوم', icon: 'calendar', end: true },
    { to: '/patient/appointments', label: 'مواعيدي', icon: 'calendar-days' },
    { to: '/patient/prescriptions', label: 'روشتاتي', icon: 'pill' },
    { to: '/patient/exams', label: 'فحوصاتي', icon: 'flask' },
  ],
  admin: [
    { to: '/admin', label: 'النظام', icon: 'shield', end: true },
    { to: '/admin/payments', label: 'المدفوعات', icon: 'credit-card' },
    { to: '/admin/clinics', label: 'العيادات', icon: 'building' },
    { to: '/admin/services', label: 'الخدمات', icon: 'receipt' },
  ],
};

const TITLE: Record<Section, string> = {
  doctor: 'الطبيب',
  secretary: 'السكرتارية',
  patient: 'بوابة المريض',
  admin: 'مدير النظام',
  accounting: 'الحسابات المالية',
};

export function AppShell({ section }: { section: Section }) {
  const { profile, signOut } = useAuth();
  /* One name source. The header must not render profile.fullName directly:
     a doctor who renames themselves in settings would then see the old name
     here until a reload, which is what made the name look un-editable. */
  const { displayName } = useDoctor();
  const items = NAV[section];

  /* Accounting is a MODULE inside the doctor application, not a separate
     shell — the /accounting/* route tree renders <AppShell section="doctor">
     (see routes/index.tsx), so the primary doctor navigation is always
     what's shown above. This only decides whether the secondary
     Accounting sub-nav additionally appears underneath it. */
  const location = useLocation();
  const isAccounting =
    location.pathname === '/accounting' || location.pathname.startsWith('/accounting/');

  return (
    <>
      <header className="topbar">
        <span className="topbar__title">I App — {TITLE[section]}</span>
        <span className="topbar__spacer" />
        {import.meta.env.DEV ? (
          <span style={{ fontSize: 10, opacity: 0.5 }}>build-2026-09-13-hashrouter</span>
        ) : null}
        {profile ? (
          <span className="topbar__meta">
            {displayName} · {ROLE_AR[profile.role]}
          </span>
        ) : null}
        <ThemeToggle />
        <Button variant="outline" onClick={() => void signOut()} style={{ padding: '6px 12px' }}>
          خروج
        </Button>
      </header>

      <nav className="bottomnav" aria-label="التنقّل">
        {items.map((item) =>
          item.also ? (
            <Link
              key={item.to}
              to={item.to}
              className="bottomnav__item"
              aria-current={
                [item.to, ...item.also].some(
                  (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
                )
                  ? 'page'
                  : undefined
              }
            >
              <span className="bottomnav__icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </Link>
          ) : (
            <NavLink key={item.to} to={item.to} end={item.end} className="bottomnav__item">
              <span className="bottomnav__icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ),
        )}
      </nav>

      {isAccounting ? <AccountingSubNav /> : null}

      <main className="app-shell">
        <Outlet />
      </main>
    </>
  );
}

/**
 * Secondary navigation shown only while the current route is under
 * /accounting/*. Reuses NAV.accounting's existing item list — nothing
 * about that data changed, only how it's rendered (as a sub-nav strip
 * under the primary doctor nav, not as a separate top-level AppShell
 * section). Disappears the instant the path moves outside /accounting.
 */
function AccountingSubNav() {
  return (
    <nav className="subnav" aria-label="تنقّل المحاسبة">
      {NAV.accounting.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="subnav__item">
          <span className="subnav__icon" aria-hidden="true">
            <Icon name={item.icon} size={18} />
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
