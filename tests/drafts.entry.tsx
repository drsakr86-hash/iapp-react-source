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
import { Modal } from '../src/components/ui/Modal';
import { Icon } from '../src/components/ui/Icon';
import { SkeletonList } from '../src/components/ui/Skeleton';
import { ErrorState } from '../src/components/ui/ErrorState';
import { StatTile } from '../src/components/ui/StatTile';

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

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="opener" onClick={() => setOpen(true)}>open</button>
      <button id="outside">outside</button>
      {open ? (
        <Modal title="demo" onClose={() => setOpen(false)}>
          <input id="m-first" />
          <button id="m-last">last</button>
        </Modal>
      ) : null}
    </div>
  );
}

function MiscDemo({ onRetry, onTile }: { onRetry: () => void; onTile: () => void }) {
  return (
    <div>
      <Icon name="calendar" />
      <SkeletonList rows={2} />
      <ErrorState message="تعذّر التحميل" onRetry={onRetry} />
      <StatTile label="في الانتظار" value={3} active onClick={onTile} />
      <StatTile label="الكل" value={9} />
    </div>
  );
}

(globalThis as unknown as Record<string, unknown>).__iappDrafts = {
  mountModal(id: string) {
    const el = document.getElementById(id);
    if (!el) throw new Error('#' + id + ' missing');
    createRoot(el).render(<ModalDemo />);
  },
  mountMisc(id: string, onRetry: () => void, onTile: () => void) {
    const el = document.getElementById(id);
    if (!el) throw new Error('#' + id + ' missing');
    createRoot(el).render(<MiscDemo onRetry={onRetry} onTile={onTile} />);
  },
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
