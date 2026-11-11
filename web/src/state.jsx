import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiBudget } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};
export { store };

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function AppProvider({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | setup | login | ready | error
  const [me, setMe] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [budgetId, setBudgetId] = useState(null);
  const [version, setVersion] = useState(0);
  const [theme, setThemeState] = useState(() => store.get('knab-theme') || 'system');
  const [txForm, setTxForm] = useState(null); // { transaction?, schedule?, defaults? }

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const selectBudget = useCallback((id) => {
    setApiBudget(id);
    setBudgetId(id);
    if (id) store.set('knab-budget', String(id));
    setVersion((v) => v + 1);
  }, []);

  const loadBudgets = useCallback(async (preferId) => {
    const list = await api('GET', '/budgets');
    setBudgets(list);
    const wanted = Number(preferId ?? store.get('knab-budget'));
    selectBudget((list.find((b) => b.id === wanted) || list[0])?.id ?? null);
    return list;
  }, [selectBudget]);

  const boot = useCallback(async () => {
    try {
      const status = await api('GET', '/status');
      if (status.needs_setup) return setPhase('setup');
      setMe(await api('GET', '/auth/me'));
      await loadBudgets();
      setPhase('ready');
    } catch (err) {
      setPhase(err.status === 401 ? 'login' : 'error');
    }
  }, [loadBudgets]);

  useEffect(() => { boot(); }, [boot]);

  useEffect(() => {
    const onSignedOut = () => { setMe(null); setPhase((p) => (p === 'ready' ? 'login' : p)); };
    window.addEventListener('knab:signed-out', onSignedOut);
    return () => window.removeEventListener('knab:signed-out', onSignedOut);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t) => { store.set('knab-theme', t); setThemeState(t); }, []);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => {});
    setApiBudget(null);
    setMe(null);
    setBudgets([]);
    setBudgetId(null);
    setPhase('login');
  }, []);

  const budget = useMemo(() => budgets.find((b) => b.id === budgetId) || null, [budgets, budgetId]);

  const money = useMemo(() => {
    let fmt;
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: budget?.currency || 'USD' });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    // Avoid "-0.00".
    return (n) => fmt.format(Math.abs(n) < 0.005 ? 0 : n);
  }, [budget?.currency]);

  const value = {
    phase, me, budgets, budget, budgetId, version, theme, txForm, money,
    boot, bump, selectBudget, loadBudgets, setTheme, logout,
    openTxForm: setTxForm,
    closeTxForm: () => setTxForm(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Fetches a budget-scoped resource and refetches whenever data changes.
export function useData(path) {
  const { version, budgetId } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api('GET', path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error, loading: false }),
    );
    return () => { live = false; };
  }, [path, version, budgetId]);
  return state;
}
