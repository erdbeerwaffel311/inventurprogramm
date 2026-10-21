import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  ClipboardCheck,
  Package,
  FileSpreadsheet,
  Settings,
  Plus,
  Trash2,
  Edit3,
  Check,
  Download,
  Upload,
  Copy,
  QrCode,
  Printer,
  Database,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  FolderPlus,
  Tag,
  Mail,
  ShieldCheck,
  KeyRound,
  Users,
  UserPlus,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AppSettings,
  CategoryId,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
} from '../types';
import { CATEGORIES, DEFAULT_ALLOWED_MEMBERS } from '../data/defaultData';
import {
  formatGermanNumber,
  formatStockDisplay,
  roundStock,
} from '../utils/units';
import {
  downloadTextFile,
  exportInventoryToCsv,
  exportTransactionsToCsv,
  generateCsvTemplate,
  parseInventoryCsv,
  slugifyCategoryId,
} from '../utils/csvHelper';
import {
  buildShareableAppUrl,
  getSupabaseClient,
  sendAdmin2FAEmail,
  SUPABASE_SETUP_SQL,
  verifyAdmin2FACode,
} from '../utils/supabaseSync';

interface AdminViewProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  settings: AppSettings;
  isUnlocked: boolean;
  onUnlock: () => void;
  onLock: () => void;
  initial2FAVerified?: boolean;
  onClearInitial2FAVerified?: () => void;
  onSaveInitialInventory: (updatedQuantities: Record<string, number>, note?: string) => void;
  onUpsertItem: (item: InventoryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onBulkImportItems: (
    newItems: InventoryItem[],
    newCategories: CategoryInfo[],
    summaryNote: string
  ) => void;
  onUpdateSettings: (newSettings: AppSettings, deletedCatId?: string) => void;
  onManualSync: () => void;
  isSyncing: boolean;
}

