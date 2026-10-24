import { describe, it, expect } from 'vitest';
import { parseAntraegeFromText, convertParsedToSipAntraege } from '../sip/sipParser';
import { sipRealtime } from '../sip/sipRealtime';
import { DEFAULT_SIP_SESSION } from '../sip/types';

describe('SiP Text & Document Parser', () => {
  it('erkennt Abänderungsanträge (AÄA / ÄA) mit Zeilenangaben', () => {
    const text = `
    [AÄA] Zu Zeile 45-50:
    Es soll "nur schulische Endgeräte" ersetzt werden durch "eine freie Wahl zwischen schulischen und privaten Geräten".
    `;
    const parsed = parseAntraegeFromText(text);
    expect(parsed.length).toBe(1);
    expect(parsed[0].type).toBe('AAA');
    expect(parsed[0].lineOrParagraph).toBe('Zeile 45-50');
  });

  it('erkennt Wortmeldungen (WM), Erweiterungsanträge (EA) und Streichungsanträge (SA)', () => {
    const text = `
    [WM] Wortmeldung zu TOP 3 Budgetfragen.

    [EA] Erweiterungsantrag § 4 Abs. 2: Zusätzliche Mittel für Schülerzeitungen.

    [SA] Streichungsantrag: Absatz 5 soll komplett entfallen.
    `;
    const parsed = parseAntraegeFromText(text);
    expect(parsed.length).toBe(3);
    expect(parsed[0].type).toBe('WM');
    expect(parsed[1].type).toBe('EA');
    expect(parsed[2].type).toBe('SA');
  });

  it('erkennt GO-Anträge: Ende der Debatte & Ende der Redner:innenliste', () => {
    const text = `
    Antrag auf Ende der Debatte zu diesem Tagesordnungspunkt.

    Antrag auf Ende der Redner:innenliste
    `;
    const parsed = parseAntraegeFromText(text);
    expect(parsed.length).toBe(2);
    expect(parsed[0].type).toBe('ENDE_DEBATTE');
    expect(parsed[1].type).toBe('ENDE_REDNER');
  });

  it('konvertiert geparste Rohanträge in SipAntrag-Objekte', () => {
    const raw = parseAntraegeFromText('[WM] Testrede');
    const antraege = convertParsedToSipAntraege(raw, 'Testquelle');
    expect(antraege.length).toBe(1);
    expect(antraege[0].isPreFab).toBe(true);
    expect(antraege[0].status).toBe('approved');
    expect(antraege[0].author).toBe('Testquelle');
  });
});

describe('SiP Realtime & Claiming State', () => {
  it('ermöglicht das Claimen und Zurückgeben von Anträgen', () => {
    const session = sipRealtime.getSession();
    const firstAntrag = session.antraege[0];
    expect(firstAntrag).toBeDefined();

    // Claim
    sipRealtime.claimAntrag(firstAntrag.id, 'Test Delegate');
    let updated = sipRealtime.getSession().antraege.find((a) => a.id === firstAntrag.id);
    expect(updated?.claimedBy).toBe('Test Delegate');

    // Unclaim
    sipRealtime.unclaimAntrag(firstAntrag.id, 'Test Delegate');
    updated = sipRealtime.getSession().antraege.find((a) => a.id === firstAntrag.id);
    expect(updated?.claimedBy).toBeNull();
  });

  it('erlaubt das Einreichen eigener Anträge mit Pending-Status', () => {
    const submitted = sipRealtime.submitCustomAntrag({
      type: 'WM',
      title: 'Eigene Wortmeldung',
      content: 'Ich möchte zu diesem Punkt Stellung beziehen.',
      author: 'Max Mustermann',
    });

    expect(submitted.status).toBe('pending_approval');
    expect(submitted.claimedBy).toBe('Max Mustermann');

    // Freigabe durch Strategieführung
    sipRealtime.updateOrApproveAntrag(submitted.id, { status: 'approved' });
    const inSession = sipRealtime.getSession().antraege.find((a) => a.id === submitted.id);
    expect(inSession?.status).toBe('approved');
  });
});
