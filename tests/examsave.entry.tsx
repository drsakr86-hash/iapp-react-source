/* Entry for tests/examsave.mjs — the real ExaminationForm and the
   examinations service, so "partial save" is asserted against the DOM and the
   exact requests sent, not against source text. */
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../src/contexts/ToastContext';
import { ExaminationForm } from '../src/components/doctor/ExaminationForm';
import * as svc from '../src/services/examinations';
import * as store from '../src/utils/draftStore';
import type { Patient } from '../src/types/clinical';

(globalThis as unknown as Record<string, unknown>).__iappExam = {
  svc,
  store,
  mount(el: HTMLElement, patientId: string, visitId: string, cb: { saved: number; closed: number }) {
    const root = createRoot(el);
    root.render(
      <ToastProvider>
        <ExaminationForm
          patient={{ id: patientId, full_name: 'مريض اختبار' } as unknown as Patient}
          visitId={visitId}
          onClose={() => {
            cb.closed += 1;
          }}
          onSaved={() => {
            cb.saved += 1;
          }}
        />
      </ToastProvider>,
    );
    return root;
  },
};
