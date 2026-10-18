import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppSettings, InventoryItem, InventoryTransaction } from '../types';

export const SUPABASE_SETUP_SQL = `-- Dieses Skript im Supabase "SQL Editor" einfügen und auf "Run" klicken:

create table if not exists public.keller_items (
  id text primary key,
  name text not null,
  category text not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.keller_transactions (
  id text primary key,
  timestamp timestamptz not null default now(),
  type text not null,
  payload jsonb not null
);

alter table public.keller_items enable row level security;
alter table public.keller_transactions enable row level security;

grant usage on schema public to anon, authenticated;
grant all on table public.keller_items to anon, authenticated;
grant all on table public.keller_transactions to anon, authenticated;

drop policy if exists "Vereinskeller Items Vollzugriff" on public.keller_items;
create policy "Vereinskeller Items Vollzugriff"
  on public.keller_items for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Vereinskeller Buchungen Vollzugriff" on public.keller_transactions;
create policy "Vereinskeller Buchungen Vollzugriff"
  on public.keller_transactions for all
  to anon, authenticated
  using (true)
  with check (true);
`;

export function normalizeSupabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  return rawUrl
    .trim()
    .replace(/\/rest\/v1\/?.*$/i, '')
    .replace(/\/+$/, '');
}

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

export function getSupabaseClient(settings: AppSettings): SupabaseClient | null {
  const url = normalizeSupabaseUrl(settings.supabaseUrl);
  const key = settings.supabaseAnonKey?.trim();
  if (!url || !key) return null;

  const cacheToken = `${url}::${key}`;
  if (cachedClient && cachedKey === cacheToken) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false },
    });
    cachedKey = cacheToken;
    return cachedClient;
  } catch {
    return null;
  }
}

export async function pullFromSupabase(
  settings: AppSettings
): Promise<{ items: InventoryItem[]; transactions: InventoryTransaction[] } | null> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return null;

  const [itemsRes, txRes] = await Promise.all([
    client.from('keller_items').select('payload').order('name', { ascending: true }),
    client
      .from('keller_transactions')
      .select('payload')
      .order('timestamp', { ascending: false })
      .limit(250),
  ]);

  if (itemsRes.error || txRes.error) {
    throw new Error(itemsRes.error?.message || txRes.error?.message || 'Supabase Abruf-Fehler');
  }

  const items: InventoryItem[] = (itemsRes.data || [])
    .map((r: { payload: InventoryItem }) => r.payload)
    .filter(Boolean);

  const transactions: InventoryTransaction[] = (txRes.data || [])
    .map((r: { payload: InventoryTransaction }) => ({ ...r.payload, synced: true }))
    .filter(Boolean);

  return { items, transactions };
}

export async function pushToSupabase(
  settings: AppSettings,
  items: InventoryItem[],
  transactions: InventoryTransaction[]
): Promise<boolean> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return false;

  const itemRows = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    updated_at: item.updatedAt || new Date().toISOString(),
    payload: item,
  }));

  const unsyncedTxs = transactions.filter((tx) => !tx.synced);
  const txRows = (unsyncedTxs.length > 0 ? unsyncedTxs : transactions.slice(0, 50)).map((tx) => ({
    id: tx.id,
    timestamp: tx.timestamp,
    type: tx.type,
    payload: { ...tx, synced: true },
  }));

  if (itemRows.length > 0) {
    const { error: itemErr } = await client
      .from('keller_items')
      .upsert(itemRows, { onConflict: 'id' });
    if (itemErr) throw new Error(itemErr.message);
  }

  if (txRows.length > 0) {
    const { error: txErr } = await client
      .from('keller_transactions')
      .upsert(txRows, { onConflict: 'id' });
    if (txErr) throw new Error(txErr.message);
  }

  return true;
}

export async function deleteItemFromSupabase(settings: AppSettings, itemId: string): Promise<void> {
  const client = getSupabaseClient(settings);
  if (!client || !navigator.onLine) return;
  await client.from('keller_items').delete().eq('id', itemId);
}

/**
 * Erzeugt einen Einladungs-Link (inkl. Datenbank-Zugangsdaten), der als QR-Code an die Kellertür
 * gehängt werden kann, damit Vereinsmitglieder mit 1 Scan sofort mit derselben Datenbank verbunden sind.
 */
export function buildShareableAppUrl(settings: AppSettings): string {
  const isNativeOrLocal =
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost';
  const baseUrl = isNativeOrLocal
    ? 'https://erdbeerwaffel311.github.io/inventurprogramm/'
    : window.location.origin + window.location.pathname;
  const params = new URLSearchParams();
  if (settings.clubName) params.set('club', settings.clubName);
  const cleanUrl = normalizeSupabaseUrl(settings.supabaseUrl);
  if (cleanUrl) params.set('dbUrl', cleanUrl);
  if (settings.supabaseAnonKey) params.set('dbKey', settings.supabaseAnonKey);

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}
