import { useEffect, useRef, useState } from "react";

export default function useApi(url, { skip = false, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);
  const abortRef = useRef();

  const withTimeout = (promise, ms = 10000) => {
    let t;
    const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error("Request timed out")), ms)));
    return Promise.race([promise.finally(() => clearTimeout(t)), timer]);
  };

  const fetcher = async () => {
    if (skip) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await withTimeout(fetch(url, { signal: ctrl.signal }), 10000);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetcher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch: fetcher, setData };
}
