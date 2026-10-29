import React, { useState, useMemo } from 'react';
import { Lock, User, LogIn, AlertCircle } from 'lucide-react';
import { AppSettings, MemberAccount } from '../types';
import { authenticateMemberWithPocketBase } from '../utils/pocketbaseSync';

interface MemberLoginViewProps {
  clubName: string;
  settings: AppSettings;
  memberAccounts: MemberAccount[];
  onLoginSuccess: (account: MemberAccount) => void;
}

export const MemberLoginView: React.FC<MemberLoginViewProps> = ({
  clubName,
  settings,
  memberAccounts,
  onLoginSuccess,
}) => {
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const matchingSuggestions = useMemo(() => {
    const q = usernameInput.trim().toLowerCase();
    if (!q) return [];
    const exactMatch = memberAccounts.some((acc) => acc.username.toLowerCase() === q);
    if (exactMatch) return [];
    return memberAccounts
      .filter(
        (acc) =>
          acc.username.toLowerCase().includes(q) ||
          acc.name.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [usernameInput, memberAccounts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoggingIn(true);

    try {
      const result = await authenticateMemberWithPocketBase(
        settings,
        usernameInput,
        passwordInput,
        memberAccounts
      );

      if (result.error || !result.account) {
        setErrorMsg(result.error || 'Anmeldung fehlgeschlagen.');
        return;
      }

      onLoginSuccess(result.account);
    } catch {
      setErrorMsg('Fehler bei der Verbindung zum PocketBase-Server.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Schülerunion Vorarlberg Logo */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-28 h-28 rounded-2xl bg-white p-2.5 shadow-xl flex items-center justify-center">
            <img
              src="./su-logo.png"
              alt="Schülerunion Vorarlberg Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="font-bold text-xl text-white">
              {clubName || 'SU – Keller'}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Bitte melde dich mit deinem Schülerunion-Benutzernamen an
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Benutzername
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoComplete="username"
                value={usernameInput}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onChange={(e) => {
                  setUsernameInput(e.target.value);
                  setShowSuggestions(true);
                  setErrorMsg(null);
                }}
                placeholder="vorname.nachname@schuelerunion.at"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-sm text-white placeholder:text-slate-500"
              />
            </div>

            {showSuggestions && matchingSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-xl bg-slate-950 border border-slate-700 shadow-2xl z-50 divide-y divide-slate-800/80 overflow-hidden">
                {matchingSuggestions.map((acc) => (
                  <button
                    key={acc.username}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setUsernameInput(acc.username);
                      setShowSuggestions(false);
                      setErrorMsg(null);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-800 transition flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-white">{acc.name}</span>
                    <span className="text-[11px] text-sky-400 truncate">{acc.username}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Passwort
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Passwort"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none text-sm text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer"
          >
            <LogIn className="w-4 h-4 stroke-[2.5]" />
            <span>{isLoggingIn ? 'Anmelden...' : 'Anmelden'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
