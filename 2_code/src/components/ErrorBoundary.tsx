import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleResetCache = () => {
    try {
      localStorage.removeItem('vk_inventory_items_v2');
      localStorage.removeItem('vk_inventory_transactions_v2');
      localStorage.removeItem('vk_app_settings_v1');
    } catch {}
    window.location.reload();
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 stroke-[2]" />
            </div>

            <div>
              <h1 className="text-xl font-bold text-white">Anzeigefehler aufgetreten</h1>
              <p className="text-xs text-slate-400 mt-2">
                Die Daten konnten nicht geladen werden. Bitte versuche, die Seite neu zu laden oder den lokalen Speicher zu bereinigen.
              </p>
              {this.state.error?.message && (
                <div className="mt-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-rose-300 break-all text-left">
                  {this.state.error.message}
                </div>
              )}
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Seite neu laden</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetCache}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-slate-400" />
                <span>Lokalen Speicher bereinigen & neu laden</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
