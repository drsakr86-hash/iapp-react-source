#!/usr/bin/env python3
"""
Adds a "حذف" (delete) button to the studies list in DoctorPatientRecord.tsx.

Usage:
    python3 apply_delete_button_patch.py ~/iapp-react/src/pages/doctor/DoctorPatientRecord.tsx

Safe by construction: OLD must appear in the file exactly once, or nothing
is written and the script tells you why (0 matches = file already changed
or wrong path; 2+ matches = ambiguous, needs a human look). Either way the
original file is left untouched.
"""
import sys

OLD = """            {studies.map((s) => (
              <div className="rx-med" key={s.id}>
                <div className="row" style={{ gap: 10 }}>
                  {thumbs[s.id] ? (
                    <img
                      src={thumbs[s.id]}
                      alt={modalityLabel(s.modality)}
                      style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }}
                    />
                  ) : null}
                  <div>
                    <div className="rx-med__name">{modalityLabel(s.modality)}</div>
                    <p className="rx-med__sig">
                      <MedValue>{s.study_date ?? '—'}</MedValue>
                      {s.eye ? <> — <MedValue>{s.eye}</MedValue></> : null}
                    </p>
                    {s.file_name ? (
                      <p className="rx-med__sig"><MedText>{s.file_name}</MedText></p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}"""

NEW = """            {studies.map((s) => (
              <div className="rx-med" key={s.id}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  {thumbs[s.id] ? (
                    <img
                      src={thumbs[s.id]}
                      alt={modalityLabel(s.modality)}
                      style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }}
                    />
                  ) : null}
                  <div style={{ flex: 1 }}>
                    <div className="rx-med__name">{modalityLabel(s.modality)}</div>
                    <p className="rx-med__sig">
                      <MedValue>{s.study_date ?? '—'}</MedValue>
                      {s.eye ? <> — <MedValue>{s.eye}</MedValue></> : null}
                    </p>
                    {s.file_name ? (
                      <p className="rx-med__sig"><MedText>{s.file_name}</MedText></p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!window.confirm('حذف هذه الصورة؟')) return;
                      imaging
                        .deleteStudy(s)
                        .then(() => void loadClinicalRecord())
                        .catch((e: unknown) =>
                          toast.error(e instanceof Error ? e.message : 'تعذّر حذف الصورة'),
                        );
                    }}
                  >
                    حذف
                  </Button>
                </div>
              </div>
            ))}"""


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_delete_button_patch.py <path to DoctorPatientRecord.tsx>")
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
