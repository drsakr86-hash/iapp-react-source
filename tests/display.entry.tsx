/* Entry for tests/display.mjs — the waiting-room screen, its pure logic, the
   announcer and the staff calling service, bundled to run inside jsdom. */
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import QueueDisplay from '../src/pages/display/QueueDisplay';
import { QueueDisplayView } from '../src/components/display/QueueDisplayView';
import * as qd from '../src/utils/queueDisplay';
import * as announce from '../src/utils/announce';
import * as filters from '../src/utils/appointmentFilters';
import * as errors from '../src/utils/errors';
import * as queueSvc from '../src/services/queue';
import * as displayDevices from '../src/services/displayDevices';

(globalThis as unknown as Record<string, unknown>).__iappDisplay = {
  mount(el: HTMLElement, props: { pollBaseMs?: number } = {}) {
    const root = createRoot(el);
    root.render(<QueueDisplay {...props} />);
    return root;
  },
  renderView(props: Parameters<typeof QueueDisplayView>[0]) {
    return renderToStaticMarkup(<QueueDisplayView {...props} />);
  },
  qd,
  announce,
  filters,
  errors,
  queueSvc,
  displayDevices,
};
