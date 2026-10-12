#!/usr/bin/env python3
"""
Adds a "حذف المريض" (delete patient) button next to "تغيير المريض" in
DoctorPatientRecord.tsx.

Usage:
    python3 apply_delete_patient_patch.py ~/iapp-react/src/pages/doctor/DoctorPatientRecord.tsx

Safe by construction: OLD must appear in the file exactly once, or nothing
is written and the script says why. The original file is left untouched
either way.
"""
import sys

OLD = """        {patientId && patient ? (
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <strong>{patient.full_name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {patient.patient_code ?? ''}
              {patient.phone ? ` — ${patient.phone}` : ''}
            </span>
            <Button variant="outline" onClick={changePatient}>
              تغيير المريض
            </Button>
          </div>
        ) : ("""

NEW = """        {patientId && patient ? (
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <strong>{patient.full_name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {patient.patient_code ?? ''}
              {patient.phone ? ` — ${patient.phone}` : ''}
            </span>
            <Button variant="outline" onClick={changePatient}>
              تغيير المريض
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (
                  !window.confirm(
                    `حذف ملف "${patient.full_name}" نهائياً من القوائم؟ (السجلات الطبية المرتبطة تبقى محفوظة في قاعدة البيانات)`,
                  )
                )
                  return;
                patientsSvc
                  .remove(patient.id)
                  .then(() => {
                    toast.success('تم حذف المريض من القوائم');
                    changePatient();
                  })
                  .catch((e: unknown) =>
                    toast.error(e instanceof Error ? e.message : 'تعذّر حذف المريض'),
                  );
              }}
            >
              حذف المريض
            </Button>
          </div>
        ) : ("""


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_delete_patient_patch.py <path to DoctorPatientRecord.tsx>")
        return 1
    path = sys.argv[1]
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    count = content.count(OLD)
    if count == 0:
        print("0 matches found — file may already be patched, or this isn't the expected version. Nothing written.")
        return 1
    if count > 1:
        print(f"{count} matches found — expected exactly 1. Nothing written; needs a manual look.")
        return 1

    with open(path, "w", encoding="utf-8") as f:
        f.write(content.replace(OLD, NEW, 1))
    print("Patched successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
