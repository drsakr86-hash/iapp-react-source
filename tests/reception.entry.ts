/* Entry for tests/reception.mjs — pure helpers only, no DOM/Supabase. */
import * as wa from '../src/utils/whatsapp';
import * as filters from '../src/utils/appointmentFilters';
import * as share from '../src/utils/shareText';
import * as ledger from '../src/utils/ledgerView';
import * as theme from '../src/utils/theme';
import * as fu from '../src/utils/followUps';
import * as models from '../src/utils/models';

(globalThis as unknown as Record<string, unknown>).__iappReception = { wa, filters, share, ledger, theme, fu, models };
