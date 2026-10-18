import React, { useState, useMemo } from 'react';
import {
  ShoppingCart,
  Copy,
  Check,
  PackagePlus,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { BookingMode, CartEntry, InventoryItem } from '../types';
import {
  formatGermanNumber,
  formatStockDisplay,
  pluralizeUnit,
  roundStock,
} from '../utils/units';

interface ShoppingListViewProps {
  items: InventoryItem[];
  onExecuteBooking: (params: {
    mode: BookingMode;
    entries: CartEntry[];
    personName?: string;
    eventName?: string;
    note?: string;
  }) => void;
}

export const ShoppingListView: React.FC<ShoppingListViewProps> = ({
  items,
  onExecuteBooking,
}) => {
  const [includeTargetRefill, setIncludeTargetRefill] = useState(false);
  const [customOrderAmounts, setCustomOrderAmounts] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [bookedBanner, setBookedBanner] = useState<string | null>(null);

  const shoppingItems = useMemo(() => {
    return items
      .filter((item) => {
        if (item.quantity < item.minStock) return true;
        if (includeTargetRefill && item.targetStock && item.quantity < item.targetStock) {
          return true;
        }
        return false;
      })
      .map((item) => {
        const target = item.targetStock && item.targetStock > item.minStock ? item.targetStock : item.minStock;
        const suggested = Math.max(1, Math.ceil(roundStock(target - item.quantity)));
        const orderAmount =
          customOrderAmounts[item.id] !== undefined ? customOrderAmounts[item.id] : suggested;

        return {
          item,
          isCritical: item.quantity < item.minStock,
          suggestedAmount: suggested,
          orderAmount,
        };
      });
  }, [items, includeTargetRefill, customOrderAmounts]);

  function handleCopyShoppingList() {
    if (shoppingItems.length === 0) return;
    const lines = shoppingItems
      .filter((s) => s.orderAmount > 0)
      .map(
        (s) =>
          `- ${formatGermanNumber(s.orderAmount)} ${pluralizeUnit(s.item.unit, s.orderAmount)} ${
            s.item.name
          } (Aktuell: ${formatStockDisplay(s.item).primaryText})`
      );

    const text = `Einkaufsliste Vereinskeller (${new Date().toLocaleDateString('de-DE')}):\n${lines.join('\n')}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  function handleBookRestockFromList() {
    const entries: CartEntry[] = shoppingItems
      .filter((s) => s.orderAmount > 0)
      .map((s) => ({
        itemId: s.item.id,
        amount: s.orderAmount,
        unit: s.item.unit,
      }));

    if (entries.length === 0) return;

    onExecuteBooking({
      mode: 'restock',
      entries,
      eventName: 'Nachbestellung / Einkaufsliste',
      note: 'Direkt aus der automatischen Einkaufsliste eingebucht',
    });

    setCustomOrderAmounts({});
    setBookedBanner(`${entries.length} Position(en) wurden als Einkauf in den Keller eingebucht!`);
    setTimeout(() => setBookedBanner(null), 4500);
  }

  return (
    <div className="space-y-4 pb-16">
      {bookedBanner && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{bookedBanner}</span>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-amber-400" />
              <span>Mindestbestand-Warnung & Automatische Einkaufsliste</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Zeigt alle Artikel, die unter den Mindestbestand gefallen sind. Du kannst die Liste direkt für WhatsApp kopieren oder nach dem Einkauf mit 1 Klick einbuchen.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 cursor-pointer self-start sm:self-auto">
            <input
              type="checkbox"
              checked={includeTargetRefill}
              onChange={(e) => setIncludeTargetRefill(e.target.checked)}
              className="rounded accent-sky-500"
            />
            <span>Auch Artikel unter Soll-Bestand anzeigen</span>
          </label>
        </div>

        {shoppingItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleCopyShoppingList}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-semibold border border-slate-700 transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300">Für WhatsApp kopiert!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-sky-400" />
                  <span>Einkaufsliste kopieren (WhatsApp / Notiz)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleBookRestockFromList}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold shadow-lg shadow-emerald-500/20 transition cursor-pointer"
            >
              <PackagePlus className="w-4 h-4 stroke-[2.5]" />
              <span>Alles als eingekauft in den Keller buchen</span>
            </button>
          </div>
        )}
      </div>

      {shoppingItems.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
          <h3 className="font-bold text-white text-base">Alles bestens gefüllt!</h3>
          <p className="text-xs text-slate-400">
            Aktuell liegt kein Artikel im Vereinskeller unter dem festgelegten Mindestbestand.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {shoppingItems.map(({ item, isCritical, orderAmount }) => {
            const display = formatStockDisplay(item);
            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isCritical
                    ? 'bg-slate-900 border-amber-500/40'
                    : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm sm:text-base">{item.name}</span>
                    {isCritical && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <AlertTriangle className="w-3 h-3" />
                        Unter Mindestbestand ({formatGermanNumber(item.minStock)} {item.unit})
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Aktuell im Keller: <strong className="text-rose-300">{display.primaryText}</strong>
                    {item.targetStock ? ` • Zielbestand: ${item.targetStock} ${item.unit}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <span className="text-xs text-slate-400">Nachkaufen:</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={orderAmount}
                    onChange={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                      setCustomOrderAmounts((prev) => ({
                        ...prev,
                        [item.id]: val,
                      }));
                    }}
                    className="w-16 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-right font-bold text-sm text-white"
                  />
                  <span className="text-xs font-semibold text-sky-300 min-w-[55px]">
                    {pluralizeUnit(item.unit, orderAmount)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
