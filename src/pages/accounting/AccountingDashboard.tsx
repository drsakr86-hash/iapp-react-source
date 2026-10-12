/* -------------------------------------------------------------------------
 * AccountingDashboard — /accounting
 * -------------------------------------------------------------------------
 * Every number here is read from a view (v_account_balances /
 * v_daily_financial_summary) — nothing is a stored/editable balance.
 * PROVISIONAL: renders empty until the migration is applied and at least
 * one account exists.
 * ---------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Spinner, StatCard } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import * as reportsSvc from '../../services/accounting/reports';
import type { AccountBalanceRow } from '../../types/accounting.types';

export default function AccountingDashboard() {
  useDocumentTitle('الحسابات المالية');
  const [balances, setBalances] = useState<AccountBalanceRow[]>([]);
  const [today, setToday] = useState({ revenue: 0, expenses: 0, refunds: 0, net: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([reportsSvc.accountBalances(), reportsSvc.todaySummary()]);
      setBalances(b);
      setToday(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل البيانات المالية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="stack">
      {loading ? <Spinner label="جارٍ التحميل…" /> : null}
      {!loading && error ? <EmptyState icon="⚠️" text={error} /> : null}

      {!loading && !error ? (
        <>
          <Card title="ملخص اليوم">
            <div className="stat-grid">
              <StatCard icon="💰" value={today.revenue.toFixed(2)} label="الإيرادات" color="var(--success)" />
              <StatCard icon="🧾" value={today.expenses.toFixed(2)} label="المصروفات" color="var(--danger)" />
              <StatCard icon="↩️" value={today.refunds.toFixed(2)} label="المرتجعات" color="var(--gold)" />
              <StatCard icon="📊" value={today.net.toFixed(2)} label="صافي الحركة" color="var(--accent)" />
            </div>
          </Card>

          <Card title="الحسابات">
            {balances.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {balances.map((b) => (
                  <div
                    key={b.account_id}
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      background: 'var(--bg)',
                      borderRadius: 'var(--radius)',
                      padding: '8px 12px',
                    }}
                  >
                    <span className="row" style={{ gap: 8 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          inlineSize: 28,
                          blockSize: 28,
                          borderRadius: 8,
                          background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                        }}
                      >
                        🏦
                      </span>
                      {b.name_ar}
                    </span>
                    <strong style={{ color: 'var(--accent)' }}>
                      {b.current_balance.toFixed(2)} {b.currency}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏦"
                text="لا توجد حسابات/خزائن مُضافة بعد"
              />
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
