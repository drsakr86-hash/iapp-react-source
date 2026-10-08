/* Entry for tests/drafts.mjs — the pure draft store plus the real hook/UI
 * (useDraftState, DraftBanner, Tabs, PatientBar) mounted into jsdom, so the
 * restore-after-reload behaviour is asserted against the rendered DOM. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import * as store from '../src/utils/draftStore';
import { useDraftState } from '../src/hooks/useDraft';
import { DraftBanner } from '../src/components/ui/DraftBanner';
import { TabPanel, Tabs } from '../src/components/ui/Tabs';
import { PatientBar } from '../src/components/doctor/PatientBar';

function Probe({ scope }: { scope: string[] }) {
  const d = useDraftState<{ text: string }>(scope, () => ({ text: '' }));
  return (
    <div>
      <DraftBanner restoredAt={d.restoredAt} onDiscard={d.discard} />
      <input id="probe-input" value={d.value.text} onChange={(e) => d.set({ text: e.target.value })} />
      <button id="probe-save" onClick={() => d.clear()}>save</button>
    </div>
  );
}

function TabsDemo({ allergies }: { allergies: string | null }) {
  const [tab, setTab] = useState<'a' | 'b'>('a');
  return (
    <div>
      <PatientBar name="مريض تجريبي" code="P-1" age={42} allergies={allergies} visitOpen>
        <Tabs
          label="demo"
          idPrefix="t"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'a', label: 'أ' },
            { key: 'b', label: 'ب', badge: 3 },
          ]}
        />
      </PatientBar>
      <TabPanel active={tab === 'a'} id="a" idPrefix="t">
        <input id="keep" />
      </TabPanel>
      <TabPanel active={tab === 'b'} id="b" idPrefix="t">
        panel-b
      </TabPanel>
    </div>
  );
}

(globalThis as unknown as Record<string, unknown>).__iappDrafts = {
  store,
  mountProbe(id: string, scope: string[]) {
    const el = document.getElementById(id);
    if (!el) throw new Error('#' + id + ' missing');
    createRoot(el).render(<Probe scope={scope} />);
  },
  mountTabs(id: string, allergies: string | null) {
    const el = document.getElementById(id);
    if (!el) throw new Error('#' + id + ' missing');
    createRoot(el).render(<TabsDemo allergies={allergies} />);
  },
};
