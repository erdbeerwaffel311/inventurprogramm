import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  ArrowUpRight,
  ArrowDownLeft,
  PackagePlus,
  CheckCircle2,
  Clock,
  RotateCcw,
  Trash2,
  User,
  Calendar,
  Search,
} from 'lucide-react';
import { InventoryTransaction, TransactionType } from '../types';
import { formatEnteredAmount } from '../utils/units';

interface HistoryLogViewProps {
  transactions: InventoryTransaction[];
  onStartReturnFromTx: (txId: string) => void;
  onUndoTransaction: (txId: string) => void;
}

export const HistoryLogView: React.FC<HistoryLogViewProps> = ({
  transactions,
  onStartReturnFromTx,
  onUndoTransaction,
}) => {
  const [filterType, setFilterType] = useState<TransactionType | 'all' | 'open_loans'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (filterType === 'open_loans') {
        if (tx.type !== 'withdraw' || tx.status === 'completed') return false;
      } else if (filterType !== 'all' && tx.type !== filterType) {
        return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchPerson = (tx.personName || '').toLowerCase().includes(q);
        const matchEvent = (tx.eventName || '').toLowerCase().includes(q);
        const matchItems = tx.items.some((i) => i.itemName.toLowerCase().includes(q));
        return matchPerson || matchEvent || matchItems;
      }
      return true;
    });
  }, [transactions, filterType, search]);

  const typeBadge = (type: TransactionType) => {
    switch (type) {
      case 'withdraw':
        return {
          label: 'Entnahme',
          icon: ArrowUpRight,
          cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        };
      case 'return':
        return {
          label: 'Rückgabe',
          icon: ArrowDownLeft,
          cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        };
      case 'restock':
        return {
          label: 'Befüllung / Einkauf',
          icon: PackagePlus,
          cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        };
      case 'initial_inventory':
        return {
          label: 'Inventur / Zählung',
          icon: ClipboardList,
          cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        };
    }
  };

  return (
    <div className="space-y-4 pb-16">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-sky-400" />
              <span>Buchungs-Logbuch & Offene Event-Entnahmen</span>
            </h2>
            <p className="text-xs text-slate-400">
              Alle Entnahmen, Rückgaben und Einkäufe im Überblick. Von hier kannst du direkt Reste nach einem Event zurückbuchen.
            </p>
          </div>
        </div>

        {/* Filter-Buttons & Suche */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Alle Buchungen' },
              { id: 'open_loans', label: 'Offene Entnahmen / Events' },
              { id: 'withdraw', label: 'Entnahmen' },
              { id: 'return', label: 'Rückgaben' },
              { id: 'restock', label: 'Befüllungen' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id as typeof filterType)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  filterType === tab.id
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nach Person, Event oder Artikel filtern..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Liste der Buchungen */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-sm">
          Keine Buchungen für diesen Filter gefunden.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((tx) => {
            const badge = typeBadge(tx.type);
            const BadgeIcon = badge.icon;

            return (
              <div
                key={tx.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 hover:border-slate-700 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.cls}`}
                    >
                      <BadgeIcon className="w-3.5 h-3.5" />
                      {badge.label}
                    </span>

                    {tx.eventName && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-white border border-slate-700">
                        <Calendar className="w-3 h-3 text-sky-400" />
                        {tx.eventName}
                      </span>
                    )}

                    {tx.personName && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-800/80 text-slate-200">
                        <User className="w-3 h-3 text-slate-400" />
                        {tx.personName}
                      </span>
                    )}

                    {!tx.synced && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <Clock className="w-3 h-3" />
                        Wartet auf Sync
                      </span>
                    )}

                    {tx.type === 'withdraw' && tx.status === 'completed' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        Abgeschlossen / Zurückgegeben
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-slate-400">
                    {new Date(tx.timestamp).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Gebuchte Positionen */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {tx.items.map((line, i) => (
                    <div
                      key={`${tx.id}-${i}`}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800/90 text-xs"
                    >
                      <span className="text-slate-200 font-medium truncate pr-2">
                        {line.itemName}
                      </span>
                      <span
                        className={`font-bold whitespace-nowrap ${
                          line.quantityChange < 0 ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                      >
                        {line.quantityChange < 0 ? '-' : '+'}
                        {formatEnteredAmount(line.enteredAmount, line.enteredUnit)}
                      </span>
                    </div>
                  ))}
                </div>

                {tx.note && <p className="text-xs text-slate-400 italic">Notiz: {tx.note}</p>}

                {/* Aktionen: Reste zurückgeben oder Buchung stornieren */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  {tx.type === 'withdraw' && tx.status !== 'completed' ? (
                    <button
                      type="button"
                      onClick={() => onStartReturnFromTx(tx.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 text-xs font-semibold transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reste / Leihgeräte hierzu zurückgeben</span>
                    </button>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Möchtest du diese Buchung wirklich rückgängig machen? Die Bestände werden entsprechend zurückgerechnet.'
                        )
                      ) {
                        onUndoTransaction(tx.id);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Buchung rückgängig machen</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
