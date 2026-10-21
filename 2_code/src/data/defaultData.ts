import { CategoryInfo, InventoryItem, AppSettings, InventoryTransaction } from '../types';

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'drinks_food',
    label: 'Getränke & Lebensmittel',
    shortLabel: 'Getränke & Essen',
    description: 'Kisten, Einzelflaschen, Kaffee, Snacks',
    color: 'amber',
  },
  {
    id: 'consumables',
    label: 'Verbrauchsmaterial',
    shortLabel: 'Verbrauch',
    description: 'Müllsäcke, Klebeband, Servietten, Reinigungsmittel',
    color: 'emerald',
  },
  {
    id: 'equipment',
    label: 'Werkzeug, Technik & Inventar',
    shortLabel: 'Werkzeug & Technik',
    description: 'Leihgeräte, Bierzeltgarnituren, Kabel, Technik (wird zurückgebracht)',
    color: 'sky',
    defaultReturnable: true,
  },
];

export const DEFAULT_ALLOWED_MEMBERS: string[] = [
  'Simon Märker',
  'Aaron Hammerer',
  'Amina Amann',
  'Angelina Fitsch',
  'Anton Loss',
  'Celil-Kaan Beler',
  'Chiara Forcher',
  'Elias Mantler',
  'Emil Schmalfuss',
  'Fabian Stauss',
  'Hannah Grabher',
  'Ian Hörburger',
  'Ismail Öztoprak',
  'Josefine Müller',
  'Jeramis Dengel',
  'Juliana Moosbrugger',
  'Kaspar Riedmann',
  'Katharina Nigg',
  'Leon Schwendinger',
  'Elisabeth Himmer',
  'Liljana Walser',
  'Marian Kolanovic',
  'Paulus Cukrowicz',
  'Rania Moosbrugger',
  'Nick Klein',
  'Sophia-Maria Thoma',
  'Emma Holzer',
  'Elias Mathis',
];

export const DEFAULT_SETTINGS: AppSettings = {
  clubName: 'Vereinskeller',
  adminPassword: 'admin',
  adminEmail: '',
  allowedMembers: DEFAULT_ALLOWED_MEMBERS,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://zdduvvluqairhnbdbunk.supabase.co',
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_CEjKQudAlYxYtTvykEwDxw_E4KvyUhC',
  aiProvider: 'gemini',
  aiApiKey: '',
  commonEvents: ['Sommerfest', 'Vereinsabend', 'Arbeitseinsatz', 'Vorstandssitzung', 'Turnier / Spieltag'],
  categories: CATEGORIES,
};

// Kein automatisches Beispielinventar – Start mit leerem Kellerbestand
export const DEFAULT_ITEMS: InventoryItem[] = [];

export const DEFAULT_TRANSACTIONS: InventoryTransaction[] = [];

// IDs des früheren Beispielinventars (zum automatischen Bereinigen alter Browser-Caches)
export const LEGACY_DEMO_ITEM_IDS = new Set([
  'item-bier-pils',
  'item-cola-mix',
  'item-wasser-sprudel',
  'item-apfelschorle',
  'item-kaffee',
  'item-gaffa-tape',
  'item-muellsaecke',
  'item-servietten',
  'item-spuelmittel',
  'item-kuechenrolle',
  'item-bierzeltgarnitur',
  'item-kabeltrommel',
  'item-akkuschrauber',
  'item-musikbox',
  'item-stehtisch',
]);

export const LEGACY_DEMO_TX_IDS = new Set(['tx-demo-1']);
