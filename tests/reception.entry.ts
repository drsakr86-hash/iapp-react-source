/* Entry for tests/reception.mjs — pure helpers only, no DOM/Supabase. */
import * as wa from '../src/utils/whatsapp';
import * as filters from '../src/utils/appointmentFilters';

(globalThis as unknown as Record<string, unknown>).__iappReception = { wa, filters };
