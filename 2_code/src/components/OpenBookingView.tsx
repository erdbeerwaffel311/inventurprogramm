import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  PackagePlus,
  Search,
  Sparkles,
  ListChecks,
  FileText,
  Plus,
  Minus,
  Check,
  MapPin,
  RotateCcw,
  AlertCircle,
  User,
  Calendar,
  Trash2,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import {
  AppSettings,
  BookingMode,
  CartEntry,
  CategoryId,
  InventoryItem,
  InventoryTransaction,
  ParsedTextItem,
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
import { parseFreeTextBlock, parseTextWithAI } from '../utils/textParser';

interface OpenBookingViewProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  settings: AppSettings;
  selectedReturnTxId: string | null;
  onClearSelectedReturnTx: () => void;
  onExecuteBooking: (params: {
    mode: BookingMode;
    entries: CartEntry[];
    personName?: string;
    eventName?: string;
    note?: string;
    relatedTransactionId?: string;
  }) => void;
}

export const OpenBookingView: React.FC<OpenBookingViewProps> = ({
  items,
  transactions,
  settings,
  selectedReturnTxId,
  onClearSelectedReturnTx,
  onExecuteBooking,
}) => {
  const [mode, setMode] = useState<BookingMode>('withdraw');
  const [inputMethod, setInputMethod] = useState<'list' | 'text'>('list');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Warenkorb: itemId -> { itemId, amount, unit }
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  // Bevorzugte Einheit pro Artikel in der Listenansicht (z. B. "Kiste" vs "Flasche")
  const [unitPreference, setUnitPreference] = useState<Record<string, string>>({});

  // Personen- & Event-Felder (Person wird lokal auf dem Handy gespeichert für Komfort)
  const [personName, setPersonName] = useState<string>(
    () => localStorage.getItem('vk_last_person_name') || ''
  );
  const [eventName, setEventName] = useState<string>('');
  const [note, setNote] = useState<string>('');

  // Freitext-Parser State
  const [freeText, setFreeText] = useState<string>('');
  const [parsedPreview, setParsedPreview] = useState<ParsedTextItem[]>([]);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Event-/Rückgabe-Assistent State
  const [activeReturnTxId, setActiveReturnTxId] = useState<string | null>(null);
  const [returnAmounts, setReturnAmounts] = useState<
    Record<string, { amount: number; unit: string }>
  >({});

  // Erfolgsmeldung
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Wenn aus dem Logbuch eine Entnahme zur Rückgabe ausgewählt wurde
  useEffect(() => {
    if (selectedReturnTxId) {
      setMode('return');
      initEventReturn(selectedReturnTxId);
      onClearSelectedReturnTx();
    }
  }, [selectedReturnTxId]);

  // Offene / frühere Entnahmen für den Event-Rückgabe-Modus finden
  const recentWithdrawals = useMemo(() => {
    return transactions
      .filter((tx) => tx.type === 'withdraw' && tx.status !== 'completed')
      .slice(0, 12);
  }, [transactions]);

  const activeReturnTx = useMemo(
    () => transactions.find((t) => t.id === activeReturnTxId) || null,
    [transactions, activeReturnTxId]
  );

  function initEventReturn(txId: string) {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return;
    setActiveReturnTxId(txId);
    if (tx.personName) setPersonName(tx.personName);
    if (tx.eventName) setEventName(tx.eventName);

    const initial: Record<string, { amount: number; unit: string }> = {};
    for (const line of tx.items) {
      const catItem = items.find((i) => i.id === line.itemId);
      const alreadyReturnedPrimary = line.returnedQuantity || 0;
      const takenPrimary = Math.abs(line.quantityChange);
      const remainingPrimary = Math.max(0, roundStock(takenPrimary - alreadyReturnedPrimary));

      // Bei Leihgeräten (Werkzeug/Technik) standardmäßig die volle offene Menge vorauswählen,
      // bei Verbrauchsmaterial/Getränken 0 (sodass man nur einträgt, was übrig geblieben ist)
      if (catItem?.isReturnable) {
        initial[line.itemId] = {
          amount: remainingPrimary,
          unit: catItem.unit,
        };
      } else {
        initial[line.itemId] = {
          amount: 0,
          unit: line.enteredUnit || catItem?.unit || 'Stück',
        };
      }
    }
    setReturnAmounts(initial);
  }

  // Lokale Freitext-Erkennung automatisch aktualisieren, sobald Text geändert wird
  useEffect(() => {
    if (!freeText.trim()) {
      setParsedPreview([]);
      return;
    }
    const res = parseFreeTextBlock(freeText, items);
    setParsedPreview(res.items);
    if (res.suggestedEvent && !eventName) {
      setEventName(res.suggestedEvent);
    }
    if (res.suggestedPerson && !personName) {
      setPersonName(res.suggestedPerson);
    }
  }, [freeText, items]);

  async function handleRunAiParser() {
    if (!freeText.trim()) return;
    setIsAiLoading(true);
    try {
      const res = await parseTextWithAI(freeText, items, settings);
      setParsedPreview(res.items);
      if (res.suggestedEvent) setEventName(res.suggestedEvent);
      if (res.suggestedPerson) setPersonName(res.suggestedPerson);
    } finally {
      setIsAiLoading(false);
    }
  }

  function applyParsedItemsToCart() {
    const nextCart = { ...cart };
    let count = 0;

    for (const p of parsedPreview) {
      if (!p.matchedItem || p.amount <= 0) continue;
      const itemId = p.matchedItem.id;
      const existing = nextCart[itemId];

      if (existing && existing.unit === p.unit) {
        nextCart[itemId] = {
          itemId,
          amount: roundStock(existing.amount + p.amount),
          unit: p.unit,
        };
      } else {
        nextCart[itemId] = {
          itemId,
          amount: roundStock(p.amount),
          unit: p.unit,
        };
      }
      setUnitPreference((prev) => ({ ...prev, [itemId]: p.unit }));
      count++;
    }

    setCart(nextCart);
    setFreeText('');
    setParsedPreview([]);
    setInputMethod('list');
    if (count > 0) {
      showTemporaryBanner(`${count} erkannte Position(en) in deine Auswahl übernommen!`);
    }
  }

  function showTemporaryBanner(msg: string) {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
  }

  function getSelectedUnit(item: InventoryItem): string {
    return unitPreference[item.id] || cart[item.id]?.unit || item.unit;
  }

  function handleUnitSwitch(item: InventoryItem, newUnit: string) {
    setUnitPreference((prev) => ({ ...prev, [item.id]: newUnit }));
    if (cart[item.id]) {
      setCart((prev) => ({
        ...prev,
        [item.id]: {
          ...prev[item.id],
          unit: newUnit,
        },
      }));
    }
  }

  function adjustCartAmount(item: InventoryItem, delta: number) {
    const unit = getSelectedUnit(item);
    const current = cart[item.id]?.amount || 0;
    const nextAmount = roundStock(Math.max(0, current + delta));

    setCart((prev) => {
      const copy = { ...prev };
      if (nextAmount <= 0) {
        delete copy[item.id];
      } else {
        copy[item.id] = {
          itemId: item.id,
          amount: nextAmount,
          unit,
        };
      }
      return copy;
    });
  }

  function setExactCartAmount(item: InventoryItem, rawVal: string) {
    const unit = getSelectedUnit(item);
    const parsed = parseFloat(rawVal.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      setCart((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });
      return;
    }
    setCart((prev) => ({
      ...prev,
      [item.id]: {
        itemId: item.id,
        amount: roundStock(parsed),
        unit,
      },
    }));
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

  const cartEntries = useMemo(() => Object.values(cart).filter((c) => c.amount > 0), [cart]);

  function handleConfirmCartBooking() {
    if (cartEntries.length === 0) return;
    if (personName.trim()) {
      localStorage.setItem('vk_last_person_name', personName.trim());
    }

    onExecuteBooking({
      mode,
      entries: cartEntries,
      personName: personName.trim() || undefined,
      eventName: eventName.trim() || undefined,
      note: note.trim() || undefined,
    });

    const actionLabel =
      mode === 'withdraw'
        ? 'Entnahme'
        : mode === 'return'
        ? 'Rückgabe'
        : 'Befüllung / Einkauf';

    showTemporaryBanner(
      `${actionLabel} mit ${cartEntries.length} Position(en) erfolgreich gebucht!`
    );
    setCart({});
    setNote('');
  }

  function handleConfirmEventReturn() {
    if (!activeReturnTx) return;
    const entries: CartEntry[] = Object.entries(returnAmounts)
      .filter(([, val]) => val.amount > 0)
      .map(([itemId, val]) => ({
        itemId,
        amount: roundStock(val.amount),
        unit: val.unit,
      }));

    if (entries.length === 0) {
      // Wenn 0 zurückgegeben wird (alles verbraucht), markieren wir das Event trotzdem als abgeschlossen
      onExecuteBooking({
        mode: 'return',
        entries: [],
        personName: personName.trim() || activeReturnTx.personName,
        eventName: eventName.trim() || activeReturnTx.eventName,
        note: 'Alles restlos aufgebraucht (keine Rest-Rückgabe)',
        relatedTransactionId: activeReturnTx.id,
      });
      showTemporaryBanner('Event-Entnahme als vollständig verbraucht / erledigt markiert!');
      setActiveReturnTxId(null);
      return;
    }

    if (personName.trim()) {
      localStorage.setItem('vk_last_person_name', personName.trim());
    }

    onExecuteBooking({
      mode: 'return',
      entries,
      personName: personName.trim() || activeReturnTx.personName,
      eventName: eventName.trim() || activeReturnTx.eventName,
      note: note.trim() || `Rückgabe zu ${activeReturnTx.eventName || 'Entnahme'}`,
      relatedTransactionId: activeReturnTx.id,
    });

    showTemporaryBanner(`Rückgabe (${entries.length} Positionen) erfolgreich in den Keller gebucht!`);
    setActiveReturnTxId(null);
    setReturnAmounts({});
    setNote('');
  }

  const modeConfig = {
    withdraw: {
      title: 'Entnehmen (Aus dem Keller holen)',
      subtitle: 'Wähle Artikel aus der Liste oder füge einen Textblock ein.',
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      buttonClass: 'bg-rose-500 hover:bg-rose-400 text-slate-950 shadow-rose-500/25',
      actionText: 'Entnahme jetzt buchen',
    },
    return: {
      title: 'Zurückgeben (Reste & Leihgeräte einräumen)',
      subtitle: 'Gib nicht verbrauchte Reste oder ausgeliehenes Equipment zurück.',
      badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      buttonClass: 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sky-500/25',
      actionText: 'Rückgabe jetzt buchen',
    },
    restock: {
      title: 'Befüllen / Einkauf einbuchen',
      subtitle: 'Trage neu gekaufte Getränke, Materialien oder Anschaffungen ein.',
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      buttonClass: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25',
      actionText: 'Einkauf / Befüllung buchen',
    },
  }[mode];

  return (
    <div className="space-y-5 pb-36">
      {/* Erfolgs-Banner */}
      {successBanner && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 shadow-lg animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{successBanner}</span>
        </div>
      )}

      {/* 1. Haupt-Modus-Umschalter: Entnehmen | Zurückgeben | Befüllen */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 shadow-lg">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => {
              setMode('withdraw');
              setActiveReturnTxId(null);
            }}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-3 px-3 rounded-xl font-semibold text-xs sm:text-sm transition cursor-pointer ${
              mode === 'withdraw'
                ? 'bg-rose-500 text-slate-950 shadow-lg shadow-rose-500/25'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Entnehmen</span>
          </button>

          <button
            onClick={() => setMode('return')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-3 px-3 rounded-xl font-semibold text-xs sm:text-sm transition cursor-pointer ${
              mode === 'return'
                ? 'bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/25'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Zurückgeben</span>
            {recentWithdrawals.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  mode === 'return'
                    ? 'bg-slate-950 text-sky-300'
                    : 'bg-sky-500/20 text-sky-300'
                }`}
              >
                {recentWithdrawals.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setMode('restock');
              setActiveReturnTxId(null);
            }}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-3 px-3 rounded-xl font-semibold text-xs sm:text-sm transition cursor-pointer ${
              mode === 'restock'
                ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <PackagePlus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Befüllen / Einkauf</span>
          </button>
        </div>
      </div>

      {/* Spezial-Bereich bei "Zurückgeben": Frühere Entnahme / Event auswählen */}
      {mode === 'return' && (
        <div className="bg-slate-900/90 border border-sky-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-sky-400" />
              <h2 className="font-semibold text-white text-sm sm:text-base">
                Event- & Ausleih-Rückgabe (Reste nach Veranstaltung einbuchen)
              </h2>
            </div>
            {activeReturnTx && (
              <button
                onClick={() => setActiveReturnTxId(null)}
                className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
              >
                Zurück zur Übersicht
              </button>
            )}
          </div>

          {!activeReturnTx ? (
            recentWithdrawals.length === 0 ? (
              <p className="text-xs text-slate-400">
                Aktuell gibt es keine offenen Entnahmen. Du kannst Artikel unten einfach über die Liste oder per Textfeld zurückbuchen.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-300">
                  Tippe auf eine frühere Entnahme, um direkt einzutragen, was davon übrig geblieben oder zurückgebracht wurde:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {recentWithdrawals.map((tx) => (
                    <button
                      key={tx.id}
                      onClick={() => initEventReturn(tx.id)}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-sky-500/50 text-left transition cursor-pointer group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-sky-300 truncate">
                            {tx.eventName || 'Entnahme'}
                          </span>
                          {tx.personName && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-200">
                              {tx.personName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {new Date(tx.timestamp).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          • {tx.items.length} Position(en)
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            /* Aktiver Event-Rückgabe-Assistent */
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
                <div>
                  <span className="text-xs text-sky-300 font-medium">Ausgewählte Entnahme:</span>
                  <h3 className="font-bold text-white text-sm sm:text-base">
                    {activeReturnTx.eventName || 'Entnahme'}{' '}
                    {activeReturnTx.personName ? `(${activeReturnTx.personName})` : ''}
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Vom {new Date(activeReturnTx.timestamp).toLocaleString('de-DE')}
                </span>
              </div>

              <div className="space-y-2.5">
                {activeReturnTx.items.map((line) => {
                  const catalogItem = items.find((i) => i.id === line.itemId);
                  const currentReturn = returnAmounts[line.itemId] || {
                    amount: 0,
                    unit: line.enteredUnit,
                  };
                  const takenPrimary = Math.abs(line.quantityChange);
                  const alreadyRet = line.returnedQuantity || 0;
                  const openPrimary = Math.max(0, roundStock(takenPrimary - alreadyRet));

                  return (
                    <div
                      key={line.itemId}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-white">{line.itemName}</span>
                          {catalogItem?.isReturnable && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                              Leihgerät
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Damals entnommen:{' '}
                          <strong className="text-slate-200">
                            {formatEnteredAmount(line.enteredAmount, line.enteredUnit)}
                          </strong>
                          {alreadyRet > 0 && catalogItem && (
                            <span className="text-emerald-400 ml-2">
                              (Bereits zurück: {formatGermanNumber(alreadyRet)} {catalogItem.unit})
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Schnell-Buttons */}
                        <button
                          type="button"
                          onClick={() =>
                            setReturnAmounts((prev) => ({
                              ...prev,
                              [line.itemId]: { amount: 0, unit: currentReturn.unit },
                            }))
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                            currentReturn.amount === 0
                              ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                          }`}
                        >
                          Verbraucht (0)
                        </button>

                        {catalogItem && (
                          <button
                            type="button"
                            onClick={() =>
                              setReturnAmounts((prev) => ({
                                ...prev,
                                [line.itemId]: {
                                  amount: openPrimary,
                                  unit: catalogItem.unit,
                                },
                              }))
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                              currentReturn.amount === openPrimary &&
                              currentReturn.unit === catalogItem.unit
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                            }`}
                          >
                            Alles zurück ({formatGermanNumber(openPrimary)} {catalogItem.unit})
                          </button>
                        )}

                        {/* Manuelle Rückgabemenge + Einheit */}
                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1">
                          <span className="text-xs text-slate-400">Zurück:</span>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={currentReturn.amount}
                            onChange={(e) => {
                              const val = Math.max(0, parseFloat(e.target.value) || 0);
                              setReturnAmounts((prev) => ({
                                ...prev,
                                [line.itemId]: {
                                  amount: val,
                                  unit: currentReturn.unit,
                                },
                              }));
                            }}
                            className="w-16 bg-transparent text-right font-semibold text-sm text-white focus:outline-none"
                          />
                          {catalogItem?.subUnit ? (
                            <select
                              value={currentReturn.unit}
                              onChange={(e) =>
                                setReturnAmounts((prev) => ({
                                  ...prev,
                                  [line.itemId]: {
                                    ...currentReturn,
                                    unit: e.target.value,
                                  },
                                }))
                              }
                              className="bg-slate-800 text-xs text-sky-300 rounded px-1.5 py-0.5 border border-slate-700"
                            >
                              <option value={catalogItem.unit}>{catalogItem.unit}</option>
                              <option value={catalogItem.subUnit}>{catalogItem.subUnit}</option>
                            </select>
                          ) : (
                            <span className="text-xs text-slate-300">
                              {currentReturn.unit}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveReturnTxId(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleConfirmEventReturn}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/25 cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Rückgabe für dieses Event abschließen</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Umschalter zwischen "Kategorisierte Klick-Liste" und "Textblock einfügen" */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/70 border border-slate-800/90 rounded-2xl p-3.5">
        <div>
          <span
            className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border mb-1 ${modeConfig.badgeClass}`}
          >
            {modeConfig.title}
          </span>
          <p className="text-xs text-slate-400">{modeConfig.subtitle}</p>
        </div>

        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-auto w-full sm:w-auto">
          <button
            onClick={() => setInputMethod('list')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              inputMethod === 'list'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListChecks className="w-4 h-4 text-sky-400" />
            <span>Klick-Liste (+/-)</span>
          </button>
          <button
            onClick={() => setInputMethod('text')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              inputMethod === 'text'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4 text-amber-400" />
            <span>Textblock einfügen</span>
          </button>
        </div>
      </div>

      {/* EINGABEMETHODE B: Intelligenter Textblock-Parser */}
      {inputMethod === 'text' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Textblock einfügen & automatisch erkennen</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Füge einfach eine WhatsApp-Nachricht oder Liste ein. Mengen, Einheiten (z. B. Kisten, Flaschen, halbe Rollen) und Artikel werden automatisch erkannt.
              </p>
            </div>

            {/* Schnell-Beispiele zum Testen */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setFreeText(
                    'Fürs Sommerfest:\n3 Kisten Bier, 2 Kisten Cola, 6 Flaschen Wasser, 1,5 Rollen Gaffa-Tape, halbe Packung Servietten, 2x Bierzeltgarnitur'
                  )
                }
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer"
              >
                Beispiel-Text einfügen
              </button>
            </div>
          </div>

          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={4}
            placeholder="Beispiel: Fürs Sommerfest: 2 Kisten Bier, 5 Flaschen Cola, 1,5 Rollen Gaffa, 1x Kabeltrommel ..."
            className="w-full rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none p-3.5 text-sm text-white placeholder:text-slate-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              Lokale Offline-Erkennung aktiv (funktioniert auch ohne Internet im Keller).
            </span>
            {settings.aiApiKey && (
              <button
                type="button"
                onClick={handleRunAiParser}
                disabled={isAiLoading || !freeText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isAiLoading ? 'KI analysiert...' : 'Zusätzlich mit KI prüfen'}</span>
              </button>
            )}
          </div>

          {/* Vorschau der erkannten Artikel */}
          {parsedPreview.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Erkannte Positionen ({parsedPreview.filter((p) => p.matchedItem).length} von{' '}
                {parsedPreview.length} zugeordnet)
              </h4>

              <div className="space-y-2">
                {parsedPreview.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      entry.matchedItem
                        ? 'bg-slate-950/90 border-slate-800'
                        : 'bg-amber-500/10 border-amber-500/30'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 italic">„{entry.rawSegment}“</span>
                      </div>
                      {/* Manuelle Artikel-Zuordnung per Dropdown möglich */}
                      <div className="flex items-center gap-2">
                        <select
                          value={entry.matchedItem?.id || ''}
                          onChange={(e) => {
                            const newItem = items.find((i) => i.id === e.target.value);
                            setParsedPreview((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      matchedItem: newItem,
                                      unit: newItem?.unit || p.unit,
                                      normalizedQuantity: newItem
                                        ? toPrimaryUnitQuantity(newItem, p.amount, newItem.unit)
                                        : p.amount,
                                    }
                                  : p
                              )
                            );
                          }}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs sm:text-sm font-medium text-white"
                        >
                          <option value="">-- Artikel manuell wählen --</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({formatStockDisplay(it).primaryText})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {entry.matchedItem && (
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <input
                          type="number"
                          min="0.1"
                          step="0.5"
                          value={entry.amount}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value) || 0);
                            setParsedPreview((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      amount: val,
                                      normalizedQuantity: p.matchedItem
                                        ? toPrimaryUnitQuantity(p.matchedItem, val, p.unit)
                                        : val,
                                    }
                                  : p
                              )
                            );
                          }}
                          className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-sm font-bold text-white"
                        />

                        {entry.matchedItem.subUnit ? (
                          <select
                            value={entry.unit}
                            onChange={(e) => {
                              const newU = e.target.value;
                              setParsedPreview((prev) =>
                                prev.map((p, i) =>
                                  i === idx
                                    ? {
                                        ...p,
                                        unit: newU,
                                        normalizedQuantity: p.matchedItem
                                          ? toPrimaryUnitQuantity(p.matchedItem, p.amount, newU)
                                          : p.amount,
                                      }
                                    : p
                                )
                              );
                            }}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-sky-300 font-medium"
                          >
                            <option value={entry.matchedItem.unit}>{entry.matchedItem.unit}</option>
                            <option value={entry.matchedItem.subUnit}>
                              {entry.matchedItem.subUnit}
                            </option>
                          </select>
                        ) : (
                          <span className="text-xs text-slate-300 font-medium px-1">
                            {pluralizeUnit(entry.unit, entry.amount)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={applyParsedItemsToCart}
                  disabled={!parsedPreview.some((p) => p.matchedItem && p.amount > 0)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 cursor-pointer disabled:opacity-40"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Erkannte Artikel in Auswahl übernehmen</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* EINGABEMETHODE A: Kategorisierte Klick-Liste */}
      {inputMethod === 'list' && (
        <div className="space-y-3">
          {/* Kategorie-Filter & Suchleiste */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-white text-slate-950 shadow'
                    : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800'
                }`}
              >
                Alle ({items.length})
              </button>
              {(settings.categories || CATEGORIES).map((cat) => {
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

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Artikel oder Lagerort suchen (z. B. Bier, Gaffa, Regal)..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none text-sm text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Artikel-Karten */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredItems.map((item) => {
              const selectedUnit = getSelectedUnit(item);
              const inCartAmount = cart[item.id]?.amount || 0;
              const stockDisplay = formatStockDisplay(item);
              const isLowStock = item.quantity < item.minStock;
              const isSubUnitActive =
                item.subUnit && selectedUnit.toLowerCase() === item.subUnit.toLowerCase();

              return (
                <div
                  key={item.id}
                  className={`p-3.5 sm:p-4 rounded-2xl border transition flex flex-col justify-between gap-3 ${
                    inCartAmount > 0
                      ? 'bg-slate-900 border-sky-500/70 shadow-lg shadow-sky-500/10'
                      : 'bg-slate-900/70 border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  {/* Oberer Teil: Titel, Badges & Aktueller Bestand */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-bold text-white text-sm sm:text-base leading-snug">
                          {item.name}
                        </h3>
                        {item.isReturnable && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            Leihgerät
                          </span>
                        )}
                        {isLowStock && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            <AlertCircle className="w-3 h-3" />
                            Knapp
                          </span>
                        )}
                      </div>

                      {item.location && (
                        <p className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                          <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>{item.location}</span>
                        </p>
                      )}
                    </div>

                    {/* Bestands-Anzeige rechts */}
                    <div className="text-right shrink-0 bg-slate-950/90 px-2.5 py-1.5 rounded-xl border border-slate-800">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        Im Keller
                      </div>
                      <div
                        className={`font-bold text-xs sm:text-sm ${
                          item.quantity <= 0
                            ? 'text-rose-400'
                            : isLowStock
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                        }`}
                      >
                        {stockDisplay.primaryText}
                      </div>
                      {stockDisplay.secondaryText && (
                        <div className="text-[10px] text-slate-400">
                          {stockDisplay.secondaryText}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Unterer Teil: Einheiten-Umschalter (z. B. Kiste vs Flasche) + Touch +/- Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    {/* Einheiten-Wahl falls Gebinde vorhanden */}
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
                        {item.allowFractions ? ' (auch ½ möglich)' : ''}
                      </span>
                    )}

                    {/* Große +/- Bedienelemente */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        onClick={() => adjustCartAmount(item, -1)}
                        disabled={inCartAmount <= 0}
                        className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center text-white font-bold transition cursor-pointer"
                        title="-1"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      <input
                        type="text"
                        inputMode="decimal"
                        value={inCartAmount > 0 ? formatGermanNumber(inCartAmount) : ''}
                        placeholder="0"
                        onChange={(e) => setExactCartAmount(item, e.target.value)}
                        className={`w-14 h-9 text-center rounded-xl border font-bold text-sm focus:outline-none ${
                          inCartAmount > 0
                            ? 'bg-sky-500/15 border-sky-500 text-sky-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      />

                      {/* +½ Button für angebrochene Rollen / Packungen / Kisten */}
                      {item.allowFractions && !isSubUnitActive && (
                        <button
                          type="button"
                          onClick={() => adjustCartAmount(item, 0.5)}
                          className="h-9 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold text-xs transition cursor-pointer"
                          title="Halbe Einheit hinzufügen (+0,5)"
                        >
                          +½
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => adjustCartAmount(item, 1)}
                        className="w-9 h-9 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center font-bold shadow-sm transition cursor-pointer"
                        title="+1"
                      >
                        <Plus className="w-4 h-4 stroke-[2.5]" />
                      </button>

                      {isSubUnitActive && (
                        <button
                          type="button"
                          onClick={() => adjustCartAmount(item, 5)}
                          className="h-9 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold text-xs transition cursor-pointer"
                          title="+5"
                        >
                          +5
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Sticky Buchungs-Abschlussleiste unten (sobald Artikel ausgewählt sind) */}
      {cartEntries.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/98 backdrop-blur-md border-t border-slate-700 shadow-2xl p-3 sm:p-4 no-print">
          <div className="max-w-5xl mx-auto space-y-3">
            {/* Ausgewählte Artikel Chips */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="text-xs font-semibold text-slate-400 shrink-0 mr-1">
                  Auswahl ({cartEntries.length}):
                </span>
                {cartEntries.map((entry) => {
                  const item = items.find((i) => i.id === entry.itemId);
                  if (!item) return null;
                  return (
                    <span
                      key={entry.itemId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-white whitespace-nowrap"
                    >
                      <strong className="text-sky-300">
                        {formatEnteredAmount(entry.amount, entry.unit)}
                      </strong>{' '}
                      {item.name}
                    </span>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setCart({})}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 shrink-0 cursor-pointer"
                title="Auswahl leeren"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Leeren</span>
              </button>
            </div>

            {/* Optionale Angaben (Event/Zweck & Name) + Buchungs-Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Schnell-Chips für Event / Zweck */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    placeholder="Dein Name (optional)"
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div className="relative flex items-center gap-1">
                  <div className="relative flex-1">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      list="common-events-list"
                      placeholder="Zweck / Event (z.B. Sommerfest)"
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    <datalist id="common-events-list">
                      {settings.commonEvents.map((ev) => (
                        <option key={ev} value={ev} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirmCartBooking}
                className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm shadow-lg transition cursor-pointer ${modeConfig.buttonClass}`}
              >
                <Check className="w-5 h-5 stroke-[2.5]" />
                <span>
                  {modeConfig.actionText} ({cartEntries.length})
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
