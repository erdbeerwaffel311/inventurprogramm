import React, { useState, useMemo } from 'react';
import {
  ClipboardPen,
  Plus,
  Minus,
  Trash2,
  Check,
  Copy,
  Search,
  FolderPlus,
  CheckSquare,
  Square,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  User,
  Calendar,
} from 'lucide-react';
import {
  AppSettings,
  BookingMode,
  CartEntry,
  CategoryId,
  InventoryItem,
  KellerlisteItem,
  KellerlisteProject,
} from '../types';
import { CATEGORIES } from '../data/defaultData';
import {
  formatEnteredAmount,
  formatGermanNumber,
  formatStockDisplay,
  pluralizeUnit,
  roundStock,
  toPrimaryUnitQuantity,
} from '../utils/units';

interface KellerlisteViewProps {
  items: InventoryItem[];
  settings: AppSettings;
  currentUserName: string;
  onUpdateProjectLists: (nextLists: KellerlisteProject[]) => void;
  onExecuteBookingFromList: (params: {
    mode: BookingMode;
    entries: CartEntry[];
    personName?: string;
    eventName?: string;
    note?: string;
  }) => void;
}

export const KellerlisteView: React.FC<KellerlisteViewProps> = ({
  items,
  settings,
  currentUserName,
  onUpdateProjectLists,
  onExecuteBookingFromList,
}) => {
  const projectLists = useMemo(
    () => (Array.isArray(settings.projectLists) ? settings.projectLists : []),
    [settings.projectLists]
  );

  const activeCategories = settings.categories?.length ? settings.categories : CATEGORIES;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => projectLists[0]?.id || null
  );
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNote, setNewProjectNote] = useState('');

  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [unitPreference, setUnitPreference] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const activeProject = useMemo(
    () =>
      projectLists.find((p) => p.id === selectedProjectId) ||
      projectLists[0] ||
      null,
    [projectLists, selectedProjectId]
  );

  function showBanner(msg: string) {
    setBannerMsg(msg);
    setTimeout(() => {
      setBannerMsg((prev) => (prev === msg ? null : prev));
    }, 4500);
  }

  function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = newProjectName.trim();
    if (!cleanName) return;

    const now = new Date().toISOString();
    const newProj: KellerlisteProject = {
      id: `proj-${Date.now()}`,
      name: cleanName,
      createdBy: currentUserName,
      createdAt: now,
      updatedAt: now,
      note: newProjectNote.trim() || undefined,
      status: 'planned',
      items: [],
    };

    const nextLists = [newProj, ...projectLists];
    onUpdateProjectLists(nextLists);
    setSelectedProjectId(newProj.id);
    setNewProjectName('');
    setNewProjectNote('');
    showBanner(`Kellerliste / Projekt „${cleanName}“ wurde angelegt! Du kannst jetzt Artikel hinzufügen.`);
  }

  function handleDeleteProject(projId: string) {
    const target = projectLists.find((p) => p.id === projId);
    if (!target) return;
    if (!window.confirm(`Soll die Kellerliste „${target.name}“ wirklich gelöscht werden?`)) {
      return;
    }
    const nextLists = projectLists.filter((p) => p.id !== projId);
    onUpdateProjectLists(nextLists);
    if (selectedProjectId === projId) {
      setSelectedProjectId(nextLists[0]?.id || null);
    }
    showBanner(`Kellerliste „${target.name}“ wurde gelöscht.`);
  }

  function getSelectedUnit(item: InventoryItem): string {
    if (unitPreference[item.id]) return unitPreference[item.id];
    const existingLine = activeProject?.items.find((l) => l.itemId === item.id);
    return existingLine?.unit || item.unit;
  }

  function updateProjectItemAmount(
    item: InventoryItem,
    nextAmount: number,
    unitOverride?: string
  ) {
    if (!activeProject) return;
    const unit = unitOverride || getSelectedUnit(item);
    const clamped = roundStock(Math.max(0, nextAmount));

    let nextItems: KellerlisteItem[];
    if (clamped <= 0) {
      nextItems = activeProject.items.filter((l) => l.itemId !== item.id);
    } else {
      const exists = activeProject.items.some((l) => l.itemId === item.id);
      if (exists) {
        nextItems = activeProject.items.map((l) =>
          l.itemId === item.id
            ? { ...l, itemName: item.name, amount: clamped, unit }
            : l
        );
      } else {
        nextItems = [
          ...activeProject.items,
          {
            itemId: item.id,
            itemName: item.name,
            amount: clamped,
            unit,
            checked: false,
          },
        ];
      }
    }

    const updatedProject: KellerlisteProject = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      items: nextItems,
    };

    onUpdateProjectLists(
      projectLists.map((p) => (p.id === activeProject.id ? updatedProject : p))
    );
  }

  function handleToggleCheckItem(itemId: string) {
    if (!activeProject) return;
    const updatedProject: KellerlisteProject = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      items: activeProject.items.map((l) =>
        l.itemId === itemId ? { ...l, checked: !l.checked } : l
      ),
    };
    onUpdateProjectLists(
      projectLists.map((p) => (p.id === activeProject.id ? updatedProject : p))
    );
  }

  function handleUnitSwitch(item: InventoryItem, newUnit: string) {
    setUnitPreference((prev) => ({ ...prev, [item.id]: newUnit }));
    const existing = activeProject?.items.find((l) => l.itemId === item.id);
    if (existing) {
      updateProjectItemAmount(item, existing.amount, newUnit);
    }
  }

  function handleCopyProjectList(proj: KellerlisteProject) {
    if (proj.items.length === 0) return;
    const lines = proj.items.map((line) => {
      const checkMark = line.checked ? '☑' : '☐';
      return `${checkMark} ${formatGermanNumber(line.amount)} ${pluralizeUnit(
        line.unit,
        line.amount
      )} ${line.itemName}`;
    });
    const text = `📋 Kellerliste – ${proj.name} (Erstellt von ${proj.createdBy}):\n${lines.join('\n')}`;
    navigator.clipboard.writeText(text);
    setCopiedId(proj.id);
    setTimeout(() => setCopiedId(null), 3000);
  }

  function handleConvertListToWithdrawal(proj: KellerlisteProject) {
    if (proj.items.length === 0) return;

    const validEntries: CartEntry[] = [];
    for (const line of proj.items) {
      const catalogItem = items.find((i) => i.id === line.itemId);
      if (!catalogItem || catalogItem.quantity <= 0) continue;

      const requestedPrimary = toPrimaryUnitQuantity(catalogItem, line.amount, line.unit);
      if (requestedPrimary <= catalogItem.quantity) {
        validEntries.push({
          itemId: line.itemId,
          amount: line.amount,
          unit: line.unit,
        });
      } else {
        // Auf verfügbaren Lagerbestand begrenzen
        const isSub =
          catalogItem.subUnit &&
          catalogItem.subUnitsPerUnit &&
          catalogItem.subUnitsPerUnit > 1 &&
          line.unit.toLowerCase() === catalogItem.subUnit.toLowerCase();
        const maxInUnit = isSub
          ? roundStock(catalogItem.quantity * catalogItem.subUnitsPerUnit!)
          : roundStock(catalogItem.quantity);
        if (maxInUnit > 0) {
          validEntries.push({
            itemId: line.itemId,
            amount: maxInUnit,
            unit: line.unit,
          });
        }
      }
    }

    if (validEntries.length === 0) {
      showBanner('Von den Artikeln auf dieser Kellerliste ist aktuell nichts auf Lager.');
      return;
    }

    if (
      !window.confirm(
        `Soll die Kellerliste „${proj.name}“ (${validEntries.length} verfügbare Positionen) jetzt tatsächlich als Entnahme aus dem Keller ausgebucht werden?`
      )
    ) {
      return;
    }

    onExecuteBookingFromList({
      mode: 'withdraw',
      entries: validEntries,
      personName: currentUserName,
      eventName: proj.name,
      note: proj.note
        ? `Aus Kellerliste übernommen: ${proj.note}`
        : `Aus Kellerliste „${proj.name}“ ausgebucht`,
    });

    const updatedProject: KellerlisteProject = {
      ...proj,
      status: 'booked',
      updatedAt: new Date().toISOString(),
    };
    onUpdateProjectLists(
      projectLists.map((p) => (p.id === proj.id ? updatedProject : p))
    );
    showBanner(
      `Kellerliste „${proj.name}“ wurde erfolgreich als Entnahme auf deinen Namen (${currentUserName}) ausgebucht!`
    );
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchLoc = (item.location || '').toLowerCase().includes(q);
        const matchAlias = item.aliases.some((a) => a.toLowerCase().includes(q));
        return matchName || matchLoc || matchAlias;
      }
      return true;
    });
  }, [items, selectedCategory, searchQuery]);

  return (
    <div className="space-y-5 pb-24">
      {bannerMsg && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{bannerMsg}</span>
        </div>
      )}

      {/* 1. Kopf-Box: Erklärung & Neues Projekt / Kellerliste anlegen */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
              <ClipboardPen className="w-5 h-5 text-sky-400" />
              <span>Kellerliste (Projekt-Planung ohne sofortiges Ausbuchen)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Lege hier ein Projekt an und notiere alle benötigten Inventarstücke und Stückzahlen.{' '}
              <strong className="text-slate-300">
                Dabei wird noch nichts vom Kellerbestand abgezogen!
              </strong>
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 self-start sm:self-auto shrink-0">
            <User className="w-3.5 h-3.5 text-sky-400" />
            <span>
              Angemeldet als: <strong className="text-white">{currentUserName}</strong>
            </span>
          </div>
        </div>

        {/* Formular: Neues Projekt anlegen */}
        <form
          onSubmit={handleCreateProject}
          className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-slate-800"
        >
          <div className="sm:col-span-5 relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              required
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Neues Projekt (z. B. Sommerfest, Klausur, Standaktion)..."
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-xs sm:text-sm text-white"
            />
          </div>
          <div className="sm:col-span-4">
            <input
              type="text"
              value={newProjectNote}
              onChange={(e) => setNewProjectNote(e.target.value)}
              placeholder="Optionale Notiz / Datum..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-xs sm:text-sm text-white"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={!newProjectName.trim()}
              className="w-full h-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-sky-500/20 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 stroke-[2.5]" />
              <span>Projekt anlegen</span>
            </button>
          </div>
        </form>

        {/* Projekt-Auswahl-Tabs falls Projekte vorhanden */}
        {projectLists.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="text-xs font-semibold text-slate-400 block">
              Gespeicherte Kellerlisten / Projekte ({projectLists.length}):
            </span>
            <div className="flex flex-wrap gap-2">
              {projectLists.map((proj) => {
                const isSelected = activeProject?.id === proj.id;
                return (
                  <div
                    key={proj.id}
                    onClick={() => setSelectedProjectId(proj.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-medium transition cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/20 border-sky-500 text-white shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold">{proj.name}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-sky-300 text-[11px] font-bold">
                      {proj.items.length}
                    </span>
                    {proj.status === 'booked' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                        Ausgebucht
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Falls noch kein Projekt existiert */}
      {!activeProject ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
          <ClipboardPen className="w-10 h-10 text-sky-400 mx-auto" />
          <h3 className="font-bold text-white text-base">
            Noch keine Kellerliste angelegt
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Gib oben einfach einen Projektnamen ein und klicke auf „Projekt anlegen“, um eine neue Kellerliste mit allen benötigten Inventarstücken zusammenzustellen.
          </p>
        </div>
      ) : (
        <>
          {/* 2. Aktives Projekt: Eingetragene Inventarstücke auf der Kellerliste */}
          <div className="bg-slate-900 border border-sky-500/30 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white text-base sm:text-lg">
                    📋 Projekt: {activeProject.name}
                  </h3>
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                    Nur Liste – noch nicht ausgebucht
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Erstellt von <strong className="text-slate-200">{activeProject.createdBy}</strong> am{' '}
                  {new Date(activeProject.createdAt).toLocaleDateString('de-DE')}
                  {activeProject.note ? ` • Notiz: ${activeProject.note}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeProject.items.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopyProjectList(activeProject)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
                    >
                      {copiedId === activeProject.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Kopiert!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-sky-400" />
                          <span>Liste kopieren</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleConvertListToWithdrawal(activeProject)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold shadow-lg shadow-rose-500/20 cursor-pointer"
                      title="Wenn das Projekt stattfindet, kannst du alle Positionen dieser Liste hiermit direkt aus dem Keller ausbuchen"
                    >
                      <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                      <span>Jetzt aus Keller entnehmen (Ausbuchen)</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => handleDeleteProject(activeProject.id)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 cursor-pointer"
                  title="Projekt löschen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeProject.items.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">
                Diese Kellerliste ist noch leer. Wähle unten aus dem Inventar die benötigten Artikel und Stückzahlen aus!
              </p>
            ) : (
              <div className="space-y-2">
                {activeProject.items.map((line) => {
                  const catalogItem = items.find((i) => i.id === line.itemId);
                  const neededPrimary = catalogItem
                    ? toPrimaryUnitQuantity(catalogItem, line.amount, line.unit)
                    : line.amount;
                  const availablePrimary = catalogItem ? catalogItem.quantity : 0;
                  const isShortage = catalogItem ? neededPrimary > availablePrimary : false;

                  return (
                    <div
                      key={line.itemId}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition ${
                        line.checked
                          ? 'bg-slate-950/60 border-emerald-500/30'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleCheckItem(line.itemId)}
                          className="text-sky-400 hover:text-sky-300 shrink-0 cursor-pointer"
                          title="Als gerichtet / überprüft abhaken"
                        >
                          {line.checked ? (
                            <CheckSquare className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-500" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-bold text-sm ${
                                line.checked ? 'line-through text-slate-400' : 'text-white'
                              }`}
                            >
                              {formatEnteredAmount(line.amount, line.unit)} {line.itemName}
                            </span>
                            {isShortage && catalogItem && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <AlertTriangle className="w-3 h-3" />
                                Nur {formatStockDisplay(catalogItem).primaryText} im Keller
                              </span>
                            )}
                          </div>
                          {catalogItem && (
                            <span className="text-[11px] text-slate-400 block">
                              Aktuell im Keller lagernd:{' '}
                              <strong className="text-emerald-300">
                                {formatStockDisplay(catalogItem).primaryText}
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>

                      {catalogItem && (
                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              updateProjectItemAmount(
                                catalogItem,
                                line.amount - 1,
                                line.unit
                              )
                            }
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-sky-300 min-w-[70px] text-center">
                            {formatEnteredAmount(line.amount, line.unit)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateProjectItemAmount(
                                catalogItem,
                                line.amount + 1,
                                line.unit
                              )
                            }
                            className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center font-bold cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateProjectItemAmount(catalogItem, 0, line.unit)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 cursor-pointer"
                            title="Von der Liste entfernen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Inventar-Auswahl zum Hinzufügen zur Kellerliste */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-sky-500 text-slate-950 shadow'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  Alle ({items.length})
                </button>
                {activeCategories.map((cat) => {
                  const count = items.filter((i) => i.category === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                        selectedCategory === cat.id
                          ? 'bg-sky-500 text-slate-950 shadow'
                          : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {cat.shortLabel || cat.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Artikel suchen, um ihn zur Kellerliste hinzuzufügen..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredItems.map((item) => {
                const stockDisplay = formatStockDisplay(item);
                const selectedUnit = getSelectedUnit(item);
                const existingLine = activeProject.items.find((l) => l.itemId === item.id);
                const inListAmount = existingLine?.amount || 0;
                const isSubUnitActive =
                  Boolean(item.subUnit) &&
                  selectedUnit.toLowerCase() === item.subUnit!.toLowerCase();

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3.5 transition flex flex-col justify-between gap-3 ${
                      inListAmount > 0
                        ? 'bg-slate-900 border-sky-500/70 shadow-lg shadow-sky-500/10'
                        : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-white text-sm sm:text-base leading-snug">
                          {item.name}
                        </h4>
                        <span className="text-[11px] text-slate-400">
                          Aktuell im Keller:{' '}
                          <strong className="text-emerald-300">{stockDisplay.primaryText}</strong>
                        </span>
                      </div>
                      {inListAmount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs font-bold">
                          Auf Liste: {formatEnteredAmount(inListAmount, selectedUnit)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      {item.subUnit && item.subUnitsPerUnit ? (
                        <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
                          <button
                            type="button"
                            onClick={() => handleUnitSwitch(item, item.unit)}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              !isSubUnitActive
                                ? 'bg-sky-500 text-slate-950 font-semibold'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {item.unit} ({item.subUnitsPerUnit})
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUnitSwitch(item, item.subUnit!)}
                            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                              isSubUnitActive
                                ? 'bg-sky-500 text-slate-950 font-semibold'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Einzel-{item.subUnit}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Einheit: <strong className="text-slate-200">{item.unit}</strong>
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 ml-auto">
                        <button
                          type="button"
                          onClick={() =>
                            updateProjectItemAmount(item, inListAmount - 1, selectedUnit)
                          }
                          disabled={inListAmount <= 0}
                          className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center text-white font-bold transition cursor-pointer"
                        >
                          <Minus className="w-4 h-4" />
                        </button>

                        <input
                          type="text"
                          inputMode="decimal"
                          value={inListAmount > 0 ? formatGermanNumber(inListAmount) : ''}
                          placeholder="0"
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value.replace(',', '.'));
                            updateProjectItemAmount(
                              item,
                              isNaN(parsed) ? 0 : parsed,
                              selectedUnit
                            );
                          }}
                          className={`w-14 h-9 text-center rounded-xl border font-bold text-sm focus:outline-none ${
                            inListAmount > 0
                              ? 'bg-sky-500/15 border-sky-500 text-sky-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        />

                        {item.allowFractions && !isSubUnitActive && (
                          <button
                            type="button"
                            onClick={() =>
                              updateProjectItemAmount(item, inListAmount + 0.5, selectedUnit)
                            }
                            className="h-9 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold text-xs transition cursor-pointer"
                          >
                            +½
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            updateProjectItemAmount(item, inListAmount + 1, selectedUnit)
                          }
                          className="w-9 h-9 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center font-bold shadow-sm transition cursor-pointer"
                        >
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