export const AdminView: React.FC<AdminViewProps> = ({
  items,
  transactions,
  settings,
  isUnlocked,
  onUnlock,
  onLock,
  initial2FAVerified,
  onClearInitial2FAVerified,
  onSaveInitialInventory,
  onUpsertItem,
  onDeleteItem,
  onBulkImportItems,
  onUpdateSettings,
  onManualSync,
  isSyncing,
}) => {
  const activeCategories = settings.categories?.length ? settings.categories : CATEGORIES;
  const activeAllowedMembers =
    Array.isArray(settings.allowedMembers) && settings.allowedMembers.length > 0
      ? settings.allowedMembers
      : DEFAULT_ALLOWED_MEMBERS;

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<
    'inventory' | 'items' | 'csv' | 'settings'
  >('inventory');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState('');

  // State für Erstinventur (itemId -> { main: string, sub: string })
  const [counts, setCounts] = useState<Record<string, { main: string; sub: string }>>(() =>
    buildInitialCountState(items)
  );
  const [inventoryNote, setInventoryNote] = useState('Erstinventur / Bestandszählung');

  // State für Neue Kategorie anlegen
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryShort, setNewCategoryShort] = useState('');
  const [newCategoryReturnable, setNewCategoryReturnable] = useState(false);
  const [inlineNewCategoryMode, setInlineNewCategoryMode] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState('');

  // State für Artikel anlegen / bearbeiten
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [itemForm, setItemForm] = useState<{
    name: string;
    category: CategoryId;
    unit: string;
    subUnit: string;
    subUnitsPerUnit: string;
    allowFractions: boolean;
    isReturnable: boolean;
    quantity: string;
    minStock: string;
    targetStock: string;
    location: string;
    aliases: string;
  }>({
    name: '',
    category: activeCategories[0]?.id || 'drinks_food',
    unit: 'Kiste',
    subUnit: 'Flasche',
    subUnitsPerUnit: '20',
    allowFractions: true,
    isReturnable: false,
    quantity: '0',
    minStock: '2',
    targetStock: '5',
    location: '',
    aliases: '',
  });

  // State für Einstellungen
  const [settingsForm, setSettingsForm] = useState<AppSettings>(settings);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // State für 2FA-Schutz (Admin-Passwort & 2FA-E-Mail-Adresse)
  const [initial2FAEmailInput, setInitial2FAEmailInput] = useState(settings.adminEmail || '');
  const [twoFactorStage, setTwoFactorStage] = useState<'idle' | 'code_sent' | 'verified'>('idle');
  const [twoFactorCodeInput, setTwoFactorCodeInput] = useState('');
  const [twoFactorNewPassword, setTwoFactorNewPassword] = useState('');
  const [twoFactorNewEmail, setTwoFactorNewEmail] = useState(settings.adminEmail || '');
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  useEffect(() => {
    setSettingsForm(settings);
    if (settings.adminEmail) {
      setTwoFactorNewEmail(settings.adminEmail);
    }
  }, [settings]);

  useEffect(() => {
    if (initial2FAVerified) {
      setTwoFactorStage('verified');
      setTwoFactorNewEmail(settings.adminEmail || '');
      setAdminSubTab('settings');
      onClearInitial2FAVerified?.();
    }
  }, [initial2FAVerified, settings.adminEmail]);

  function handleAddAllowedMember(e: React.FormEvent) {
    e.preventDefault();
    const rawEntries = newMemberName
      .split(/[\n,;]+/)
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (rawEntries.length === 0) return;

    const nextList = [...activeAllowedMembers];
    let addedCount = 0;
    for (const candidate of rawEntries) {
      const exists = nextList.some(
        (m) => m.trim().toLowerCase() === candidate.toLowerCase()
      );
      if (!exists) {
        nextList.push(candidate);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      const nextSettings: AppSettings = {
        ...settings,
        allowedMembers: nextList,
      };
      setSettingsForm(nextSettings);
      onUpdateSettings(nextSettings);
      showBanner(
        addedCount === 1
          ? `Person „${rawEntries[0]}“ wurde zur Namensliste hinzugefügt.`
          : `${addedCount} Personen wurden zur Namensliste hinzugefügt.`
      );
    }
    setNewMemberName('');
  }

  function handleRemoveAllowedMember(memberToRemove: string) {
    const nextList = activeAllowedMembers.filter((m) => m !== memberToRemove);
    const nextSettings: AppSettings = {
      ...settings,
      allowedMembers: nextList,
    };
    setSettingsForm(nextSettings);
    onUpdateSettings(nextSettings);
    showBanner(`Person „${memberToRemove}“ wurde aus der Namensliste entfernt.`);
  }

  // Automatische Erkennung, falls der Nutzer auf den 2FA-Bestätigungslink in der E-Mail geklickt hat
  useEffect(() => {
    const client = getSupabaseClient(settings);
    if (!client || !settings.adminEmail) return;

    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
        session?.user?.email?.toLowerCase() === settings.adminEmail?.trim().toLowerCase()
      ) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('2fa') === 'verify' || window.location.hash.includes('access_token')) {
          setTwoFactorStage('verified');
          setTwoFactorNewEmail(settings.adminEmail || '');
          setAdminSubTab('settings');
          if (!isUnlocked) {
            onUnlock();
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [settings, isUnlocked]);

  async function handleRequest2FACode() {
    if (!settings.adminEmail?.trim()) return;
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      await sendAdmin2FAEmail(settings, settings.adminEmail);
      setTwoFactorStage('code_sent');
      setTwoFactorNewEmail(settings.adminEmail);
      setTwoFactorNewPassword('');
      showBanner(`2FA-Bestätigungs-E-Mail wurde an ${settings.adminEmail} gesendet!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Senden der 2FA-E-Mail.';
      setTwoFactorError(msg);
    } finally {
      setTwoFactorLoading(false);
    }
  }

  async function handleVerify2FACode(e: React.FormEvent) {
    e.preventDefault();
    if (!settings.adminEmail?.trim() || !twoFactorCodeInput.trim()) return;
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      const ok = await verifyAdmin2FACode(settings, settings.adminEmail, twoFactorCodeInput);
      if (ok) {
        setTwoFactorStage('verified');
        setTwoFactorCodeInput('');
        setTwoFactorError(null);
        showBanner('2FA erfolgreich bestätigt! Du kannst Passwort und 2FA-E-Mail jetzt ändern.');
      } else {
        setTwoFactorError(
          'Ungültiger oder abgelaufener Code. Bitte prüfe den Zahlencode oder füge den Bestätigungs-Link aus der E-Mail ein.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '2FA-Prüfung fehlgeschlagen.';
      setTwoFactorError(msg);
    } finally {
      setTwoFactorLoading(false);
    }
  }

  function handleSave2FAProtectedChanges(e: React.FormEvent) {
    e.preventDefault();
    if (twoFactorStage !== 'verified') return;

    const nextEmail = twoFactorNewEmail.trim();
    if (!nextEmail || !nextEmail.includes('@')) {
      setTwoFactorError('Bitte eine gültige 2FA-E-Mail-Adresse eingeben.');
      return;
    }

    const nextPassword = twoFactorNewPassword.trim()
      ? twoFactorNewPassword.trim()
      : settings.adminPassword;

    const updated: AppSettings = {
      ...settingsForm,
      adminPassword: nextPassword,
      adminEmail: nextEmail,
    };

    setSettingsForm(updated);
    onUpdateSettings(updated);
    setTwoFactorStage('idle');
    setTwoFactorNewPassword('');
    setTwoFactorError(null);
    showBanner('Admin-Passwort und 2FA-E-Mail-Adresse wurden sicher aktualisiert!');
  }

  function handleSaveInitial2FAEmail() {
    const clean = initial2FAEmailInput.trim();
    if (!clean || !clean.includes('@')) {
      setTwoFactorError('Bitte eine gültige E-Mail-Adresse für den 2FA-Schutz eingeben.');
      return;
    }
    const updated: AppSettings = {
      ...settingsForm,
      adminPassword: settings.adminPassword,
      adminEmail: clean,
    };
    setSettingsForm(updated);
    onUpdateSettings(updated);
    setTwoFactorError(null);
    showBanner(`2FA-Schutz mit E-Mail „${clean}“ erfolgreich aktiviert!`);
  }

  function showBanner(msg: string) {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  }

  function buildInitialCountState(list: InventoryItem[]) {
    const map: Record<string, { main: string; sub: string }> = {};
    for (const item of list) {
      if (item.subUnit && item.subUnitsPerUnit && item.subUnitsPerUnit > 1) {
        const totalSub = Math.round(item.quantity * item.subUnitsPerUnit);
        const fullMain = Math.trunc(totalSub / item.subUnitsPerUnit);
        const remSub = totalSub % item.subUnitsPerUnit;
        map[item.id] = {
          main: String(fullMain),
          sub: String(remSub),
        };
      } else {
        map[item.id] = {
          main: formatGermanNumber(item.quantity),
          sub: '0',
        };
      }
    }
    return map;
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInput === settings.adminPassword) {
      setPasswordError(false);
      setPasswordInput('');
      setCounts(buildInitialCountState(items));
      onUnlock();
    } else {
      setPasswordError(true);
    }
  }

  function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    const label = newCategoryName.trim();
    if (!label) return;

    const id = slugifyCategoryId(label);
    if (activeCategories.some((c) => c.id === id || c.label.toLowerCase() === label.toLowerCase())) {
      showBanner(`Die Kategorie „${label}“ existiert bereits.`);
      return;
    }

    const shortLabel =
      newCategoryShort.trim() || (label.length > 18 ? label.slice(0, 16) + '…' : label);

    const newCat: CategoryInfo = {
      id,
      label,
      shortLabel,
      description: newCategoryReturnable
        ? 'Leihgeräte / Inventar mit Rückgabepflicht'
        : 'Eigene Vereins-Kategorie',
      color: 'violet',
      defaultReturnable: newCategoryReturnable,
    };

    const nextCategories = [...activeCategories, newCat];
    const nextSettings = { ...settings, categories: nextCategories };
    setSettingsForm(nextSettings);
    onUpdateSettings(nextSettings);

    setNewCategoryName('');
    setNewCategoryShort('');
    setNewCategoryReturnable(false);
    setItemForm((prev) => ({
      ...prev,
      category: newCat.id,
      isReturnable: Boolean(newCat.defaultReturnable),
    }));
    showBanner(`Neue Kategorie „${newCat.label}“ erfolgreich angelegt!`);
  }

  function handleDeleteCategory(catId: string) {
    if (activeCategories.length <= 1) {
      window.alert('Mindestens eine Kategorie muss erhalten bleiben.');
      return;
    }
    const itemsInCat = items.filter((i) => i.category === catId);
    if (itemsInCat.length > 0) {
      window.alert(
        `In dieser Kategorie befinden sich noch ${itemsInCat.length} Artikel. Bitte ordne diese Artikel zuerst einer anderen Kategorie zu oder lösche sie.`
      );
      return;
    }
    const targetCat = activeCategories.find((c) => c.id === catId);
    if (!window.confirm(`Kategorie „${targetCat?.label || catId}“ wirklich löschen?`)) {
      return;
    }

    const nextCategories = activeCategories.filter((c) => c.id !== catId);
    const nextSettings = { ...settings, categories: nextCategories };
    setSettingsForm(nextSettings);
    onUpdateSettings(nextSettings, catId);
    showBanner(`Kategorie „${targetCat?.label || catId}“ wurde gelöscht.`);
  }

  function handleSaveInventoryCounts() {
    const updatedQuantities: Record<string, number> = {};
    for (const item of items) {
      const entry = counts[item.id];
      if (!entry) continue;
      const mainVal = Math.max(0, parseFloat(entry.main.replace(',', '.')) || 0);
      const subVal = Math.max(0, parseFloat(entry.sub.replace(',', '.')) || 0);
      if (item.subUnit && item.subUnitsPerUnit && item.subUnitsPerUnit > 1) {
        updatedQuantities[item.id] = roundStock(mainVal + subVal / item.subUnitsPerUnit);
      } else {
        updatedQuantities[item.id] = roundStock(mainVal);
      }
    }
    onSaveInitialInventory(updatedQuantities, inventoryNote);
    showBanner('Inventur erfolgreich abgeschlossen! Alle Bestände wurden aktualisiert.');
  }

  function startEditItem(item: InventoryItem) {
    setEditingItem(item);
    setInlineNewCategoryMode(false);
    setItemForm({
      name: item.name,
      category: item.category,
      unit: item.unit,
      subUnit: item.subUnit || '',
      subUnitsPerUnit: item.subUnitsPerUnit ? String(item.subUnitsPerUnit) : '',
      allowFractions: item.allowFractions,
      isReturnable: item.isReturnable,
      quantity: formatGermanNumber(item.quantity),
      minStock: formatGermanNumber(item.minStock),
      targetStock: item.targetStock !== undefined ? formatGermanNumber(item.targetStock) : '',
      location: item.location || '',
      aliases: item.aliases.join(', '),
    });
    setAdminSubTab('items');
  }

  function resetItemForm() {
    setEditingItem(null);
    setInlineNewCategoryMode(false);
    setInlineCategoryName('');
    setItemForm({
      name: '',
      category: activeCategories[0]?.id || 'drinks_food',
      unit: 'Kiste',
      subUnit: '',
      subUnitsPerUnit: '',
      allowFractions: true,
      isReturnable: false,
      quantity: '0',
      minStock: '1',
      targetStock: '4',
      location: '',
      aliases: '',
    });
  }

  function handleSaveItemForm(e: React.FormEvent) {
    e.preventDefault();
    if (!itemForm.name.trim()) return;

    let chosenCategoryId = itemForm.category;
    let chosenCategoryLabel =
      activeCategories.find((c) => c.id === chosenCategoryId)?.label || chosenCategoryId;

    // Falls direkt im Artikel-Formular eine neue Kategorie eingetippt wurde:
    if (inlineNewCategoryMode && inlineCategoryName.trim()) {
      const label = inlineCategoryName.trim();
      const newId = slugifyCategoryId(label);
      const existing = activeCategories.find(
        (c) => c.id === newId || c.label.toLowerCase() === label.toLowerCase()
      );
      if (existing) {
        chosenCategoryId = existing.id;
        chosenCategoryLabel = existing.label;
      } else {
        const newCat: CategoryInfo = {
          id: newId,
          label,
          shortLabel: label.length > 18 ? label.slice(0, 16) + '…' : label,
          description: 'Eigene Vereins-Kategorie',
          color: 'violet',
          defaultReturnable: itemForm.isReturnable,
        };
        const nextCategories = [...activeCategories, newCat];
        const nextSettings = { ...settings, categories: nextCategories };
        setSettingsForm(nextSettings);
        onUpdateSettings(nextSettings);
        chosenCategoryId = newCat.id;
        chosenCategoryLabel = newCat.label;
      }
    }

    const factor = parseInt(itemForm.subUnitsPerUnit, 10);
    const hasSubUnit = Boolean(itemForm.subUnit.trim() && !isNaN(factor) && factor > 1);

    const newItem: InventoryItem = {
      id: editingItem ? editingItem.id : `item-${Date.now()}`,
      name: itemForm.name.trim(),
      category: chosenCategoryId,
      categoryLabel: chosenCategoryLabel,
      unit: itemForm.unit.trim() || 'Stück',
      subUnit: hasSubUnit ? itemForm.subUnit.trim() : undefined,
      subUnitsPerUnit: hasSubUnit ? factor : undefined,
      allowFractions: itemForm.allowFractions,
      isReturnable: itemForm.isReturnable,
      quantity: roundStock(Math.max(0, parseFloat(itemForm.quantity.replace(',', '.')) || 0)),
      minStock: roundStock(Math.max(0, parseFloat(itemForm.minStock.replace(',', '.')) || 0)),
      targetStock: itemForm.targetStock.trim()
        ? roundStock(Math.max(0, parseFloat(itemForm.targetStock.replace(',', '.')) || 0))
        : undefined,
      location: itemForm.location.trim() || undefined,
      aliases: itemForm.aliases
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
      updatedAt: new Date().toISOString(),
    };

    if (newItem.aliases.length === 0) {
      newItem.aliases = [newItem.name.toLowerCase().split(' ')[0]];
    }

    onUpsertItem(newItem);
    setCounts((prev) => ({
      ...prev,
      [newItem.id]: {
        main: formatGermanNumber(newItem.quantity),
        sub: '0',
      },
    }));
    showBanner(
      editingItem
        ? `Artikel „${newItem.name}“ wurde aktualisiert.`
        : `Neuer Artikel „${newItem.name}“ wurde angelegt.`
    );
    resetItemForm();
  }

  function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      const result = parseInventoryCsv(content, items, activeCategories);
      onBulkImportItems(
        result.items,
        result.categories,
        `CSV-Import (${result.addedCount} neu, ${result.updatedCount} aktualisiert)`
      );
      setCounts(buildInitialCountState(result.items));
      showBanner(
        `CSV-Import erfolgreich: ${result.addedCount} Artikel neu angelegt, ${result.updatedCount} aktualisiert.`
      );
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  if (!isUnlocked) {
    return (
      <div className="max-w-md mx-auto my-8 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <Lock className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h2 className="font-bold text-white text-lg">Admin-Bereich & Erstinventur</h2>
            <p className="text-xs text-slate-400">
              Passwortgeschützter Bereich für Erstinventur, Artikelpflege & Cloud-Datenbank
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Admin-Passwort eingeben
            </label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Passwort"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-sm text-white"
            />
            {passwordError && (
              <p className="text-xs text-rose-400 mt-1.5">
                Falsches Passwort.
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer"
          >
            <Unlock className="w-4 h-4" />
            <span>Admin-Bereich entsperren</span>
          </button>
        </form>
      </div>
    );
  }

  const shareUrl = buildShareableAppUrl(settingsForm);

  return (
    <div className="space-y-5 pb-20">
      {/* Nur beim Drucken sichtbarer Kellertür-QR-Code-Aushang */}
      <div className="hidden print-only p-8 text-center space-y-6">
        <h1 className="text-3xl font-bold">{settings.clubName} – Digitale Kellerliste</h1>
        <p className="text-lg">
          Bitte jede <strong>Entnahme</strong>, <strong>Rückgabe</strong> und{' '}
          <strong>Befüllung</strong> kurz per Smartphone eintragen!
        </p>
        <div className="inline-block p-6 border-4 border-black rounded-2xl">
          <QRCodeSVG value={shareUrl} size={260} />
        </div>
        <p className="text-base font-medium">
          Kamera öffnen & QR-Code scannen – kein Login oder Passwort für Buchungen nötig!
        </p>
      </div>

      {statusMessage && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 no-print">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Admin Sub-Navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => {
              setCounts(buildInitialCountState(items));
              setAdminSubTab('inventory');
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              adminSubTab === 'inventory'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>1. Erstinventur / Zählung</span>
          </button>

          <button
            onClick={() => setAdminSubTab('items')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              adminSubTab === 'items'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>2. Artikel & Kategorien</span>
          </button>

          <button
            onClick={() => setAdminSubTab('csv')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              adminSubTab === 'csv'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>3. CSV / Excel Import & Export</span>
          </button>

          <button
            onClick={() => setAdminSubTab('settings')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              adminSubTab === 'settings'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>4. Personen, Datenbank & Passwort</span>
          </button>
        </div>

        <button
          onClick={onLock}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Sperren</span>
        </button>
      </div>

      {/* SUB-TAB 1: ERSTINVENTUR & SCHNELLZÄHLUNG */}
      {adminSubTab === 'inventory' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 no-print">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base sm:text-lg">
                Erstinventur & Bestands-Schnellzählung
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Trage hier für alle Artikel im Keller den gezählten Ist-Bestand ein (auch angebrochene Kisten / Einzelflaschen). Mit einem Klick unten werden alle Bestände gespeichert.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                resetItemForm();
                setAdminSubTab('items');
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-semibold border border-slate-700 self-start sm:self-auto cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Artikel / Kategorie hinzufügen</span>
            </button>
          </div>

          <div className="space-y-4">
            {activeCategories.map((cat) => {
              const catItems = items.filter((i) => i.category === cat.id);
              if (catItems.length === 0) return null;

              return (
                <div key={cat.id} className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 px-1">
                    {cat.label}
                  </h4>
                  <div className="space-y-2">
                    {catItems.map((item) => {
                      const entry = counts[item.id] || {
                        main: String(item.quantity),
                        sub: '0',
                      };

                      return (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-white">{item.name}</span>
                              <button
                                type="button"
                                onClick={() => startEditItem(item)}
                                className="text-xs text-slate-500 hover:text-sky-400 cursor-pointer"
                                title="Artikeldetails bearbeiten"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-slate-400">
                              Bisheriger Soll-Bestand:{' '}
                              <strong className="text-slate-200">
                                {formatStockDisplay(item).primaryText}
                              </strong>
                              {item.location ? ` • ${item.location}` : ''}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={entry.main}
                                onChange={(e) =>
                                  setCounts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...entry, main: e.target.value },
                                  }))
                                }
                                className="w-16 text-right font-bold text-sm text-white bg-transparent focus:outline-none"
                              />
                              <span className="text-xs font-medium text-sky-300">{item.unit}</span>
                            </div>

                            {item.subUnit && item.subUnitsPerUnit && (
                              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5">
                                <span className="text-xs text-slate-400">+</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={item.subUnitsPerUnit - 1}
                                  value={entry.sub}
                                  onChange={(e) =>
                                    setCounts((prev) => ({
                                      ...prev,
                                      [item.id]: { ...entry, sub: e.target.value },
                                    }))
                                  }
                                  className="w-12 text-right font-bold text-sm text-white bg-transparent focus:outline-none"
                                />
                                <span className="text-xs font-medium text-amber-300">
                                  {item.subUnit}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <input
              type="text"
              value={inventoryNote}
              onChange={(e) => setInventoryNote(e.target.value)}
              placeholder="Bemerkung zur Inventur (z. B. Erstinventur Oktober)"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm text-white"
            />
            <button
              type="button"
              onClick={handleSaveInventoryCounts}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
              <span>Inventur-Bestände jetzt übernehmen & speichern</span>
            </button>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: ARTIKEL & KATEGORIEN VERWALTEN */}
      {adminSubTab === 'items' && (
        <div className="space-y-5 no-print">
          {/* KATEGORIEN-VERWALTUNG OBEN */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-sky-400" />
                  <span>Kategorien verwalten ({activeCategories.length})</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Lege eigene Kategorien für euren Vereinskeller an (z. B. „Deko & Festzelt“, „Putzkammer“, „Jugendabteilung“). Diese erscheinen sofort als Filter in der Klick-Liste.
                </p>
              </div>
            </div>

            {/* Vorhandene Kategorien als Chips */}
            <div className="flex flex-wrap gap-2">
              {activeCategories.map((cat) => {
                const count = items.filter((i) => i.category === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                  >
                    <Tag className="w-3.5 h-3.5 text-sky-400" />
                    <span className="font-semibold text-white">{cat.label}</span>
                    <span className="text-slate-400">({count} Artikel)</span>
                    {cat.defaultReturnable && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300">
                        Leihgeräte
                      </span>
                    )}
                    {count === 0 && activeCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="text-slate-500 hover:text-rose-400 ml-1 cursor-pointer"
                        title="Leere Kategorie löschen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Formular: Neue Kategorie anlegen */}
            <form
              onSubmit={handleCreateCategory}
              className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5 pt-2 border-t border-slate-800/80"
            >
              <div className="flex-1">
                <label className="block text-xs text-slate-300 mb-1">
                  Name der neuen Kategorie *
                </label>
                <input
                  type="text"
                  required
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="z. B. Deko & Partybedarf, Grillzubehör, Reinigung..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                />
              </div>

              <div className="sm:w-44">
                <label className="block text-xs text-slate-300 mb-1">
                  Kurzname für Tab (optional)
                </label>
                <input
                  type="text"
                  value={newCategoryShort}
                  onChange={(e) => setNewCategoryShort(e.target.value)}
                  placeholder="z. B. Deko & Party"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                />
              </div>

              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 cursor-pointer h-[38px]">
                <input
                  type="checkbox"
                  checked={newCategoryReturnable}
                  onChange={(e) => setNewCategoryReturnable(e.target.checked)}
                  className="rounded accent-sky-500"
                />
                <span>Leihgeräte (Rückgabe)</span>
              </label>

              <button
                type="submit"
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs sm:text-sm h-[38px] shadow-md shadow-sky-500/20 cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Kategorie anlegen</span>
              </button>
            </form>
          </div>

          {/* ARTIKEL-FORMULAR & ARTIKELLISTE UNTEN */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Formular links */}
            <form
              onSubmit={handleSaveItemForm}
              className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3.5 self-start"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white text-base">
                  {editingItem ? `Artikel bearbeiten` : 'Neuen Artikel anlegen'}
                </h3>
                {editingItem && (
                  <button
                    type="button"
                    onClick={resetItemForm}
                    className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Abbrechen / Neu
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Artikelname *</label>
                <input
                  type="text"
                  required
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="z. B. Pilsener Bier (0,5l) oder Gaffa-Tape"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-300">Kategorie</label>
                    <button
                      type="button"
                      onClick={() => setInlineNewCategoryMode((prev) => !prev)}
                      className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                    >
                      {inlineNewCategoryMode ? 'Aus Liste wählen' : '+ Neue Kategorie'}
                    </button>
                  </div>

                  {inlineNewCategoryMode ? (
                    <input
                      type="text"
                      required
                      value={inlineCategoryName}
                      onChange={(e) => setInlineCategoryName(e.target.value)}
                      placeholder="Neue Kategorie eingeben..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-sky-500 text-sm text-white"
                    />
                  ) : (
                    <select
                      value={itemForm.category}
                      onChange={(e) => {
                        const catId = e.target.value;
                        const catObj = activeCategories.find((c) => c.id === catId);
                        setItemForm({
                          ...itemForm,
                          category: catId,
                          isReturnable: Boolean(catObj?.defaultReturnable || catId === 'equipment'),
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                    >
                      {activeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Haupteinheit (z.B. Kiste, Rolle)
                  </label>
                  <input
                    type="text"
                    required
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                    placeholder="Kiste, Rolle, Stück..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
              </div>

              {/* Optionale Untereinheit für Kisten/Gebinde */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-sky-300">
                  Optional: Gebinde / Einzelflaschen-Umrechnung
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Untereinheit (z.B. Flasche)
                    </label>
                    <input
                      type="text"
                      value={itemForm.subUnit}
                      onChange={(e) => setItemForm({ ...itemForm, subUnit: e.target.value })}
                      placeholder="leer lassen falls keine"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Anzahl pro {itemForm.unit || 'Haupteinheit'}
                    </label>
                    <input
                      type="number"
                      min="2"
                      value={itemForm.subUnitsPerUnit}
                      onChange={(e) =>
                        setItemForm({ ...itemForm, subUnitsPerUnit: e.target.value })
                      }
                      placeholder="z. B. 20"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Aktueller Bestand</label>
                  <input
                    type="text"
                    value={itemForm.quantity}
                    onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Mindestbestand</label>
                  <input
                    type="text"
                    value={itemForm.minStock}
                    onChange={(e) => setItemForm({ ...itemForm, minStock: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Sollbestand</label>
                  <input
                    type="text"
                    value={itemForm.targetStock}
                    onChange={(e) => setItemForm({ ...itemForm, targetStock: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Lagerort im Keller</label>
                <input
                  type="text"
                  value={itemForm.location}
                  onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
                  placeholder="z. B. Getränkekeller Regal A, Werkzeugschrank..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Suchbegriffe / Synonyme für Textblock-Erkennung (kommagetrennt)
                </label>
                <input
                  type="text"
                  value={itemForm.aliases}
                  onChange={(e) => setItemForm({ ...itemForm, aliases: e.target.value })}
                  placeholder="z. B. gaffa, panzertape, klebeband"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={itemForm.allowFractions}
                    onChange={(e) =>
                      setItemForm({ ...itemForm, allowFractions: e.target.checked })
                    }
                    className="rounded accent-sky-500"
                  />
                  <span>Angebrochene Einheiten erlauben (z. B. halbe Rolle / +½ Button)</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={itemForm.isReturnable}
                    onChange={(e) =>
                      setItemForm({ ...itemForm, isReturnable: e.target.checked })
                    }
                    className="rounded accent-sky-500"
                  />
                  <span>Leihgerät / Inventar mit Rückgabepflicht (wird nach Event zurückerwartet)</span>
                </label>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>{editingItem ? 'Änderungen speichern' : 'Artikel im Keller anlegen'}</span>
              </button>
            </form>

            {/* Artikelliste rechts */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <h3 className="font-bold text-white text-base">
                Vorhandene Artikel ({items.length})
              </h3>
              <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                {items.map((item) => {
                  const catObj = activeCategories.find((c) => c.id === item.category);
                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-white truncate">
                            {item.name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700">
                            {catObj?.shortLabel || catObj?.label || item.categoryLabel || item.category}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Bestand:{' '}
                          <strong className="text-emerald-300">
                            {formatStockDisplay(item).primaryText}
                          </strong>{' '}
                          • Min: {item.minStock} {item.unit}
                          {item.aliases.length > 0
                            ? ` • Begriffe: ${item.aliases.slice(0, 3).join(', ')}`
                            : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditItem(item)}
                          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer"
                          title="Bearbeiten"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Artikel „${item.name}“ wirklich löschen?`)) {
                              onDeleteItem(item.id);
                            }
                          }}
                          className="p-2 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: CSV / EXCEL IMPORT & EXPORT */}
      {adminSubTab === 'csv' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Upload className="w-5 h-5 text-sky-400" />
              <span>Erstinventur per Excel / CSV importieren</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Ideal für die schnelle Erstinventur am PC: Lade dir die Muster-Vorlage herunter, befülle sie in Excel oder LibreOffice und lade sie hier wieder hoch. Auch neue Kategorien in der Spalte „Kategorie“ werden beim Import automatisch angelegt!
            </p>

            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    generateCsvTemplate(),
                    'Vereinskeller_Erstinventur_Vorlage.csv'
                  )
                }
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs sm:text-sm font-semibold border border-slate-700 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>1. CSV-Mustervorlage herunterladen</span>
              </button>

              <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs sm:text-sm font-bold shadow-lg shadow-sky-500/20 cursor-pointer">
                <Upload className="w-4 h-4 stroke-[2.5]" />
                <span>2. Ausgefüllte CSV-Datei importieren</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-400" />
              <span>Aktuellen Bestand & Logbuch exportieren</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Exportiere jederzeit den kompletten aktuellen Kellerbestand oder das Buchungs-Logbuch als deutschsprachige CSV-Tabelle (direkt in Excel mit korrekten Umlauten und Spalten öffenbar).
            </p>

            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    exportInventoryToCsv(items, activeCategories),
                    `Vereinskeller_Bestand_${new Date().toISOString().slice(0, 10)}.csv`
                  )
                }
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold shadow-lg shadow-emerald-500/20 cursor-pointer"
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>Bestandsliste als Excel-CSV speichern</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    exportTransactionsToCsv(transactions),
                    `Vereinskeller_Logbuch_${new Date().toISOString().slice(0, 10)}.csv`
                  )
                }
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-semibold border border-slate-700 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Logbuch / Historie exportieren</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: PERSONEN, DATENBANK, QR-CODE & EINSTELLUNGEN */}
      {adminSubTab === 'settings' && (
        <div className="space-y-5 no-print">
          {/* Berechtigte Personen / Namensliste verwalten */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Users className="w-5 h-5 text-sky-400" />
                  <span>
                    Berechtigte Personen / Namensliste verwalten ({activeAllowedMembers.length})
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Bei der Namenseingabe im Buchungs-Menü werden ausschließlich Namen aus dieser Liste akzeptiert. Änderungen werden automatisch mit der Cloud synchronisiert.
                </p>
              </div>
            </div>

            <form onSubmit={handleAddAllowedMember} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <UserPlus className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="Neuen Namen hinzufügen (z. B. Max Mustermann)..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!newMemberName.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs sm:text-sm cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Name hinzufügen</span>
              </button>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1 pt-1">
              {activeAllowedMembers.map((member) => (
                <div
                  key={member}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-slate-200"
                >
                  <span className="font-medium truncate">{member}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Soll „${member}“ wirklich von der Liste der berechtigten Personen entfernt werden?`
                        )
                      ) {
                        handleRemoveAllowedMember(member);
                      }
                    }}
                    className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/15 transition cursor-pointer shrink-0"
                    title={`${member} entfernen`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Database className="w-5 h-5 text-sky-400" />
                  <span>Kostenlose Cloud-Datenbank (Supabase) für Multi-Geräte-Sync</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Damit alle Vereinsmitglieder von ihren eigenen Handys auf denselben Kellerbestand zugreifen können, kannst du hier ein kostenloses Supabase-Projekt (supabase.com) hinterlegen.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Supabase Project URL (z. B. https://xyz.supabase.co)
                  </label>
                  <input
                    type="url"
                    value={settingsForm.supabaseUrl}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, supabaseUrl: e.target.value })
                    }
                    placeholder="https://dein-projekt.supabase.co"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Supabase Anon / Public Key
                  </label>
                  <input
                    type="password"
                    value={settingsForm.supabaseAnonKey}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, supabaseAnonKey: e.target.value })
                    }
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
                      setCopiedSql(true);
                      setTimeout(() => setCopiedSql(false), 3000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300 border border-slate-700 cursor-pointer"
                  >
                    {copiedSql ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>
                      {copiedSql
                        ? 'SQL-Skript kopiert!'
                        : 'SQL-Skript für Tabellen-Einrichtung kopieren'}
                    </span>
                  </button>

                  {settings.supabaseUrl && settings.supabaseAnonKey && (
                    <button
                      type="button"
                      onClick={onManualSync}
                      disabled={isSyncing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-xs font-semibold text-emerald-300 border border-emerald-500/40 cursor-pointer"
                    >
                      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>Jetzt mit Cloud synchronisieren</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Optionale KI-Erkennung */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Optionale KI-Unterstützung für Freitext-Erkennung</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Die lokale Texterkennung funktioniert bereits komplett kostenlos und offline. Optional kannst du zusätzlich einen Gemini- oder OpenAI-API-Key hinterlegen.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <select
                    value={settingsForm.aiProvider}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        aiProvider: e.target.value as 'gemini' | 'openai',
                      })
                    }
                    className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  >
                    <option value="gemini">Google Gemini API</option>
                    <option value="openai">OpenAI API</option>
                  </select>
                  <input
                    type="password"
                    value={settingsForm.aiApiKey}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, aiApiKey: e.target.value })
                    }
                    placeholder="Optionaler API-Key..."
                    className="sm:col-span-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
              </div>

              {/* Vereinsname */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <h4 className="font-bold text-white text-sm">Vereinsname</h4>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Name des Vereins / Kellers</label>
                  <input
                    type="text"
                    value={settingsForm.clubName}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, clubName: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  // Passwort & 2FA-E-Mail sind ausschließlich über den 2FA-Bereich änderbar
                  const safeSettings: AppSettings = {
                    ...settingsForm,
                    adminPassword: settings.adminPassword,
                    adminEmail: settings.adminEmail,
                    allowedMembers: activeAllowedMembers,
                  };
                  onUpdateSettings(safeSettings);
                  showBanner('Einstellungen und Datenbank-Verbindung gespeichert!');
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Allgemeine Einstellungen speichern</span>
              </button>

              {/* 2FA-Geschützter Bereich: Admin-Passwort & 2FA-E-Mail */}
              <div className="pt-5 border-t border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Admin-Passwort & 2FA-Schutz (Zwei-Faktor-Authentifizierung)</span>
                  </h4>
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                    Geheim & geschützt
                  </span>
                </div>

                {twoFactorError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                    {twoFactorError}
                  </div>
                )}

                {!settings.adminEmail?.trim() ? (
                  /* Erstmalige Einrichtung der 2FA-E-Mail-Adresse */
                  <div className="p-4 rounded-xl bg-slate-950 border border-sky-500/30 space-y-3">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Hinterlege hier einmalig deine <strong>Admin-E-Mail-Adresse für die 2-Faktor-Authentifizierung (2FA)</strong>. Sobald sie gespeichert ist, können das Admin-Passwort und die 2FA-E-Mail-Adresse nur noch nach Bestätigung über diese E-Mail geändert werden.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          value={initial2FAEmailInput}
                          onChange={(e) => setInitial2FAEmailInput(e.target.value)}
                          placeholder="deine-admin-email@beispiel.de"
                          className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveInitial2FAEmail}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm cursor-pointer shrink-0"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>2FA-E-Mail aktivieren</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Aktiver 2FA-Schutz */
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <span className="text-slate-400 block mb-0.5">Aktuelles Admin-Passwort:</span>
                        <span className="font-bold text-white tracking-widest">••••••••••••</span>
                        <span className="text-[11px] text-emerald-400 block mt-0.5">
                          Verborgen & durch E-Mail-2FA geschützt
                        </span>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <span className="text-slate-400 block mb-0.5">Hinterlegte 2FA-E-Mail-Adresse:</span>
                        <span className="font-bold text-sky-300 break-all">{settings.adminEmail}</span>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          Empfänger für 2FA-Bestätigungen
                        </span>
                      </div>
                    </div>

                    {twoFactorStage === 'idle' && (
                      <button
                        type="button"
                        onClick={handleRequest2FACode}
                        disabled={twoFactorLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 font-semibold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                      >
                        <KeyRound className="w-4 h-4" />
                        <span>
                          {twoFactorLoading
                            ? 'Sende 2FA-E-Mail...'
                            : `Passwort oder 2FA-E-Mail ändern (2FA an ${settings.adminEmail} senden)`}
                        </span>
                      </button>
                    )}

                    {twoFactorStage === 'code_sent' && (
                      <form onSubmit={handleVerify2FACode} className="space-y-3 pt-2 border-t border-slate-800">
                        <p className="text-xs text-sky-200 leading-relaxed">
                          Wir haben eine 2FA-E-Mail an <strong>{settings.adminEmail}</strong> gesendet.
                        </p>
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5 leading-relaxed">
                          <p className="font-semibold text-amber-300">
                            Wichtig bei „localhost hat die Verbindung abgelehnt“ (ERR_CONNECTION_REFUSED):
                          </p>
                          <p>
                            1. <strong>Sofort-Lösung:</strong> Wenn nach dem Klick auf den E-Mail-Link die Fehlerseite <code>localhost:3000/#access_token=...</code> erscheint, kopiere einfach diese komplette <strong>localhost-Adresse oben aus deiner Browser-Adresszeile</strong> (oder kopiere den Link direkt aus der E-Mail per Rechtsklick) und füge sie unten in das Feld ein!
                          </p>
                          <p>
                            2. <strong>Dauerhafte Behebung in Supabase:</strong> Öffne in deinem Supabase-Dashboard <em>Authentication → URL Configuration</em> und ändere die <strong>Site URL</strong> von <code>http://localhost:3000</code> auf <code>https://erdbeerwaffel311.github.io/inventurprogramm/</code>.
                          </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            required
                            value={twoFactorCodeInput}
                            onChange={(e) => setTwoFactorCodeInput(e.target.value)}
                            placeholder="localhost-URL aus Adresszeile, E-Mail-Link oder 6-stelligen Code einfügen..."
                            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-900 border border-sky-500 text-sm text-white font-semibold"
                          />
                          <button
                            type="submit"
                            disabled={twoFactorLoading || !twoFactorCodeInput.trim()}
                            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                          >
                            {twoFactorLoading ? 'Prüfe...' : '2FA bestätigen'}
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={handleRequest2FACode}
                            disabled={twoFactorLoading}
                            className="text-sky-400 hover:underline cursor-pointer"
                          >
                            E-Mail erneut senden
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTwoFactorStage('idle');
                              setTwoFactorError(null);
                            }}
                            className="text-slate-400 hover:text-white cursor-pointer"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </form>
                    )}

                  {twoFactorStage === 'verified' && (
                    <form
                      onSubmit={handleSave2FAProtectedChanges}
                      className="space-y-3 pt-3 border-t border-emerald-500/30"
                    >
                      <div className="flex items-center gap-2 text-xs text-emerald-300 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          2FA bestätigt! Du kannst jetzt das Admin-Passwort und/oder die 2FA-E-Mail-Adresse ändern:
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-300 mb-1">
                            Neues Admin-Passwort
                          </label>
                          <input
                            type="password"
                            value={twoFactorNewPassword}
                            onChange={(e) => setTwoFactorNewPassword(e.target.value)}
                            placeholder="Neues Passwort (leer = unverändert)"
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-emerald-500/50 text-sm text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-300 mb-1">
                            2FA-E-Mail-Adresse (änderbar)
                          </label>
                          <input
                            type="email"
                            required
                            value={twoFactorNewEmail}
                            onChange={(e) => setTwoFactorNewEmail(e.target.value)}
                            placeholder="neue-email@beispiel.de"
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-emerald-500/50 text-sm text-white"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setTwoFactorStage('idle');
                            setTwoFactorNewPassword('');
                            setTwoFactorError(null);
                          }}
                          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 cursor-pointer"
                        >
                          <Check className="w-4 h-4 stroke-[2.5]" />
                          <span>Passwort & 2FA-E-Mail speichern</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* QR-Code für die Kellertür & Handy-Einladung */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center text-center space-y-4 self-start">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <QrCode className="w-5 h-5 text-sky-400" />
              <span>QR-Code für Kellertür & Mitglieder-Handys</span>
            </div>
            <p className="text-xs text-slate-400">
              Wenn Mitglieder diesen QR-Code scannen, öffnet sich die App direkt verbunden mit eurer Vereins-Datenbank. Auf iPhone & Android kann sie über „Zum Home-Bildschirm“ als echte App installiert werden.
            </p>

            <div className="p-4 bg-white rounded-2xl shadow-lg">
              <QRCodeSVG value={shareUrl} size={190} />
            </div>

            <div className="flex flex-wrap justify-center gap-2 w-full">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 3000);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Link kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-sky-400" />
                    <span>Einladungs-Link kopieren</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-xs font-bold text-slate-950 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Aushang drucken</span>
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};
