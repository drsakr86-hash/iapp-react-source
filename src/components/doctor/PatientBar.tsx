/**
 * Sticky patient identity strip for the clinical file: who is open, how old,
 * whether they have recorded allergies, and whether a visit is in progress.
 * Stays visible while the doctor scrolls a long tab, so there is never a
 * doubt about WHICH patient the form on screen belongs to.
 *
 * `allergies` is shown only when the clinical record has text for it; an
 * empty field is NOT displayed as "no allergies" — absence of a record is not
 * the same as a confirmed negative.
 */
import { Tag } from '../ui';

export function PatientBar({
  name,
  code,
  age,
  allergies,
  visitOpen,
  children,
}: {
  name: string;
  code: string | null;
  age: number | null;
  allergies: string | null;
  visitOpen: boolean;
  children?: React.ReactNode;
}) {
  const allergyText = allergies?.trim();
  return (
    <div className="patientbar">
      <div className="patientbar__line">
        <strong className="patientbar__name">{name}</strong>
        <span className="muted patientbar__meta">
          {code ? `${code}` : ''}
          {age != null ? `${code ? ' · ' : ''}${age} سنة` : ''}
        </span>
        <span className="topbar__spacer" />
        {visitOpen ? <Tag label="🩺 زيارة مفتوحة" color="var(--accent)" /> : null}
      </div>
      {allergyText ? (
        <div className="patientbar__alert" role="alert">
          ⚠️ حساسية: {allergyText}
        </div>
      ) : null}
      {children}
    </div>
  );
}
