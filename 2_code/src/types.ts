export type CategoryId = string;

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  /** Standard-Einstellung für neue Artikel dieser Kategorie: Leihgerät mit Rückgabepflicht? */
  defaultReturnable?: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: CategoryId;
  /** Lesbarer Name der Kategorie (für automatischen Cloud-Sync eigener Kategorien) */
  categoryLabel?: string;
  /** Haupteinheit, z. B. "Kiste", "Rolle", "Packung", "Stück", "Garnitur" */
  unit: string;
  /** Optionale Untereinheit für Gebinde, z. B. "Flasche" bei 1 Kiste = 20 Flaschen */
  subUnit?: string;
  /** Anzahl der Untereinheiten pro Haupteinheit, z. B. 20 */
  subUnitsPerUnit?: number;
  /** Erlaubt angebrochene Einheiten (z. B. 0,5 Rollen oder 0,25 Packungen) */
  allowFractions: boolean;
  /** Muss nach Nutzung wieder zurückgebracht werden (z. B. Werkzeug, Technik, Garnituren) */
  isReturnable: boolean;
  /** Aktueller Bestand in der Haupteinheit */
  quantity: number;
  /** Mindestbestand für Warnung & Einkaufsliste (in Haupteinheit) */
  minStock: number;
  /** Zielbestand / Sollbestand für automatische Einkaufsvorschläge */
  targetStock?: number;
  /** Lagerort im Vereinskeller (z. B. "Getränkekeller Regal A", "Werkzeugschrank") */
  location?: string;
  /** Suchbegriffe / Synonyme für die automatische Textblock-Erkennung */
  aliases: string[];
  updatedAt: string;
}

export type BookingMode = 'withdraw' | 'return' | 'restock';
export type TransactionType = BookingMode | 'initial_inventory';

export interface TransactionLineItem {
  itemId: string;
  itemName: string;
  /** Bestandsänderung in der Haupteinheit (negativ bei Entnahme, positiv bei Rückgabe/Befüllung) */
  quantityChange: number;
  /** Vom Nutzer eingegebene Zahl (z. B. 5 bei "5 Flaschen") */
  enteredAmount: number;
  /** Vom Nutzer gewählte Einheit (z. B. "Flasche" oder "Kiste") */
  enteredUnit: string;
  previousStock: number;
  newStock: number;
  /** Wie viel von dieser entnommenen Position bereits später zurückgegeben wurde (in Haupteinheit) */
  returnedQuantity?: number;
}

export interface InventoryTransaction {
  id: string;
  timestamp: string;
  type: TransactionType;
  personName?: string;
  eventName?: string;
  note?: string;
  /** Verknüpfung zur ursprünglichen Entnahme (beim Event-/Rückgabe-Modus) */
  relatedTransactionId?: string;
  /** Status für Ausleihen / Event-Entnahmen */
  status?: 'open_loan' | 'partially_returned' | 'completed';
  items: TransactionLineItem[];
  /** Wurde diese Buchung bereits mit der Cloud-Datenbank synchronisiert? */
  synced: boolean;
}

export interface CartEntry {
  itemId: string;
  /** Menge in der gewählten Eingabeeinheit (enteredUnit) */
  amount: number;
  /** Gewählte Einheit: Entweder item.unit oder item.subUnit */
  unit: string;
}

export interface ParsedTextItem {
  rawSegment: string;
  matchedItem?: InventoryItem;
  amount: number;
  unit: string;
  /** Umgerechnete Menge in der Haupteinheit des Artikels */
  normalizedQuantity: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface MemberAccount {
  /** Vollständiger Name der Person (z. B. "Simon Märker" oder "Celil-Kaan Beler") */
  name: string;
  /** Login-Benutzername (z. B. "simon.maerker@schuelerunion.at" bzw. "celil.kaan.beler@schuelerunion.at") */
  username: string;
  /** Zufällig vergebenes oder vom Admin angepasstes Passwort */
  password: string;
}

export interface KellerlisteItem {
  itemId: string;
  itemName: string;
  amount: number;
  unit: string;
  checked?: boolean;
}

export interface KellerlisteProject {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
  status: 'planned' | 'booked';
  bookedTransactionId?: string;
  items: KellerlisteItem[];
}

export interface BackupCode {
  /** Ersatzcode im Format XXXX-XXXX */
  code: string;
  /** Wurde dieser Code bereits einmalig eingelöst? */
  used: boolean;
  /** ISO-Zeitstempel der Einlösung */
  usedAt?: string;
}

export interface TwoFactorConfig {
  /** 2FA per Authentifizierungs-App aktiviert */
  enabled: boolean;
  /** Base32-kodiertes TOTP-Secret */
  secret: string;
  /** 10 einmalig verwendbare Ersatzcodes als Ausfallsicherheit */
  backupCodes: BackupCode[];
  /** Erstellungszeitpunkt */
  createdAt: string;
}

export interface AppSettings {
  clubName: string;
  adminPassword: string;
  /** E-Mail-Adresse für die 2-Faktor-Authentifizierung (2FA) zum Ändern des Admin-Passworts */
  adminEmail?: string;
  /** 2-Faktor-Authentifizierung per Authenticator-App (TOTP) + 10 Ersatzcodes */
  twoFactor?: TwoFactorConfig;
  /** Liste der erlaubten Namen für Buchungen / Entnahmen (im Admin-Menü anpassbar) */
  allowedMembers: string[];
  /** Zugangsdaten (Benutzername + Passwort) der berechtigten Personen für den App-Login */
  memberAccounts: MemberAccount[];
  /** Gespeicherte Kellerlisten / Projekte (ohne Bestandsabzug) */
  projectLists: KellerlisteProject[];
  pocketbaseUrl: string;
  aiProvider: 'gemini' | 'openai';
  aiApiKey: string;
  commonEvents: string[];
  categories: CategoryInfo[];
}
