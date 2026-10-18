import React, { useState } from 'react';
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
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AppSettings,
  CategoryId,
  CategoryInfo,
  InventoryItem,
  InventoryTransaction,
} from '../types';
import { CATEGORIES } from '../data/defaultData';
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
import { buildShareableAppUrl, SUPABASE_SETUP_SQL } from '../utils/supabaseSync';

interface AdminViewProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  settings: AppSettings;
  isUnlocked: boolean;
  onUnlock: () => void;
  onLock: () => void;
  onSaveInitialInventory: (updatedQuantities: Record<string, number>, note?: string) => void;
  onUpsertItem: (item: InventoryItem) => void;
  onDeleteItem: (itemId: string) => void;
  onBulkImportItems: (
    newItems: InventoryItem[],
    newCategories: CategoryInfo[],
    summaryNote: string
  ) => void;
  onUpdateSettings: (newSettings: AppSettings) => void;
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
  onSaveInitialInventory,
  onUpsertItem,
  onDeleteItem,
  onBulkImportItems,
  onUpdateSettings,
  onManualSync,
  isSyncing,
}) => {
  const activeCategories = settings.categories?.length ? settings.categories : CATEGORIES;

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<
    'inventory' | 'items' | 'csv' | 'settings'
  >('inventory');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
    onUpdateSettings(nextSettings);
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
              placeholder="Passwort (Standard: admin)"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-sm text-white"
            />
            {passwordError && (
              <p className="text-xs text-rose-400 mt-1.5">
                Falsches Passwort. (Standard-Passwort bei Erststart lautet: <strong>admin</strong>)
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
            <span>4. Datenbank, QR-Code & Passwort</span>
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

      {/* SUB-TAB 4: DATENBANK, QR-CODE & EINSTELLUNGEN */}
      {adminSubTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 no-print">
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

            {/* Vereinsname & Admin-Passwort */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <h4 className="font-bold text-white text-sm">Vereinsname & Admin-Passwort</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Neues Admin-Passwort</label>
                  <input
                    type="text"
                    value={settingsForm.adminPassword}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, adminPassword: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onUpdateSettings(settingsForm);
                showBanner('Einstellungen und Datenbank-Verbindung gespeichert!');
              }}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Alle Einstellungen speichern</span>
            </button>
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
      )}
    </div>
  );
};
