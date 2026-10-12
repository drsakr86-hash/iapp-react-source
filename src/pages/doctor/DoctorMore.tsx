/**
 * «المزيد» — the less frequent doctor screens, kept off the bottom bar so it
 * stays at five tabs (a phone fits five comfortably, nine does not).
 */
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const ITEMS: { to: string; icon: string; label: string; hint: string }[] = [
  { to: '/accounting', icon: '📊', label: 'المحاسبة', hint: 'الإيرادات والمصروفات والإغلاق اليومي' },
  { to: '/doctor/clinics', icon: '🏥', label: 'العيادات', hint: 'بيانات الفروع والعناوين' },
  { to: '/doctor/services', icon: '🧾', label: 'الخدمات', hint: 'قائمة الخدمات والأسعار' },
  { to: '/doctor/lists', icon: '⚙️', label: 'القوائم', hint: 'خيارات القوائم المنسدلة في النماذج' },
  { to: '/doctor/profile', icon: '👤', label: 'ملفي', hint: 'الاسم والبيانات الشخصية' },
];

export default function DoctorMore() {
  useDocumentTitle('المزيد');
  return (
    <div className="stack">
      <Card title="المزيد">
        <nav className="morelist" aria-label="المزيد">
          {ITEMS.map((i) => (
            <Link key={i.to} to={i.to} className="morelist__item">
              <span className="morelist__icon" aria-hidden="true">
                {i.icon}
              </span>
              <span>
                <div className="morelist__label">{i.label}</div>
                <div className="morelist__hint">{i.hint}</div>
              </span>
            </Link>
          ))}
        </nav>
      </Card>
    </div>
  );
}
