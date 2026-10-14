/* -------------------------------------------------------------------------
 * displayDevices service — registering the waiting-room screens.
 * -------------------------------------------------------------------------
 * Doctor/admin only (enforced by the database, not by this file). A screen's
 * token is returned exactly once, by create(); only its hash is stored, so
 * there is no way to show the link again — a lost link means revoke + create.
 * ---------------------------------------------------------------------- */

import { supabase } from './supabase';
import { reportError } from '../utils/errors';

export interface DisplayDevice {
  id: string;
  clinic_id: string;
  label: string;
  show_names: boolean;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

const COLS = 'id, clinic_id, label, show_names, is_active, created_at, last_seen_at, revoked_at' as const;

export async function list(): Promise<DisplayDevice[]> {
  const { data, error } = await supabase
    .from('display_devices')
    .select(COLS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(reportError(error, 'شاشات الانتظار'));
  return data ?? [];
}

export async function create(input: {
  clinicId: string;
  label: string;
  showNames: boolean;
}): Promise<{ deviceId: string; token: string }> {
  const { data, error } = await supabase.rpc('create_display_device', {
    p_clinic_id: input.clinicId,
    p_label: input.label.trim(),
    p_show_names: input.showNames,
  });
  if (error) throw new Error(reportError(error, 'شاشات الانتظار'));
  const row = data?.[0];
  if (!row?.token) throw new Error('تعذّر إنشاء الشاشة — حاول مرة أخرى');
  return { deviceId: row.device_id, token: row.token };
}

export async function revoke(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_display_device', { p_id: id });
  if (error) throw new Error(reportError(error, 'شاشات الانتظار'));
}

export async function setShowNames(id: string, show: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_display_device_names', { p_id: id, p_show: show });
  if (error) throw new Error(reportError(error, 'شاشات الانتظار'));
}

/**
 * The address to open on the TV. Built from the page's own origin + the app's
 * base path. The trailing slash matters: GitHub Pages serves display/index.html
 * (a real file, status 200) for it; without the slash Pages must redirect first.
 */
export function displayUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}display/?t=${token}`;
}
